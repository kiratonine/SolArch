# SolArch — Shared Data Model

**Database:** PostgreSQL  
**Scope:** Marketplace Backend MVP

---

## 1. Principles

- UUID/opaque IDs;
- money stored exactly, never binary float;
- immutable commercial fields enforced by service and preferably DB constraints/policies;
- payment and entitlement separated;
- public listing separated from encrypted manifest;
- analytics events server-side;
- no creator private keys.

---

## 2. Core entities

```text
users
wallets
archives
archive_listings
archive_public_files
uploads
payment_intents
payments
entitlements
device_activations
device_licenses
marketplace_events
```

---

## 3. `users`

Conceptual fields:

```text
id
created_at
updated_at
status
```

Authentication identity may be wallet-based.

---

## 4. `wallets`

```text
id
user_id
chain = solana
address
verified_at
created_at
```

Creator payout wallet may equal login wallet, but data model must not require this.

---

## 5. `archives`

```text
id
creator_user_id

title
short_description
description

technical_status
marketplace_status

creator_payout_wallet
creator_usdc_ata

price_currency
price_amount
platform_fee_bps

content_key_ref
generated_slr_storage_key
archive_fingerprint
public_header_hash

max_devices
allow_export
watermark_enabled

created_at
updated_at
```

### Immutable after create

```text
price_currency
price_amount
platform_fee_bps
```

Recommended:

```text
price_currency = USDC
platform_fee_bps = 500
```

---

## 6. `archive_listings`

Public marketplace metadata:

```text
id
archive_id
slug
title
short_description
description
cover_storage_key
category
tags
marketplace_status
published_at
updated_at
```

This separates public presentation from cryptographic archive state.

---

## 7. `archive_public_files`

```text
id
archive_id
display_path
display_name
file_extension
mime_type
size_bytes
sort_order
is_publicly_listed
```

No:

```text
chunk map
content keys
storage paths
private manifest fields
```

---

## 8. `uploads`

```text
id
archive_id
source_type
original_filename
size_bytes
storage_key
status
created_at
completed_at
```

Source upload storage is never buyer-public.

---

## 9. `payment_intents`

```text
id
archive_id
archive_fingerprint
device_public_key
payment_reference UNIQUE
intent_credential_hash

expected_price_amount
currency

creator_wallet
creator_ata
creator_share_amount

platform_wallet
platform_ata
platform_share_amount

status
expires_at
confirmed_buyer_wallet nullable
created_at
```

Related `payment_transaction_issuances` records:

```text
id
payment_intent_id
construction_account
transaction_message_hash
recent_blockhash
last_valid_block_height
serialized_transaction
issued_at
status
```

Payment intent is the authoritative pre-payment snapshot for one attempted
purchase. `device_public_key`, archive/fingerprint, economics, reference and expiry are
immutable. `confirmed_buyer_wallet` is null before verification and is populated
only from the authoritative confirmed transaction. The raw intent client secret
is never stored; selector/hash and separate-pepper rules are in API.md §9.1.

`construction_account` is untrusted Solana Pay input for buyer debit/signature
slots; it is not `buyer_wallet` or authorization. `transaction_message_hash` is
lowercase SHA-256 over exact serialized Solana message bytes, excluding the
signature array. Persist the public partially signed transaction so an idempotent
same-account POST can return it byte-for-byte while valid. Enforce at most one
blockhash-valid issuance per intent and immutable issuance fields. Issuance stops
at intent expiry, but a transaction landed within its own
`last_valid_block_height` remains tracked through finality.

---

## 10. `payments`

```text
id
payment_intent_id
archive_id
buyer_wallet
transaction_signature
device_public_key
status
confirmed_at
raw_tx_safe_json
created_at
```

Constraints:

```text
transaction_signature UNIQUE
payment_intent_id UNIQUE
entitlements.payment_id UNIQUE
one confirmed payment intent → exactly one Payment and exactly one Entitlement
```

The confirmation database transaction atomically updates the intent, inserts
Payment and Entitlement, and inserts the durable `payment_confirmed` outbox/event.
On rollback the intent remains/restores `awaiting_finality`; reconciliation from
the persisted issuance retries until the whole commit succeeds. Infrastructure
failure cannot terminally fail or expire an eligible finalized payment.

Do not store secrets in raw transaction metadata.

---

## 11. `entitlements`

```text
id
archive_id
buyer_wallet
payment_id
device_public_key
status
max_devices
devices_activated
policy_snapshot
starts_at
expires_at
created_at
```

Payment and Entitlement are separate entities.

For MVP `device_public_key` is copied from the confirmed Payment Intent and is the
only allowed Device A. It is immutable. `buyer_wallet` is copied from the
Backend-derived Payment record and is display/watermark/audit data, not a later
authentication credential.

Mandatory target key for the activation foreign key:

```text
UNIQUE (id, device_public_key)
```

---

## 12. `device_activations`

```text
id
entitlement_id
device_public_key
device_label
viewer_version
activated_at
last_seen_at
status
```

MVP max devices:

```text
1
```

Mandatory persistence invariants:

```text
UNIQUE (entitlement_id)
UNIQUE (entitlement_id, device_public_key)
FOREIGN KEY (entitlement_id, device_public_key)
  REFERENCES entitlements(id, device_public_key)
```

Create/reuse activation under a row lock or serializable transaction that also
checks active Entitlement and `max_devices=1`. Exactly zero or one activation row
may exist per Entitlement; the row key must equal the immutable pre-payment key on
Entitlement. A uniqueness conflict fails closed as `DEVICE_LIMIT_REACHED`; code
must not update the existing row to another key.

---

## 13. `device_licenses`

```text
id
entitlement_id
device_activation_id
archive_id
status
rights_json
server_signature
created_at
last_issued_at
offline_valid_until
refresh_token_hash
refresh_token_status
revoked_at
```

`device_license_request_nonces` (or an equivalent table) stores
`credential_record_id`, `request_nonce_hash = SHA256(raw 32-byte nonce)` with
mandatory `UNIQUE (credential_record_id, request_nonce_hash)` for the credential
record lifetime. Reserve it in the same issuance transaction before signing,
wrapping or refresh-token replacement.

Do not store plaintext device private key.

A new HPKE envelope is generated for each successful activation/refresh response.
Persist stable license/device/entitlement records plus signing `key_id`, latest
issuance timestamps and grant audit metadata as needed. If storing the grant,
preserve exact API v1 payload and envelope fields; `server_signature` covers both.
The signed Device License permits local offline opening until
`offline_valid_until = issued_at + 72 hours`. Encodings/canonicalization are
defined only by API.md.

`content_key_ref` resolves to Backend-only authenticated encrypted ACK custody bound to archive_id and finalized archive_fingerprint (INTEGRATION.md §5). `archive_fingerprint` is exactly 64 lowercase SHA-256 hex characters over final signed file bytes; `public_header_hash` is the same encoding over exact header bytes. Device public keys are canonical padded Base64 of 32 X25519 bytes; equality/unique constraints must reflect canonical bytes. Raw intent/refresh tokens are never stored; indexed keyed hashes, purpose-separated peppers and exact record bindings are defined in API.md §9.1. Opaque IDs, wallet addresses, payment signatures and public device keys are not credentials.

Never log plaintext content key.

---

## 14. `marketplace_events`

```text
id
archive_id
event_type
occurred_at
anonymous_session_id
payment_id nullable
metadata
```

Allowed MVP event types:

```text
archive_view
archive_download
payment_confirmed
```

`payment_confirmed` should link to verified payment where possible.

---

## 15. Analytics derivations

### Views

Count qualified `archive_view`.

### Downloads

Count qualified `archive_download`.

### Paid unlocks

Count verified `payment_confirmed`.

### Gross revenue

```text
sum(archive immutable price for confirmed payments)
```

### Creator revenue

```text
gross * 95%
```

based on stored payment intent amounts, not runtime global config.

### Platform fees

```text
gross * 5%
```

based on stored fee snapshot.

### Conversion

```text
view_to_download = downloads / views
download_to_purchase = paid_unlocks / downloads
```

If denominator = 0, return `null` or documented zero behavior.

---

## 16. Status enums

Recommended archive technical:

```text
draft
uploading
processing
ready
failed
```

Marketplace:

```text
draft
published
unpublished
blocked
```

Payment intent:

```text
created
pending
awaiting_finality
confirmed
expired
failed
```

Intent expiry stops issuance but does not override an issuance's recorded
blockhash window or an eligible `awaiting_finality` payment. Terminal `failed` is
limited to an explicit permanent pre-payment rejection after every issuance
window closes and no eligible transaction awaits resolution. Exact transitions
and reconciliation are in API.md §8.

Entitlement:

```text
active
expired
revoked
```

License:

```text
active
expired
revoked
```

---

## 17. Ownership rules

Backend checks:

```text
archives.creator_user_id == authenticated_user.id
```

for creator-only operations.

Admin moderation is separate authorization.

---

## 18. Data minimization

Do not collect personal data solely for analytics when anonymous session ID is sufficient.

Do not store:

- seed phrases;
- private wallet keys;
- device private keys;
- plaintext content keys in ordinary DB columns;
- decrypted protected file content for analytics.
