-- Frozen purchase/audit snapshots. Existing rows are backfilled only from the
-- archive and PaymentIntent records they were already bound to.
ALTER TABLE "payment_intents"
ADD COLUMN "archive_fingerprint" TEXT,
ADD COLUMN "confirmed_buyer_wallet" TEXT;

UPDATE "payment_intents" AS pi
SET "archive_fingerprint" = a."archive_fingerprint"
FROM "archives" AS a
WHERE a."id" = pi."archive_id";

DO $$
BEGIN
  IF EXISTS (
    SELECT 1 FROM "payment_intents"
    WHERE "archive_fingerprint" IS NULL
       OR "archive_fingerprint" !~ '^[0-9a-f]{64}$'
  ) THEN
    RAISE EXCEPTION 'Cannot backfill a valid immutable PaymentIntent archive fingerprint';
  END IF;
END $$;

ALTER TABLE "payment_intents"
ALTER COLUMN "archive_fingerprint" SET NOT NULL;

ALTER TABLE "payments"
ADD COLUMN "device_public_key" TEXT;

UPDATE "payments" AS p
SET "device_public_key" = pi."device_public_key"
FROM "payment_intents" AS pi
WHERE pi."id" = p."payment_intent_id";

UPDATE "payment_intents" AS pi
SET "confirmed_buyer_wallet" = p."buyer_wallet"
FROM "payments" AS p
WHERE p."payment_intent_id" = pi."id";

DO $$
BEGIN
  IF EXISTS (SELECT 1 FROM "payments" WHERE "device_public_key" IS NULL) THEN
    RAISE EXCEPTION 'Cannot backfill Payment Device A audit binding';
  END IF;
END $$;

ALTER TABLE "payments"
ALTER COLUMN "device_public_key" SET NOT NULL;

ALTER TABLE "payment_intents"
ADD CONSTRAINT "payment_intents_archive_fingerprint_format_check"
CHECK ("archive_fingerprint" ~ '^[0-9a-f]{64}$'),
ADD CONSTRAINT "payment_intents_confirmed_buyer_check"
CHECK (
  ("status" = 'confirmed' AND "confirmed_buyer_wallet" IS NOT NULL)
  OR ("status" <> 'confirmed' AND "confirmed_buyer_wallet" IS NULL)
);

CREATE FUNCTION "solarch_enforce_payment_intent_snapshot_immutability"()
RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  IF ROW(
       NEW."archive_id", NEW."archive_fingerprint", NEW."device_public_key",
       NEW."client_secret_hmac", NEW."expected_price_amount", NEW."currency",
       NEW."creator_wallet", NEW."creator_ata", NEW."creator_share_amount",
       NEW."platform_wallet", NEW."platform_ata", NEW."platform_share_amount",
       NEW."reference", NEW."expires_at", NEW."created_at"
     ) IS DISTINCT FROM ROW(
       OLD."archive_id", OLD."archive_fingerprint", OLD."device_public_key",
       OLD."client_secret_hmac", OLD."expected_price_amount", OLD."currency",
       OLD."creator_wallet", OLD."creator_ata", OLD."creator_share_amount",
       OLD."platform_wallet", OLD."platform_ata", OLD."platform_share_amount",
       OLD."reference", OLD."expires_at", OLD."created_at"
     ) OR (
       OLD."confirmed_buyer_wallet" IS NOT NULL
       AND NEW."confirmed_buyer_wallet" IS DISTINCT FROM OLD."confirmed_buyer_wallet"
     ) THEN
    RAISE EXCEPTION 'PaymentIntent purchase snapshot is immutable';
  END IF;
  RETURN NEW;
END $$;

CREATE TRIGGER "payment_intents_snapshot_immutable"
BEFORE UPDATE ON "payment_intents"
FOR EACH ROW EXECUTE FUNCTION "solarch_enforce_payment_intent_snapshot_immutability"();

CREATE FUNCTION "solarch_enforce_payment_issuance_immutability"()
RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  IF ROW(
       NEW."payment_intent_id", NEW."construction_account",
       NEW."transaction_message_hash", NEW."recent_blockhash",
       NEW."last_valid_block_height", NEW."serialized_transaction", NEW."issued_at"
     ) IS DISTINCT FROM ROW(
       OLD."payment_intent_id", OLD."construction_account",
       OLD."transaction_message_hash", OLD."recent_blockhash",
       OLD."last_valid_block_height", OLD."serialized_transaction", OLD."issued_at"
     ) OR (
       OLD."expected_transaction_signature" IS NOT NULL
       AND NEW."expected_transaction_signature" IS DISTINCT FROM OLD."expected_transaction_signature"
     ) THEN
    RAISE EXCEPTION 'Payment transaction issuance identity is immutable';
  END IF;
  RETURN NEW;
END $$;

CREATE TRIGGER "payment_transaction_issuances_identity_immutable"
BEFORE UPDATE ON "payment_transaction_issuances"
FOR EACH ROW EXECUTE FUNCTION "solarch_enforce_payment_issuance_immutability"();

CREATE UNIQUE INDEX "payment_intents_client_secret_hmac_key"
ON "payment_intents"("client_secret_hmac");

CREATE UNIQUE INDEX "device_licenses_refresh_token_hmac_key"
ON "device_licenses"("refresh_token_hmac");

CREATE UNIQUE INDEX "entitlements_id_device_public_key_key"
ON "entitlements"("id", "device_public_key");

CREATE UNIQUE INDEX "device_activations_entitlement_id_key"
ON "device_activations"("entitlement_id");

ALTER TABLE "device_activations"
DROP CONSTRAINT "device_activations_entitlement_id_fkey";

ALTER TABLE "device_activations"
ADD CONSTRAINT "device_activations_entitlement_id_device_public_key_fkey"
FOREIGN KEY ("entitlement_id", "device_public_key")
REFERENCES "entitlements"("id", "device_public_key")
ON DELETE CASCADE ON UPDATE RESTRICT;

CREATE FUNCTION "solarch_enforce_entitlement_binding_immutability"()
RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  IF ROW(
       NEW."archive_id", NEW."buyer_wallet", NEW."payment_id",
       NEW."device_public_key", NEW."max_devices", NEW."policy_snapshot",
       NEW."starts_at", NEW."created_at"
     ) IS DISTINCT FROM ROW(
       OLD."archive_id", OLD."buyer_wallet", OLD."payment_id",
       OLD."device_public_key", OLD."max_devices", OLD."policy_snapshot",
       OLD."starts_at", OLD."created_at"
     ) THEN
    RAISE EXCEPTION 'Entitlement purchase and Device A binding are immutable';
  END IF;
  RETURN NEW;
END $$;

CREATE TRIGGER "entitlements_binding_immutable"
BEFORE UPDATE ON "entitlements"
FOR EACH ROW EXECUTE FUNCTION "solarch_enforce_entitlement_binding_immutability"();

CREATE FUNCTION "solarch_enforce_finalized_archive_immutability"()
RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  IF (OLD."archive_fingerprint" IS NOT NULL
      OR OLD."content_key_ref" IS NOT NULL
      OR OLD."generated_slr_storage_key" IS NOT NULL)
     AND ROW(
       NEW."archive_fingerprint", NEW."content_key_ref", NEW."generated_slr_storage_key"
     ) IS DISTINCT FROM ROW(
       OLD."archive_fingerprint", OLD."content_key_ref", OLD."generated_slr_storage_key"
     ) THEN
    RAISE EXCEPTION 'Finalized archive bytes and ACK custody are immutable; create a new Archive ID';
  END IF;
  RETURN NEW;
END $$;

CREATE TRIGGER "archives_finalized_content_immutable"
BEFORE UPDATE OF "archive_fingerprint", "content_key_ref", "generated_slr_storage_key"
ON "archives"
FOR EACH ROW EXECUTE FUNCTION "solarch_enforce_finalized_archive_immutability"();
