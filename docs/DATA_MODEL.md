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
buyer_wallet

expected_price_amount
currency

creator_wallet
creator_ata
creator_share_amount

platform_wallet
platform_ata
platform_share_amount

reference
status
expires_at
created_at
```

Optional:

```text
serialized_transaction_hash/reference
network
```

Payment intent is authoritative snapshot for one attempted purchase.

---

## 10. `payments`

```text
id
payment_intent_id
archive_id
buyer_wallet
transaction_signature
status
confirmed_at
raw_tx_safe_json
created_at
```

Constraints:

```text
transaction_signature UNIQUE
one confirmed payment intent → at most one entitlement for that purchase
```

Do not store secrets in raw transaction metadata.

---

## 11. `entitlements`

```text
id
archive_id
buyer_wallet
payment_id
status
max_devices
devices_activated
policy_snapshot
starts_at
expires_at
created_at
```

Payment and Entitlement are separate entities.

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

Recommended unique relation:

```text
(entitlement_id, device_public_key)
```

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
expires_at
revoked_at
```

Do not store plaintext device private key.

Wrapped content key storage strategy may be:

- generated per activation and returned;
- stored encrypted server-side if implementation requires.

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
confirmed
expired
failed
```

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
