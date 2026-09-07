# SolArch — USDC Payments Specification

**Scope:** hackathon/MVP  
**Asset:** USDC only  
**Business model:** non-custodial 95/5 split  
**Network fees:** paid by SolArch

---

## 1. Core rules

```text
Buyer pays archive price only.
Creator receives exactly 95% of archive price.
SolArch receives exactly 5% of archive price.
SolArch separately pays Solana network fees.
```

Example:

```text
Archive price = 10.00 USDC

Creator = 9.50 USDC
SolArch = 0.50 USDC
Buyer total = 10.00 USDC
```

Network fee is not deducted from creator or platform USDC transfer amounts.

---

## 2. No custody

Forbidden MVP flow:

```text
Buyer → SolArch custodial balance → later withdrawal to creator
```

Required model:

```text
Buyer signs one purchase transaction
      ├── 95% USDC → Creator ATA
      └── 5% USDC → SolArch ATA
```

SolArch never needs to hold creator proceeds for payout.

---

## 3. Creator payout wallet

Creator provides a Solana wallet address when creating archive.

Backend:

```text
validate wallet
→ derive configured USDC ATA
→ check ATA
→ create ATA automatically if missing
```

SolArch pays ATA creation costs.

For hackathon flow, prepare creator ATA before `published`, preferably during publish preparation.

---

## 4. USDC mint

Use one configured USDC mint per environment.

```text
development/test environment:
configured test USDC mint

production/mainnet:
canonical USDC mint fixed in secure configuration
```

Backend never accepts arbitrary client-provided token mint for purchase verification.

---

## 5. Price immutability

At archive create:

```text
price_amount
price_currency = USDC
platform_fee_bps = 500
```

are frozen.

For integer-safe calculations use token base units.

Conceptually, with USDC decimals:

```text
total_units = price in base units
platform_units = exact fee calculation
creator_units = total_units - platform_units
```

Rounding policy must be deterministic and tested.

Recommended rule:

```text
platform fee computed in integer base units
creator = total - platform
```

Document exact rounding implementation in code tests.

---

## 6. Payment intent

Payment intent records:

```text
archive
buyer wallet
total
creator share
platform share
creator ATA
platform ATA
USDC mint
reference
expiration
```

Amounts and recipients come only from Backend.

Viewer never constructs trusted economics.

---

## 7. Atomic transaction

Purchase transaction must include both USDC transfers in one transaction:

```text
Instruction A:
buyer USDC account → creator ATA → creator_share

Instruction B:
buyer USDC account → SolArch ATA → platform_share
```

Required property:

> Partial business success is not accepted. A purchase is confirmed only if the whole transaction succeeded and both expected transfers are present.

---

## 8. Fee payer

SolArch acts as transaction fee payer.

Goal:

```text
Buyer can purchase with USDC without needing SOL for network fee.
```

Backend/infrastructure maintains a funded SolArch fee-payer account.

Operational requirement:

- monitor fee-payer SOL balance;
- reject/create safe error if sponsorship temporarily unavailable;
- never expose fee-payer private key to frontend or Viewer.

---

## 9. Solana Pay role

Use Solana Pay transaction-request style flow or equivalent server-prepared transaction flow that allows the backend to define the complete transaction.

The QR/deep-link UX is client-facing, while trusted recipients, amounts and fee policy remain server-controlled.

---

## 10. Verification checklist

A transaction signature by itself is insufficient.

Backend must verify:

```text
transaction exists
transaction succeeded
correct network
correct configured USDC mint
buyer source is acceptable for intended purchase
creator recipient == expected creator ATA
creator amount == expected 95% amount
platform recipient == expected SolArch ATA
platform amount == expected 5% amount
total == immutable archive price
expected payment reference/intention relation exists
finality meets configured requirement
transaction signature was never consumed before
payment intent belongs to same archive
payment intent not expired or invalid under documented policy
```

Only then:

```text
payment.status = confirmed
marketplace event = payment_confirmed
Entitlement = created
```

---

## 11. Replay protection

Required:

```text
transaction_signature UNIQUE
payment_intent state transition is idempotent
same tx cannot unlock second archive
same tx cannot create duplicate Entitlements
```

Repeated verify calls should return the same confirmed result, not duplicate side effects.

---

## 12. Failure cases

### Wrong amount

No Entitlement.

### Creator transfer correct, platform transfer absent

No Entitlement.

### Platform transfer correct, creator transfer absent

No Entitlement.

### Wrong mint

No Entitlement.

### Failed transaction

No Entitlement.

### Expired payment intent

Follow implementation policy; do not silently bind an unrelated transaction.

### Network/RPC temporary error

Return pending/retryable state; do not mark paid without verification.

---

## 13. Analytics relation

Public `paid_unlocks` is based only on verified payment events.

Do not increment paid count:

- when QR is shown;
- when transaction is merely signed;
- when signature is submitted;
- when frontend says success.

Increment after backend blockchain verification.

---

## 14. Wallet privacy and security

Never request:

- creator seed phrase;
- creator private key;
- buyer seed phrase;
- buyer private key.

Wallet signs purchase client-side.

Fee-payer signing happens server-side.

---

## 15. Payment acceptance test

For a 10 USDC archive:

```text
Given:
price = 10 USDC
fee = 5%
creator ATA exists
SolArch fee payer funded

When:
buyer completes purchase

Then:
creator balance increases by 9.50 USDC
SolArch USDC balance increases by 0.50 USDC
buyer pays network fee = 0 SOL
SolArch fee payer pays network fee
payment is verified
one Entitlement is created
paid_unlocks increments once
```
