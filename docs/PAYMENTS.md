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
device_public_key (immutable Device A)
total
creator share
platform share
creator ATA
platform ATA
USDC mint
reference
expiration
confirmed_buyer_wallet nullable
```

Amounts and recipients come only from Backend.

Before authoritative verification `confirmed_buyer_wallet` is null/unknown.
Backend populates it only from the successfully finalized transaction; neither
Viewer input nor the Solana Pay transaction-request `account` field is a buyer
identity or authorization claim.

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

Use the exact Solana Pay transaction-request flow in API.md §7.1. The QR encodes
`solana:<absolute HTTPS transaction-request endpoint>` and never contains the
private Payment Intent client secret. Public GET returns wallet display metadata;
public POST accepts the wallet's construction-time signing `account`.

The 30-minute Payment Intent is longer-lived than an ordinary recent-blockhash
transaction. Backend therefore creates or reuses one currently valid issuance on
each allowed POST rather than embedding one transaction in the intent response.
Each new issuance uses a current recent blockhash/`lastValidBlockHeight`, the
intent's immutable reference/economics, both 95/5 USDC transfers and SolArch fee
payer. Backend must partially sign the first required-signature slot with the
SolArch fee-payer key; wallet POST `account` is the only missing required signer
and adds its buyer signature without modifying the message. No new issuance is
created at or after intent expiry.

### Production Solana commitment policy

For MVP, transaction construction and payment authorization use different fixed
commitment levels:

```text
getLatestBlockhash:
commitment = confirmed

payment observed at processed:
pending/informational only

payment observed at confirmed:
awaiting_finality only

payment authorization:
confirmationStatus = finalized
```

`confirmed` is chosen for fresh transaction construction and does not authorize
digital access.

Backend MUST NOT create Payment, Entitlement, Device License or release a wrapped
Content Key while the transaction is only `processed` or `confirmed`.

Only a transaction at Solana `finalized` commitment with `meta.err == null` may
continue to the complete verification checklist and atomic Payment/Entitlement
commit.

---

## 10. Verification checklist

A transaction signature by itself is insufficient.

Backend must verify:

```text
transaction exists
transaction succeeded (`meta.err == null`)
correct network
correct configured USDC mint
exactly one canonical buyer wallet owns the debited source USDC token account and
is a required signer/authority for that debit; Backend derives this wallet from
the authoritative transaction and never accepts a Viewer-supplied buyer address
creator recipient == expected creator ATA
creator amount == expected 95% amount
platform recipient == expected SolArch ATA
platform amount == expected 5% amount
total == immutable archive price
expected payment reference/intention relation exists
Solana confirmationStatus == finalized
transaction signature was never consumed before
payment intent belongs to same archive
transaction message hash matches a Backend issuance created before intent expiry
transaction landed/succeeded within that issuance's own blockhash validity
transaction reference equals the unique immutable Payment Intent reference
Payment Intent exact device_public_key binding was fixed before payment
```

Only then:

```text
payment.status = confirmed
marketplace event = payment_confirmed
Entitlement = created
Entitlement Device A = Payment Intent device_public_key
buyer_wallet = Backend-derived transaction payer/source owner
```

The payer may scan Device A's QR using another person's wallet. That wallet is
recorded as `buyer_wallet`, but device access stays bound to Device A from the
pre-payment intent. Payment confirmation cannot replace this binding. There is no
buyer SolArch account, wallet login or wallet proof during activation/refresh.

---

## 11. Replay protection

Required:

```text
transaction_signature UNIQUE
payment.payment_intent_id UNIQUE
entitlement.payment_id UNIQUE
payment_intent state transition is idempotent
same tx cannot unlock second archive
same tx cannot create duplicate Entitlements
same tx cannot bind a second device
confirmed intent device_public_key cannot change
```

Repeated verify calls should return the same confirmed result, not duplicate side
effects.
Intent confirmation, Payment, Entitlement with Device A and the durable
`payment_confirmed` event commit in one database transaction. A commit/service
failure rolls back and remains `awaiting_finality` for reconciliation; it never
turns a valid finalized payment into `failed`/`expired`.

An unissued/modified/reference-only transaction has no state effect. An exact
issued transaction that fails on chain transfers no funds: only that issuance is
failed, and after authoritative terminal failure the intent may receive a fresh
issuance before TTL/policy stop without waiting for blockhash expiry. A dropped,
reorged or non-final observation does not permit replacement until the old window
closes. Cancellation/block stops new issuance but remains nonterminal while an
issued transaction can still land or awaits resolution. If it lands within its
window, Backend completes Payment/Entitlement after finality. Terminal intent
`failed` requires that no issuance can still land and none is awaiting resolution.

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

Viewer Payment Intent expires exactly 1800 seconds after `created_at`. The
deadline stops **new transaction issuance**. A transaction issued before the deadline that landed successfully within its
recorded recent-blockhash/`lastValidBlockHeight` window remains eligible and must
be tracked until Solana `confirmationStatus == finalized`, even when that
`finalized` status is reached after `expires_at`.

Backend keeps such a landed transaction in `awaiting_finality`; it creates no Payment or Entitlement until `confirmationStatus == finalized`,
`meta.err == null`, and the complete verification checklist passes. It keeps an
unlanded intent `pending` while a pre-expiry issuance can still land. Only after
all issuance windows close with no eligible transaction does it become
`expired`. A modified/unissued message, a reference-only unrelated transaction,
or a transaction landed outside its issued blockhash window is never accepted.
Issuance, verification and confirmation are idempotent as defined in API.md
§§7.1–8. An already `confirmed` intent remains available for its initial Device A
activation under API.md §9.3.

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
