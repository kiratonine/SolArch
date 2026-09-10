---
name: solana-pay-usdc
description: >-
  Builds, signs, sponsors, and verifies atomic 95/5 USDC split Solana Pay transactions,
  derives and creates Associated Token Accounts (ATAs), and verifies finalized transactions.
---

# Solana Pay USDC Integration Skill

This skill guides the construction and verification of non-custodial USDC payment transactions for SolArch.

## Core Rules

1. **Mint**: Only use the configured canonical USDC mint. Reject any non-USDC token requests.
2. **Economic Split**:
   - Creator ATA receives exactly 95% of the immutable archive price.
   - SolArch Platform ATA receives exactly 5% of the immutable archive price.
   - Total equals the exact archive price.
   - Arithmetic must use integer token base units (USDC has 6 decimals: `1 USDC = 1_000_000 units`).
3. **Fee Sponsorship**:
   - SolArch is the transaction fee payer.
   - Buyer pays 0 SOL network fee.
   - Backend partially signs the transaction using SolArch Fee Payer Keypair before returning it.
4. **Authoritative Finality**:
   - For transaction creation: `getLatestBlockhash({ commitment: 'confirmed' })`.
   - For payment verification: Authoritative confirmation requires `confirmationStatus === 'finalized'` and `meta.err === null`.
   - `processed` and `confirmed` are pending only.

## Transaction Request Flow

### 1. `GET /v1/solana-pay/payment-intents/:id/transaction`
Returns metadata:
```json
{
  "label": "SolArch Marketplace",
  "icon": "https://solarch.app/assets/icon.png"
}
```

### 2. `POST /v1/solana-pay/payment-intents/:id/transaction`
Payload: `{ "account": "<buyer_public_key>" }`
Steps:
1. Load immutable `PaymentIntent`.
2. Ensure intent is not expired (`expires_at > now`).
3. Derive or fetch:
   - Buyer USDC ATA (`getAssociatedTokenAddressSync(usdcMint, buyerPubKey)`).
   - Creator USDC ATA.
   - SolArch Platform USDC ATA.
4. Build `Transaction` or `VersionedTransaction`:
   - Set `feePayer = solarchFeePayerKeypair.publicKey`.
   - Set `recentBlockhash` and `lastValidBlockHeight` from RPC.
   - Add SPL Token `createTransferCheckedInstruction` or `createTransferInstruction` for 95% creator share.
   - Add SPL Token `createTransferCheckedInstruction` or `createTransferInstruction` for 5% platform share.
   - Add reference public key as a non-signer read-only account instruction.
5. Partial sign with `solarchFeePayerKeypair`.
6. Serialize transaction: `Buffer.from(tx.serialize({ requireAllSignatures: false })).toString('base64')`.
7. Return `{ "transaction": "<base64>" }`.

## Automatic Creator ATA Creation
If Creator ATA does not exist before archive publication:
```typescript
import { createAssociatedTokenAccountInstruction, getAssociatedTokenAddressSync } from '@solana/spl-token';

const instruction = createAssociatedTokenAccountInstruction(
  solarchFeePayerKeypair.publicKey, // payer of rent
  creatorAta,
  creatorWalletPublicKey,
  usdcMint
);
```
Execute and confirm via fee payer on-chain.
