-- CreateTable
CREATE TABLE "payment_transaction_issuances" (
    "id" TEXT NOT NULL,
    "payment_intent_id" TEXT NOT NULL,
    "construction_account" TEXT NOT NULL,
    "transaction_message_hash" TEXT NOT NULL,
    "recent_blockhash" TEXT NOT NULL,
    "last_valid_block_height" BIGINT NOT NULL,
    "serialized_transaction" TEXT NOT NULL,
    "issued_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "status" TEXT NOT NULL DEFAULT 'active',

    CONSTRAINT "payment_transaction_issuances_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "payment_transaction_issuances_payment_intent_id_status_idx" ON "payment_transaction_issuances"("payment_intent_id", "status");

-- CreatePartialUniqueIndex
CREATE UNIQUE INDEX "payment_transaction_issuances_unique_active_intent" ON "payment_transaction_issuances"("payment_intent_id") WHERE "status" = 'active';

-- AddForeignKey
ALTER TABLE "payment_transaction_issuances" ADD CONSTRAINT "payment_transaction_issuances_payment_intent_id_fkey" FOREIGN KEY ("payment_intent_id") REFERENCES "payment_intents"("id") ON DELETE CASCADE ON UPDATE CASCADE;
