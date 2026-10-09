-- CreateEnum
CREATE TYPE "ArchiveTechnicalStatus" AS ENUM ('draft', 'uploading', 'processing', 'ready', 'failed');

-- CreateEnum
CREATE TYPE "ArchiveMarketplaceStatus" AS ENUM ('draft', 'published', 'unpublished', 'blocked');

-- CreateEnum
CREATE TYPE "PaymentIntentStatus" AS ENUM ('created', 'pending', 'awaiting_finality', 'confirmed', 'expired', 'failed');

-- CreateEnum
CREATE TYPE "PaymentStatus" AS ENUM ('confirmed', 'failed');

-- CreateEnum
CREATE TYPE "EntitlementStatus" AS ENUM ('active', 'expired', 'revoked');

-- CreateEnum
CREATE TYPE "LicenseStatus" AS ENUM ('active', 'expired', 'revoked');

-- CreateEnum
CREATE TYPE "EventType" AS ENUM ('archive_view', 'archive_download', 'payment_confirmed');

-- CreateTable
CREATE TABLE "users" (
    "id" TEXT NOT NULL,
    "status" TEXT NOT NULL DEFAULT 'active',
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "users_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "wallets" (
    "id" TEXT NOT NULL,
    "user_id" TEXT NOT NULL,
    "chain" TEXT NOT NULL DEFAULT 'solana',
    "address" TEXT NOT NULL,
    "verified_at" TIMESTAMP(3),
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "wallets_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "archives" (
    "id" TEXT NOT NULL,
    "creator_user_id" TEXT NOT NULL,
    "title" TEXT NOT NULL,
    "short_description" TEXT NOT NULL DEFAULT '',
    "description" TEXT NOT NULL DEFAULT '',
    "technical_status" "ArchiveTechnicalStatus" NOT NULL DEFAULT 'draft',
    "marketplace_status" "ArchiveMarketplaceStatus" NOT NULL DEFAULT 'draft',
    "creator_payout_wallet" TEXT NOT NULL,
    "creator_usdc_ata" TEXT,
    "price_currency" TEXT NOT NULL DEFAULT 'USDC',
    "price_amount" TEXT NOT NULL,
    "platform_fee_bps" INTEGER NOT NULL DEFAULT 500,
    "content_key_ref" TEXT,
    "generated_slr_storage_key" TEXT,
    "archive_fingerprint" TEXT,
    "public_header_hash" TEXT,
    "max_devices" INTEGER NOT NULL DEFAULT 1,
    "allow_export" BOOLEAN NOT NULL DEFAULT false,
    "watermark_enabled" BOOLEAN NOT NULL DEFAULT true,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "archives_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "archive_listings" (
    "id" TEXT NOT NULL,
    "archive_id" TEXT NOT NULL,
    "slug" TEXT NOT NULL,
    "title" TEXT NOT NULL,
    "short_description" TEXT NOT NULL DEFAULT '',
    "description" TEXT NOT NULL DEFAULT '',
    "cover_storage_key" TEXT,
    "category" TEXT,
    "tags" TEXT[] DEFAULT ARRAY[]::TEXT[],
    "marketplace_status" "ArchiveMarketplaceStatus" NOT NULL DEFAULT 'draft',
    "published_at" TIMESTAMP(3),
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "archive_listings_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "archive_public_files" (
    "id" TEXT NOT NULL,
    "archive_id" TEXT NOT NULL,
    "display_path" TEXT NOT NULL,
    "display_name" TEXT NOT NULL,
    "file_extension" TEXT NOT NULL,
    "mime_type" TEXT NOT NULL,
    "size_bytes" BIGINT NOT NULL,
    "sort_order" INTEGER NOT NULL DEFAULT 0,
    "is_publicly_listed" BOOLEAN NOT NULL DEFAULT true,

    CONSTRAINT "archive_public_files_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "uploads" (
    "id" TEXT NOT NULL,
    "archive_id" TEXT NOT NULL,
    "source_type" TEXT NOT NULL DEFAULT 'zip',
    "original_filename" TEXT NOT NULL,
    "size_bytes" BIGINT NOT NULL,
    "storage_key" TEXT NOT NULL,
    "status" TEXT NOT NULL DEFAULT 'pending',
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "completed_at" TIMESTAMP(3),

    CONSTRAINT "uploads_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "payment_intents" (
    "id" TEXT NOT NULL,
    "archive_id" TEXT NOT NULL,
    "device_public_key" TEXT NOT NULL,
    "client_secret_hmac" TEXT NOT NULL,
    "expected_price_amount" TEXT NOT NULL,
    "currency" TEXT NOT NULL DEFAULT 'USDC',
    "creator_wallet" TEXT NOT NULL,
    "creator_ata" TEXT NOT NULL,
    "creator_share_amount" TEXT NOT NULL,
    "platform_wallet" TEXT NOT NULL,
    "platform_ata" TEXT NOT NULL,
    "platform_share_amount" TEXT NOT NULL,
    "reference" TEXT NOT NULL,
    "status" "PaymentIntentStatus" NOT NULL DEFAULT 'created',
    "expires_at" TIMESTAMP(3) NOT NULL,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "payment_intents_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "payments" (
    "id" TEXT NOT NULL,
    "payment_intent_id" TEXT NOT NULL,
    "archive_id" TEXT NOT NULL,
    "buyer_wallet" TEXT NOT NULL,
    "transaction_signature" TEXT NOT NULL,
    "status" "PaymentStatus" NOT NULL DEFAULT 'confirmed',
    "confirmed_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "raw_tx_safe_json" JSONB,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "payments_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "entitlements" (
    "id" TEXT NOT NULL,
    "archive_id" TEXT NOT NULL,
    "buyer_wallet" TEXT NOT NULL,
    "device_public_key" TEXT NOT NULL,
    "payment_id" TEXT NOT NULL,
    "status" "EntitlementStatus" NOT NULL DEFAULT 'active',
    "max_devices" INTEGER NOT NULL DEFAULT 1,
    "devices_activated" INTEGER NOT NULL DEFAULT 0,
    "policy_snapshot" JSONB NOT NULL,
    "starts_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "expires_at" TIMESTAMP(3),
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "entitlements_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "device_activations" (
    "id" TEXT NOT NULL,
    "entitlement_id" TEXT NOT NULL,
    "device_public_key" TEXT NOT NULL,
    "device_label" TEXT NOT NULL DEFAULT 'Default Device',
    "viewer_version" TEXT NOT NULL DEFAULT '0.1.0',
    "activated_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "last_seen_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "status" TEXT NOT NULL DEFAULT 'active',

    CONSTRAINT "device_activations_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "device_licenses" (
    "id" TEXT NOT NULL,
    "entitlement_id" TEXT NOT NULL,
    "device_activation_id" TEXT NOT NULL,
    "archive_id" TEXT NOT NULL,
    "device_public_key" TEXT NOT NULL,
    "status" "LicenseStatus" NOT NULL DEFAULT 'active',
    "rights_json" JSONB NOT NULL,
    "server_signature" TEXT NOT NULL,
    "issued_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "offline_valid_until" TIMESTAMP(3) NOT NULL,
    "refresh_token_hmac" TEXT,
    "revoked_at" TIMESTAMP(3),
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "device_licenses_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "request_nonce_records" (
    "id" TEXT NOT NULL,
    "credential_record_id" TEXT NOT NULL,
    "request_nonce_hash" TEXT NOT NULL,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "request_nonce_records_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "marketplace_events" (
    "id" TEXT NOT NULL,
    "archive_id" TEXT NOT NULL,
    "event_type" "EventType" NOT NULL,
    "occurred_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "anonymous_session_id" TEXT,
    "payment_id" TEXT,
    "metadata" JSONB,

    CONSTRAINT "marketplace_events_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "wallets_address_key" ON "wallets"("address");

-- CreateIndex
CREATE UNIQUE INDEX "archive_listings_archive_id_key" ON "archive_listings"("archive_id");

-- CreateIndex
CREATE UNIQUE INDEX "archive_listings_slug_key" ON "archive_listings"("slug");

-- CreateIndex
CREATE UNIQUE INDEX "payment_intents_reference_key" ON "payment_intents"("reference");

-- CreateIndex
CREATE UNIQUE INDEX "payments_payment_intent_id_key" ON "payments"("payment_intent_id");

-- CreateIndex
CREATE UNIQUE INDEX "payments_transaction_signature_key" ON "payments"("transaction_signature");

-- CreateIndex
CREATE UNIQUE INDEX "entitlements_payment_id_key" ON "entitlements"("payment_id");

-- CreateIndex
CREATE UNIQUE INDEX "device_activations_entitlement_id_device_public_key_key" ON "device_activations"("entitlement_id", "device_public_key");

-- CreateIndex
CREATE UNIQUE INDEX "request_nonce_records_credential_record_id_request_nonce_ha_key" ON "request_nonce_records"("credential_record_id", "request_nonce_hash");

-- CreateIndex
CREATE INDEX "marketplace_events_archive_id_event_type_occurred_at_idx" ON "marketplace_events"("archive_id", "event_type", "occurred_at");

-- AddForeignKey
ALTER TABLE "wallets" ADD CONSTRAINT "wallets_user_id_fkey" FOREIGN KEY ("user_id") REFERENCES "users"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "archives" ADD CONSTRAINT "archives_creator_user_id_fkey" FOREIGN KEY ("creator_user_id") REFERENCES "users"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "archive_listings" ADD CONSTRAINT "archive_listings_archive_id_fkey" FOREIGN KEY ("archive_id") REFERENCES "archives"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "archive_public_files" ADD CONSTRAINT "archive_public_files_archive_id_fkey" FOREIGN KEY ("archive_id") REFERENCES "archives"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "uploads" ADD CONSTRAINT "uploads_archive_id_fkey" FOREIGN KEY ("archive_id") REFERENCES "archives"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "payment_intents" ADD CONSTRAINT "payment_intents_archive_id_fkey" FOREIGN KEY ("archive_id") REFERENCES "archives"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "payments" ADD CONSTRAINT "payments_payment_intent_id_fkey" FOREIGN KEY ("payment_intent_id") REFERENCES "payment_intents"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "payments" ADD CONSTRAINT "payments_archive_id_fkey" FOREIGN KEY ("archive_id") REFERENCES "archives"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "entitlements" ADD CONSTRAINT "entitlements_payment_id_fkey" FOREIGN KEY ("payment_id") REFERENCES "payments"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "entitlements" ADD CONSTRAINT "entitlements_archive_id_fkey" FOREIGN KEY ("archive_id") REFERENCES "archives"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "device_activations" ADD CONSTRAINT "device_activations_entitlement_id_fkey" FOREIGN KEY ("entitlement_id") REFERENCES "entitlements"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "device_licenses" ADD CONSTRAINT "device_licenses_entitlement_id_fkey" FOREIGN KEY ("entitlement_id") REFERENCES "entitlements"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "device_licenses" ADD CONSTRAINT "device_licenses_device_activation_id_fkey" FOREIGN KEY ("device_activation_id") REFERENCES "device_activations"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "marketplace_events" ADD CONSTRAINT "marketplace_events_archive_id_fkey" FOREIGN KEY ("archive_id") REFERENCES "archives"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "marketplace_events" ADD CONSTRAINT "marketplace_events_payment_id_fkey" FOREIGN KEY ("payment_id") REFERENCES "payments"("id") ON DELETE SET NULL ON UPDATE CASCADE;
