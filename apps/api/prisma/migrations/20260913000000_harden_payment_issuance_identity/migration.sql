-- Preserve existing issuance rows for audit/reconciliation. New Backend
-- issuances always populate this exact fee-payer transaction signature.
ALTER TABLE "payment_transaction_issuances"
ADD COLUMN "expected_transaction_signature" TEXT;

CREATE UNIQUE INDEX "payment_transaction_issuances_expected_transaction_signature_key"
ON "payment_transaction_issuances"("expected_transaction_signature");
