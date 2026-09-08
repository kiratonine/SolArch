# SolArch — Shared API Contract

**Base prefix:** `/v1`  
**Transport:** HTTPS + JSON, кроме binary download/upload частей.  
**Status:** общий контракт; конкретные DTO могут уточняться только через командное изменение этого файла.

---

## 1. Общие правила

### 1.1 Identifiers

Использовать непрозрачные IDs:

```text
archive_id
upload_id
payment_intent_id
payment_id
entitlement_id
license_id
```

Клиент не должен выводить бизнес-логику из формата ID.

### 1.2 Money

USDC amounts передавать как decimal string:

```json
{
  "amount": "10.00",
  "currency": "USDC"
}
```

Не использовать JavaScript float как источник истины для финансовых вычислений.

### 1.3 Error shape

Рекомендуемый единый формат:

```json
{
  "code": "ARCHIVE_NOT_FOUND",
  "message": "Archive not found",
  "request_id": "req_..."
}
```

### 1.4 Public vs authenticated

Public endpoints не требуют creator login.

Creator endpoints требуют auth и ownership check.

В MVP buyer account/login отсутствует. Viewer не открывает SolArch auth page, не
подключает buyer wallet и не выполняет wallet challenge/signMessage для payment
activation или последующих открытий. `buyer_wallet` определяется Backend только
из authoritative подтверждённой USDC transaction и никогда не принимается от
Viewer как доказательство ownership или authorization.

---

# 2. Auth API

## POST `/v1/auth/wallet/challenge`

Request:

```json
{
  "wallet": "SOLANA_PUBLIC_KEY"
}
```

Response:

```json
{
  "challenge_id": "chl_...",
  "message": "Sign this message..."
}
```

## POST `/v1/auth/wallet/verify`

Этот endpoint относится только к creator auth. Он не используется Viewer или
покупателем при payment, activation либо refresh Device License.

Request:

```json
{
  "challenge_id": "chl_...",
  "wallet": "SOLANA_PUBLIC_KEY",
  "signature": "BASE58_OR_BASE64_SIGNATURE"
}
```

Response:

```json
{
  "authenticated": true,
  "user": {
    "id": "usr_...",
    "wallet": "..."
  }
}
```

## GET `/v1/me`

Returns current creator session.

## POST `/v1/auth/logout`

Invalidates session.

---

# 3. Creator Archives API

## POST `/v1/archives`

Creates archive record and freezes price economics.

Request:

```json
{
  "title": "Premium Course",
  "short_description": "...",
  "description": "...",
  "price": {
    "currency": "USDC",
    "amount": "10.00"
  },
  "creator_payout_wallet": "SOLANA_PUBLIC_KEY",
  "license_policy": {
    "max_devices": 1,
    "allow_export": false,
    "watermark_enabled": true
  }
}
```

Response:

```json
{
  "archive_id": "arc_...",
  "technical_status": "draft",
  "marketplace_status": "draft",
  "price": {
    "currency": "USDC",
    "amount": "10.00"
  },
  "economics": {
    "platform_fee_bps": 500,
    "creator_share": "9.50",
    "platform_share": "0.50",
    "network_fees_paid_by": "solarch"
  }
}
```

### Immutable fields

После create обычный update не может менять:

```text
price.amount
price.currency
platform_fee_bps
```

---

## GET `/v1/archives/:archiveId`

Owner-only archive detail.

## PATCH `/v1/archives/:archiveId`

Можно менять editable metadata, например:

- title;
- descriptions;
- cover;
- tags/category;
- permitted listing fields;
- 일부 policy fields only if agreed in SPEC.

Нельзя менять immutable price.

## POST `/v1/archives/:archiveId/publish`

Requirements:

```text
owner
technical_status = ready
valid payout wallet
creator USDC ATA prepared
```

## POST `/v1/archives/:archiveId/unpublish`

Owner/admin only.

## GET `/v1/archives/:archiveId/download`

Owner download of generated `.slr`.

---

# 4. Upload API

Для MVP допускается simple upload или multipart, но API должен скрывать storage implementation.

Минимальный контракт:

## POST `/v1/uploads/init`

```json
{
  "archive_id": "arc_...",
  "filename": "course.zip",
  "size_bytes": 123456
}
```

## POST/PUT upload data

Конкретный transport может быть signed upload URL.

## POST `/v1/uploads/:uploadId/complete`

Backend:

```text
validates upload
→ processing
→ ArchiveBuilder
→ ready/failed
```

## POST `/v1/uploads/:uploadId/cancel`

---

# 5. Public Marketplace API

## GET `/v1/marketplace/archives`

Query:

```text
sort=popular_week|popular_month|most_downloaded|price_asc|price_desc
search=
category=
page/cursor=
```

Response item:

```json
{
  "archive_id": "arc_...",
  "slug": "premium-course",
  "title": "Premium Course",
  "short_description": "...",
  "cover_url": "...",
  "creator": {
    "display_name": "Creator"
  },
  "price": {
    "amount": "10.00",
    "currency": "USDC"
  },
  "file_count": 14,
  "size_bytes": 9922334,
  "metrics": {
    "views": 1200,
    "downloads": 310,
    "paid_unlocks": 42
  }
}
```

## GET `/v1/marketplace/archives/:slug`

Public archive detail.

Response includes:

```text
title
description
price
creator
file count
size
access rules
metrics
public listing summary
download availability
```

## GET `/v1/marketplace/archives/:slug/files`

Returns only public listing fields:

```json
{
  "files": [
    {
      "display_path": "course/lesson-01.pdf",
      "display_name": "lesson-01.pdf",
      "extension": "pdf",
      "mime_type": "application/pdf",
      "size_bytes": 2452344
    }
  ]
}
```

## GET `/v1/marketplace/archives/:slug/download`

Requirements:

- public;
- archive must be published;
- returns generated `.slr`;
- creates qualified `archive_download` event;
- never returns source ZIP/raw files.

---

# 6. Viewer Public Metadata API

Viewer должен получать authoritative metadata до payment. `archive_fingerprint` below is a shape-only all-zero example; production returns the actual finalized-file SHA-256 from SLR_FORMAT.md. Response also requires `platform_fee_bps: 500` for snapshot comparison.

## GET `/v1/viewer/archives/:archiveId`

Availability: `technical_status=ready` + `marketplace_status=published` returns
200 publicly. Pre-payment access to unpublished/blocked/not-ready archives is
denied. During refresh, current archive state is checked by the refresh endpoint
itself; an existing buyer does not authenticate to this public endpoint.

Response:

```json
{
  "archive_id": "arc_...",
  "status": "published",
  "platform_fee_bps": 500,
  "title": "Premium Course",
  "price": {
    "amount": "10.00",
    "currency": "USDC"
  },
  "creator": {
    "wallet": "..."
  },
  "license_policy": {
    "max_devices": 1,
    "allow_export": false,
    "watermark_enabled": true
  },
  "archive_fingerprint": "0000000000000000000000000000000000000000000000000000000000000000"
}
```

---

# 7. Payment Intent API

## POST `/v1/payment-intents`

This endpoint is public and creates a device-bound purchase attempt. Closed
request:

```json
{
  "archive_id": "arc_...",
  "device_public_key": "aTZYJUYw9zrY2nj7Mxv5ds1C+Q4OnJ6D9AxRBypvdBc="
}
```

Backend validates the exact X25519 encoding from §9.2 before creating an intent.
It first requires `technical_status=ready` and
`marketplace_status=published`; otherwise it returns 403 `ARCHIVE_BLOCKED` for a
blocked archive or 404 `ARCHIVE_NOT_AVAILABLE` for draft, processing,
unpublished or missing state, without creating a record/reference/secret.
It snapshots the immutable archive price/currency/fee and finalized fingerprint,
binds the exact 32 device key bytes and generates a unique Solana payment
reference plus a fresh client secret. The binding cannot be changed by update,
retry, verification or
activation. A different device creates a different intent and payment.

Closed response:

```json
{
  "payment_intent_id": "pi_...",
  "archive_id": "arc_...",
  "archive_fingerprint": "0000000000000000000000000000000000000000000000000000000000000000",
  "device_public_key": "aTZYJUYw9zrY2nj7Mxv5ds1C+Q4OnJ6D9AxRBypvdBc=",
  "payment_intent_client_secret": "AAECAwQFBgcICQoLDA0ODxAREhMUFRYXGBkaGxwdHh8",
  "amount": "10.00",
  "currency": "USDC",
  "creator_share": "9.50",
  "platform_share": "0.50",
  "payment_reference": "REFERENCE_SOLANA_PUBLIC_KEY",
  "solana_pay_url": "solana:https://api.solarch.example/v1/solana-pay/payment-intents/pi_.../transaction",
  "created_at": "2026-09-06T19:30:00Z",
  "expires_at": "2026-09-06T20:00:00Z",
  "status": "created"
}
```

`payment_intent_client_secret` is `TOKEN32`: exactly 32 CSPRNG bytes encoded as
RFC 4648 base64url without padding, exactly 43 ASCII characters. The example is
synthetic bytes `00..1f`. It is returned exactly once over HTTPS and is never
placed in the Solana Pay QR/transaction, URL/query, `.slr`, logs, telemetry,
argv, Git or ordinary error output. Viewer keeps it in memory or Windows secure
storage only until successful initial activation, then deletes it. Backend stores
only the server representation defined in §9.1, bound to the intent and device.

Viewer must durably store this secret in Windows secure storage **before** showing
the QR or allowing payment. The secret is never re-readable from Backend. If it
is lost before first activation (device reset, uninstall, secure-store loss), the
confirmed Payment/Entitlement remains bound to Device A but automated activation
fails closed: no wallet proof/account/transaction signature may recover it, no
new device may claim it, and MVP requires a new purchase with a new intent. Refund
or support remediation is outside this wire contract and cannot issue a key.

`payment_reference` is canonical Solana Base58 decoding to exactly 32 bytes, with
decode/re-encode equality. `solana_pay_url` is the exact QR/deep-link value. Its
decoded link is the absolute HTTPS transaction-request endpoint from §7.1 for
this public opaque intent ID. The endpoint has no query string, so the canonical
form is the literal `solana:` prefix followed by that HTTPS URL without percent
encoding. If a future route adds a query string, the complete HTTPS link must be
percent-encoded as required by the Solana Pay transaction-request specification.
The URL contains no client secret, buyer wallet, device key or trusted economics.

`created_at` and `expires_at` use the exact UTC timestamp format from §9.4;
`expires_at = created_at + 1800 seconds`. This is the deadline for **issuing new
transactions**, not a finality deadline. Exact issuance, expiry and finality
semantics are in §§7.1–8. A confirmed intent remains available for its one initial
activation; its client secret remains valid through first activation and the
§9.3 10-minute lost-response recovery window, unless terminal Entitlement/archive
denial or credential revocation occurs. The recovery window starts only after
first successful activation.

Frontend/Viewer не должен менять trusted amounts/recipients.

## 7.1 GET/POST `/v1/solana-pay/payment-intents/:paymentIntentId/transaction`

This is the public Solana Pay transaction-request link encoded by
`solana_pay_url`. It never accepts or returns `payment_intent_client_secret`.
HTTPS is mandatory; redirects to another origin are forbidden. Responses use
`Cache-Control: no-store`. URL and wallet DTO behavior follows the
[Solana Pay transaction-request specification](https://github.com/solana-foundation/pay/blob/master/SPEC.md#specification-transaction-request).

GET has no request body and must not identify a wallet or user. Success is HTTP
200 with the exact Solana Pay metadata object:

```json
{
  "label": "SolArch",
  "icon": "https://api.solarch.example/assets/solarch-pay-icon.png"
}
```

`icon` is the deployment's fixed absolute HTTPS URL for an SVG, PNG or WebP
asset. GET exposes no amount, device key, buyer data, secret or entitlement state.

POST accepts the Solana Pay request object:

```json
{
  "account": "SOLANA_PUBLIC_KEY"
}
```

`account` must be canonical Solana Base58 decoding to exactly 32 bytes. It is
only the public key that the wallet offers to sign the constructed transaction.
It is untrusted transaction-construction input: it does not establish
`buyer_wallet`, ownership, payment, entitlement or Viewer authorization. For
Solana Pay forward compatibility, unknown POST fields are ignored; only
`account` affects v1 construction.

Before HTTP 200 Backend atomically locks the intent and requires `now <
expires_at`, ready/published matching archive state and available fee
sponsorship. It snapshots no new economics. It uses only the intent's immutable
USDC mint, total, exact 95/5 recipients and amounts, unique reference and Device A
binding. It obtains a fresh blockhash with Solana RPC
`getLatestBlockhash({ commitment: "confirmed" })` and stores the returned
`lastValidBlockHeight`. The `confirmed` commitment here is used only to obtain a
fresh, sufficiently rooted transaction blockhash; it is **not** the payment
authorization/finality threshold. Backend then builds a transaction whose message
contains those exact terms and whose buyer debit requires `account`, sets SolArch
as fee payer, serializes/deserializes into stable account order, and signs the
first required-signature slot with the SolArch fee-payer key before serialization. That existing fee-payer signature must be valid;
the POST `account` must be the sole remaining required signer and no other
signature may be missing. The wallet validates the untrusted transaction and the
existing signature, adds only its required `account` signature without changing
fee payer, message or recent blockhash, and submits it. A Viewer-supplied wallet
address is never involved.

Success is the exact Solana Pay response object. In v1, `transaction` is
canonical standard padded Base64 of a 1–1232 byte serialized **legacy Solana
Transaction**; strict decode/re-encode equality and no trailing bytes are
required. Its signatures array contains the valid SolArch fee-payer signature in
the first signer slot and the all-zero placeholder in the sole remaining
`account` signer slot. `message` is a 1–256 UTF-8 byte non-sensitive display
string without NUL/control characters:

```json
{
  "transaction": "BASE64_SERIALIZED_SOLANA_TRANSACTION",
  "message": "Pay 10.00 USDC to unlock this SolArch archive"
}
```

The Backend persists an issuance record before returning it: intent ID, canonical
`account`, SHA-256 of the exact serialized transaction **message bytes** (not its
signature array), recent blockhash, `last_valid_block_height`, issuance time and
state. At most one unexpired issuance may exist per intent. A repeated POST for
the same `account` while that issuance remains blockhash-valid returns the same
stored serialized transaction/response. A different `account` during that window
returns HTTP 409. Backend may build a fresh transaction only after the previous
issuance is conclusively no longer payable: either its blockhash window ended
with no eligible landing, or authoritative chain execution reached terminal
failure without transfers. The latter permits immediate replacement because that
exact transaction cannot later succeed. A dropped/reorged/non-final observation
is not terminal failure; wait until its validity window closes. Reissue is still
allowed only while `now < expires_at` and sale policy permits issuance. Thus every
new transaction gets a current blockhash without creating concurrently payable
variants.

At or after `expires_at`, GET/POST returns HTTP 410 and no new transaction,
regardless of remaining intent credential lifetime. A pre-expiry issuance remains
eligible under §8 if it lands within its own blockhash window. Solana Pay endpoint
errors use the §1.3 object (the standard wallet consumes `message`; `code` and
`request_id` are compatible additional fields). Exact mappings are: 400
`INVALID_PAYMENT_ACCOUNT`, 404 `PAYMENT_INTENT_NOT_AVAILABLE`, 409
`PAYMENT_TRANSACTION_IN_FLIGHT`, 410 `PAYMENT_INTENT_EXPIRED`, 429
`RATE_LIMITED`, and 503 `PAYMENT_TRANSACTION_UNAVAILABLE`. Error bodies and
timing must not disclose device keys, credentials or private state.

---

# 8. Payment Status / Verification API

Backend may monitor the reference itself; Viewer may submit a candidate
transaction signature. In either case Backend performs the full authoritative
verification from PAYMENTS.md and derives `buyer_wallet` from the confirmed
transaction. A wallet address supplied by Viewer is not accepted.

## POST `/v1/payment-intents/:paymentIntentId/verify`

Header:

```http
Authorization: SolArchIntent <payment_intent_client_secret>
```

Closed request:

```json
{
  "device_public_key": "aTZYJUYw9zrY2nj7Mxv5ds1C+Q4OnJ6D9AxRBypvdBc=",
  "transaction_signature": "SOLANA_TRANSACTION_SIGNATURE"
}
```

`transaction_signature` is optional only when Backend already found the unique
reference transaction; if omitted, the exact body is `{ "device_public_key":
... }`. No other optional fields exist. Intent secret authorization and an exact
constant-time comparison of decoded device key to the immutable intent binding
are required before returning payment/entitlement identifiers. A transaction
signature by itself is public data and never authorizes this endpoint.

When present, `transaction_signature` is canonical Solana Base58 decoding to
exactly 64 bytes, with decode/re-encode equality, no whitespace. Backend still
fetches and verifies the authoritative transaction; the string is only a lookup
hint.

On the first authoritative confirmation Backend atomically creates Payment and
Entitlement and fixes Device A to the intent's pre-payment device key. The payer
may be a different person/wallet; `buyer_wallet` is still the canonical fee/source
wallet derived by Backend from that transaction, while access remains on Device A.
Retries return the same records and cannot replace the key.

Backend accepts a candidate only when its fetched transaction message hash
matches a stored issuance for this intent, its immutable reference/economics/mint/
recipients/signers are exact, it succeeded, and it landed at or before that
issuance's `last_valid_block_height`. Matching an intent reference alone is
insufficient. A transaction issued before intent expiry and landed successfully within its own
blockhash window remains eligible even when Solana `finalized` commitment is
reached after `expires_at`. Intent expiry stops new transaction issuance; it does
not invalidate an already eligible landed transaction that is still progressing
toward `finalized`. Backend continues finality tracking and never expires
that accepted payment merely because wall-clock intent TTL elapsed.

Confirmed response:

```json
{
  "verified": true,
  "status": "confirmed",
  "payment_id": "pay_...",
  "entitlement_id": "ent_...",
  "archive_id": "arc_...",
  "archive_fingerprint": "0000000000000000000000000000000000000000000000000000000000000000",
  "device_public_key": "aTZYJUYw9zrY2nj7Mxv5ds1C+Q4OnJ6D9AxRBypvdBc=",
  "next_step": "activate_device"
}
```

Response pending:

```json
{
  "verified": false,
  "status": "pending"
}
```

When a matching issued transaction has landed successfully within its blockhash
window but its authoritative Solana status is not yet `finalized`, HTTP 200
returns:

```json
{
  "verified": false,
  "status": "awaiting_finality"
}
```

Exact state machine:

```text
created -> pending                 first transaction issuance
pending -> awaiting_finality      issued message landed/succeeded within its window
awaiting_finality -> confirmed    Solana confirmationStatus == finalized,
                                  meta.err == null, and all verification checks pass
created|pending -> expired        intent TTL passed and every issuance window ended,
                                  with no eligible landed transaction
created|pending -> failed         explicit permanent pre-payment rejection while
                                  no issuance can still land or awaits resolution
```

`confirmed`, `expired` and `failed` are terminal. At intent expiry Backend stops
new issuance immediately. It keeps `pending` while any pre-expiry issuance can
still land, and keeps `awaiting_finality` for an eligible landed transaction until
authoritative resolution. It marks `expired` only after all issuance windows are
conclusively closed with no eligible transaction. A message not issued by Backend,
a modified message, a reference-only/unrelated transaction, or a transaction
landed after its recorded blockhash window never creates Payment/Entitlement and
must not change intent or issuance state. Only the authoritative result for the
exact stored issued message may advance its issuance.

Verification and finalization are idempotent under one intent row lock and unique
transaction/message constraints. Polling or resubmitting the same signature
returns the same pending/awaiting/confirmed result. The single active-issuance
rule prevents two simultaneously valid server messages; exactly one confirmed
Payment and at most one Entitlement may be committed. Payment and Entitlement are
created atomically only after successful Solana `finalized` commitment, never at
issuance, submission, landing, or `awaiting_finality`.

The finalization transaction atomically sets intent `confirmed`, inserts exactly
one Payment, inserts exactly one Entitlement with immutable Device A, and writes
the durable `payment_confirmed` outbox/event record. A database/service failure
rolls back the entire commit and leaves or restores `awaiting_finality`; a
reconciler retries from the persisted issuance/reference until the atomic commit
succeeds. Such infrastructure failure never becomes terminal `failed` or
`expired`. Required uniqueness is `payments.transaction_signature`,
`payments.payment_intent_id`, and `entitlements.payment_id`; retries return the
committed records.

An administrative cancellation/block stops new issuance immediately, but cannot
make the intent terminal while any previously returned transaction can still
land or awaits resolution. Only after every such window closes with no eligible
landing may it become `failed`. If an exact pre-stop issuance lands within its
window, Backend tracks it through finality and atomically creates Payment and
Entitlement despite the later stop; current archive/license policy may separately
deny activation, but cannot erase the paid Entitlement.

A chain-failed exact issuance transfers no funds. After authoritative terminal
failure mark that issuance failed, then keep the intent pending and permit an
immediate fresh issuance before TTL/policy stop, or expire/fail it once issuance
is no longer allowed. A reorged/dropped/non-final observation is not terminal:
return to pending but do not reissue until its blockhash window closes. An exact
success observed at `awaiting_finality` stays reconcilable until authoritative
success or authoritative chain evidence that it did not finalize; internal/RPC/DB
errors remain retryable.

Backend обязан проверить все условия из `PAYMENTS.md`.

Terminal expired/failed intent returns 410 `PAYMENT_INTENT_EXPIRED` or 403
`PAYMENT_FAILED`; wrong key returns 409 `DEVICE_BINDING_MISMATCH`; bad/missing
intent secret returns 401 `INVALID_INTENT_CREDENTIAL`; pending remains HTTP 200.
No Entitlement is created before authoritative confirmation.

---

# 9. Device Activation and cryptographic wire profile

**INTEGRATION_GATE_01:** the following v1 cryptographic DTOs are exact. Buyer
accounts and wallet proof are not part of this flow.

## 9.1 Device-bound credentials

There is no buyer account/session or buyer wallet challenge. Initial activation is
authorized by the `payment_intent_client_secret` from §7 after authoritative
payment confirmation. On that activation Backend returns a separate
`device_refresh_token` to Viewer.

Both credentials are independent fresh `TOKEN32` values. Backend stores only:

```text
HMAC-SHA-256(refresh_token_pepper,
  D("SolArch/device-refresh-token/v1") || raw_token)
```

for refresh tokens, and the equivalent distinct domain
`D("SolArch/payment-intent-client-secret/v1")` with a separate pepper for intent
secrets. Peppers are Backend secret-manager values, separate by purpose. The
32-byte HMAC output is the unique indexed lookup value; after lookup Backend also
compares the stored/computed bytes in constant time. The raw token is never
stored. A database dump alone must not enable token verification. Rate-limit
failures without logging credential values.

The refresh-token record is bound at minimum to `entitlement_id`, `license_id`,
`archive_id` and exact canonical `device_public_key`, plus active/revoked state.
The intent-secret record is bound to payment intent, archive and exact device key.
The refresh token has no independent wall-clock expiry in v1; it remains usable
only while its token record, Entitlement, Device License, activation and archive
state all permit refresh. Revoke/delete its record on any terminal denial.
IDs, wallet addresses, payment/transaction signatures and public device keys are
not bearer authorization. Tokens never appear in URL/QR, `.slr`, logs, telemetry,
argv or Git. Viewer stores the refresh token through Windows secure storage and
never exports it. MVP has no device transfer/reset flow.

## 9.2 Shared primitive encodings

`B64(bytes)` means RFC 4648 §4 **standard alphabet, canonical padding**; not base64url. Decode strictly then re-encode and require byte-for-byte textual equality. No whitespace, alternate alphabet, missing/excess padding or nonzero unused pad bits. Lengths:

| Value | Raw bytes | Encoded characters |
|---|---:|---:|
| X25519 public key / HPKE enc / request nonce | 32 | 44, ends in `=` |
| Ed25519 signature | 64 | 88, ends in `==` |
| HPKE ciphertext + tag | 48 | 64, no padding needed |

Fingerprint is exactly 64 lowercase hex characters, SHA-256 of the entire finalized signed file, per [SLR_FORMAT.md](SLR_FORMAT.md#8-fingerprint). IDs use ASCII `[A-Za-z0-9_-]{1,128}` and are opaque. Key IDs use `[a-z0-9_-]{1,32}` and select the bundled **license-role** trust map. Wallets use canonical Solana Base58 decoding to 32 bytes.

Device identity is the raw 32-byte X25519 public u-coordinate in RFC 7748 little-endian representation. Generate the private key on-device with an OS CSPRNG; store with Windows secure storage. It is not an Ed25519 wallet key, MAC address or hardware fingerprint. Protocol validation additionally requires canonical u < 2^255-19 (therefore top bit zero); do not silently mask/reduce noncanonical inputs. HPKE KEM validation and rejection of all-zero DH output are mandatory for recipient keys and `enc`. Reject low-order keys before committing activation; Backend can validate via KEM setup without ever receiving a device private key. Bind and compare the exact canonical 32 bytes/B64 form.

Crypto JSON objects use RFC 8785 JCS for signature/AAD input. Reject duplicate names before object construction, unknown/missing fields, invalid Unicode, non-integral numbers, nulls and unsupported literal values. Transport whitespace/property order can vary; their JCS bytes cannot. Max Viewer payment/activation/refresh request is 4096 UTF-8 bytes, response 16384 bytes, JSON depth 8 (root object is depth 1). Numeric fields must equal their exact integer schema values; JCS canonicalizes equivalent JSON integer spellings, while strings are not coerced to numbers. Reject oversized bodies before unbounded buffering.

`TOKEN32` uses base64url without padding and is separate from `B64`; its 32 raw
bytes always encode to 43 characters using `A-Z a-z 0-9 - _`, with no `=`.

## 9.3 POST `/v1/payment-intents/:paymentIntentId/activate-device`

Header:

```http
Authorization: SolArchIntent <payment_intent_client_secret>
```

Required request fields:

| Field | Type / rule |
|---|---|
| `device_public_key` | B64 of canonical X25519 key |
| `device_name` | string, 1–128 UTF-8 bytes, no NUL/control characters |
| `viewer_version` | ASCII string `[0-9]{1,3}\.[0-9]{1,3}\.[0-9]{1,3}` |
| `request_nonce` | B64 of fresh 32 CSPRNG bytes, generated by Viewer for this request |

No optional fields. Nonce is not an authentication credential. Viewer retains it only for its outstanding request; never accepts a response for an old/completed request. Retry with a new nonce. Buyer, archive and entitlement identifiers in the response are obtained from authorized Backend records, not trusted request claims.

Every activation/refresh request nonce is single-use for its authenticated
intent/license credential. Backend stores `SHA256(raw request_nonce)` under a
mandatory unique `(credential_record_id, request_nonce_hash)` constraint for the
credential record lifetime. It reserves the nonce atomically before issuing or
rotating any P/W/token. Exact duplicate or concurrent delivery returns 409
`REQUEST_NONCE_REPLAY` with no signing, wrapping, token rotation or other side
effect. A deliberate retry uses a fresh nonce and is serialized under the same
intent/license row lock.

Backend requires confirmed payment/active Entitlement and exact match between
request, intent and assigned Device A. It never accepts a replacement device key.
It also requires the intent fingerprint to equal the ready archive/custody record
and the value previously returned to Viewer.
It atomically creates/reuses the sole activation/license and replaces any earlier
refresh-token record for this license with a freshly generated token. The intent
secret remains valid only for a bounded 10-minute activation-recovery window
after first activation. Each serialized retry during that window returns a fresh
P/W/token and atomically invalidates the previous refresh token; Backend never
stores raw tokens. After the window the intent credential is invalid. This
recovers a lost HTTPS response without creating Device B or retaining plaintext
credentials. Viewer must serialize retries and persist only the latest successful
token response.

Exact success object:

```text
{
  "license": { "payload": P, "server_signature": SIG },
  "wrapped_content_key": W,
  "device_refresh_token": TOKEN32
}
```

The refresh token is a transport credential and is deliberately excluded from P,
W and the Ed25519 signature; it is protected by HTTPS and secure storage, and its
server binding is authoritative. A complete P/W/signature vector is in
[INTEGRATION.md](INTEGRATION.md#15-deterministic-interoperability-vectors).
That vector also gives synthetic exact TOKEN32 examples; none is a production
credential.

## 9.4 Signed license payload P

All fields below are required, with no additional fields:

| Field | Type / exact semantics |
|---|---|
| `version` | integer 1 |
| `key_id` | license-role signing key ID |
| `license_id` | opaque license record ID, stable on same-device renewal |
| `entitlement_id` | authorized payment-derived entitlement ID |
| `archive_id` | finalized archive ID |
| `archive_fingerprint` | fingerprint matching the locally verified `.slr` and Backend record |
| `buyer_wallet` | canonical wallet derived by Backend from the confirmed USDC transaction and stored on Payment/Entitlement |
| `device_public_key` | canonical B64 recipient key |
| `status` | literal string `active` |
| `issued_at` | valid UTC timestamp, exact `YYYY-MM-DDTHH:MM:SSZ` |
| `offline_valid_until` | exactly `issued_at + 72 hours` (259200 seconds) |
| `request_nonce` | exact nonce of the outstanding activation/refresh request |
| `rights` | closed object `{ "open": true, "export": false, "max_devices": 1, "watermark_enabled": true }` |

Timestamps use the calendar/range rules of [SLR_FORMAT.md](SLR_FORMAT.md#3-public-header), no fractional seconds/offsets/leap seconds. `offline_valid_until` is exact UTC arithmetic from `issued_at`; no local-time/DST interpretation. No signed `expired` or `revoked` payload is issued; those are authoritative Backend record/error states, not alternate grants.

Before issuance Backend computes the proposed deadline and checks every known
authoritative Entitlement/License validity deadline. A null deadline means no
scheduled expiry; every non-null deadline must be greater than or equal to
`offline_valid_until`. Otherwise deny with `ENTITLEMENT_EXPIRED` or
`LICENSE_EXPIRED`; never shorten P below 72 hours or issue a grant that outlives a
known expiry.

A grant may be issued only while the archive is `technical_status=ready`, marketplace status is `published` or `unpublished`, and entitlement/license/activation records are active. Unpublishing removes public sale/download availability; it does not itself revoke existing paid entitlements. `blocked` archives deny issuance and renewal.

After successful activation or refresh, Viewer may validate P/SIG locally and open
the archive without Backend while `issued_at <= current UTC <
offline_valid_until`. It stores the signed license and W locally; W remains
device-bound ciphertext. Device private key and refresh token use Windows secure
storage. Plaintext ACK is unwrapped into memory only and is never persisted.

At or after `offline_valid_until`, a new unlock requires successful authoritative
refresh. Backend unavailable then means deny until refresh succeeds. A revocation
or block during the offline window is guaranteed to affect an honest Viewer no
later than the next mandatory refresh; this 72-hour delay is an explicit
practical/best-effort DRM tradeoff and cannot claw back extracted keys or images.

Viewer continuously enforces the same exclusive deadline while content is open.
No later than `offline_valid_until`, it closes protected renderers, drops
decrypted buffers and zeroizes the in-memory ACK/derived keys before further
rendering. Continued viewing requires successful refresh; leaving a renderer open
does not extend the offline window.

Viewer performs best-effort rollback detection. In protected secure storage it
maintains the greatest validated UTC observation and boot/session monotonic
sample. During a process lifetime, wall-clock movement inconsistent with elapsed
monotonic time by more than 300 seconds requires online refresh. Across restart,
a wall clock more than 300 seconds earlier than the secure high-water mark also
requires refresh. Missing/tampered rollback state, detected rollback, expired
window plus unavailable Backend all fail closed. A successful HTTPS refresh may
advance/reset the stored baseline. This is not a trusted clock and does not claim
absolute rollback resistance on a compromised device.

## 9.5 License signature SIG

Let `L = JCS(P)` and `W` be the complete envelope from §9.6. Define `Q = JCS({"payload": P, "wrapped_content_key": W})`.

Exact signed message: `D("SolArch/license-signature/v1") || Q`, where D is ASCII text followed by a single NUL byte. SIG is B64 of the 64-byte **pure Ed25519** signature over this message (RFC 8032); no prehash/Ed25519ph/context variant. The signature authenticates **both P and W**, including algorithm IDs, `enc` and ciphertext; unsigned substitution of a newly HPKE-encrypted key is not acceptable. The signature field itself is excluded. Q has no other fields. Initial activation's outer transport object additionally carries the unsigned refresh token specified in §9.3; the token is never part of Q.

Select a trusted license-role key using signed `P.key_id`; never trust a key supplied by the response. Require strict canonical Ed25519 validation (including scalar range and no small-order public/R points). Archive and license signing use different key pairs and different domains. Unknown key, bad encoding, signature failure or policy/context mismatch fails closed before unwrap.

## 9.6 Wrapped Content Key W

Construction: [RFC 9180 HPKE](https://www.rfc-editor.org/rfc/rfc9180.html), Base mode (`mode=0`), DHKEM(X25519, HKDF-SHA256) `kem_id=32`, HKDF-SHA256 `kdf_id=1`, AES-256-GCM `aead_id=2`. No PSK/auth mode, exporter, suite fallback or custom X25519/HKDF concatenation.

Closed JSON envelope fields, all required:

| Field | Type / exact value |
|---|---|
| `version` | integer 1 |
| `kem_id` | integer 32 |
| `kdf_id` | integer 1 |
| `aead_id` | integer 2 |
| `enc` | B64 of 32-byte HPKE encapsulated ephemeral public key |
| `ciphertext` | B64 of 48 bytes: 32 encrypted ACK bytes followed by 16-byte GCM tag |

`info = D("SolArch/content-key-wrap/info/v1") || SHA256(L)`.
`aad = D("SolArch/content-key-wrap/aad/v1") || L`.
Plaintext is exactly the raw 32-byte ACK, with no JSON, header or encoding.

Use HPKE SetupBaseS/SetupBaseR and one Seal/Open at sequence number 0. HPKE defines labeled extraction/expansion, salt, suite IDs, AEAD key, base nonce and sequence XOR per RFC 9180 §§4–5; do not add an external salt/IV/nonce field. Every response uses a fresh CSPRNG-generated ephemeral KEM key pair and a fresh context, performs exactly one Seal, then discards the context. Never share/reuse a sender context or deterministic ephemeral key in production. Deterministic IKM is allowed only in clearly synthetic vectors.

Ordering avoids a cycle: construct P → compute L → wrap ACK into W using L → sign Q containing both P and W. HPKE Base provides recipient confidentiality; the separate Ed25519 signature authenticates the Backend sender. JCS(P) contains archive/fingerprint/entitlement/license/device/buyer/rights/time/nonce, binding wrapping to this exact grant.

For activation, P archive/device/entitlement must equal immutable intent/payment
records. For refresh, P license/archive/device must equal the token binding and
request. `buyer_wallet` must equal the Backend-derived confirmed transaction
payer stored on Payment/Entitlement; Viewer never supplies or proves it. In both
cases require local archive ID/fingerprint, exact local device key and outstanding
request nonce; no unsolicited grant is accepted.

Viewer: bounded decode/schema checks → trusted key selection → verify Ed25519 over Q → compare outstanding nonce, local device, archive/fingerprint, rights, timestamps and authoritative state → HPKE Open → require exactly 32 plaintext bytes → use ACK in Core. A wrong private key, modified envelope, modified info/AAD or malformed/all-zero KEM result fails closed. Do not retry alternate profiles or render unauthenticated plaintext. Never log ACK, private keys or decrypted buffers.

---

# 10. Device License refresh API

## POST `/v1/device-licenses/:licenseId/refresh`

Header:

```http
Authorization: DeviceRefresh <device_refresh_token>
```

Required closed request:

```json
{
  "archive_id": "arc_...",
  "device_public_key": "aTZYJUYw9zrY2nj7Mxv5ds1C+Q4OnJ6D9AxRBypvdBc=",
  "request_nonce": "gIGCg4SFhoeIiYqLjI2Oj5CRkpOUlZaXmJmam5ydnp8="
}
```

Backend authorizes the token hash, checks its exact bound license, Entitlement,
archive and Device A key, atomically rechecks `max_devices=1` and active states,
and never changes or creates a device binding. A leaked token presented with any
other key fails before wrapping; even a response for Device A remains HPKE-bound
to Device A's private key. On success Backend returns exactly
`{"license":{"payload":P,"server_signature":SIG},"wrapped_content_key":W}`
with fresh `issued_at`, `offline_valid_until = issued_at + 72 hours`, request
nonce and fresh HPKE context. It does not return/rotate the refresh token in v1.
Refresh is allowed before the current offline deadline for an active record
(subject to rate limiting) and starts a new 72-hour window. Expiry of a signed
offline window alone does not change the server license record from `active` to
`expired`; it only makes online refresh mandatory. `LICENSE_EXPIRED` and
`ENTITLEMENT_EXPIRED` mean terminal authoritative record states and deny refresh.

Errors use §1.3. Exact mappings: 400 `INVALID_REQUEST`; 401
`INVALID_REFRESH_CREDENTIAL`; 403 `ENTITLEMENT_REVOKED`, `LICENSE_REVOKED` or
`ARCHIVE_BLOCKED`; 404 `LICENSE_NOT_FOUND`; 409 `DEVICE_BINDING_MISMATCH` or
`DEVICE_LIMIT_REACHED`; 410 `ENTITLEMENT_EXPIRED` or `LICENSE_EXPIRED`; 503
`BACKEND_UNAVAILABLE`. Initial activation additionally uses 401
`INVALID_INTENT_CREDENTIAL`, 403 `PAYMENT_NOT_CONFIRMED`, 409
`DEVICE_BINDING_MISMATCH`/`DEVICE_LIMIT_REACHED`, and 410
`PAYMENT_INTENT_EXPIRED`. Never return P/W/token on error. Error messages and
timing should not reveal whether a guessed token/ID exists beyond the stable code
needed by an already authorized client.

Both initial activation and refresh also return 409 `REQUEST_NONCE_REPLAY` for a
previously reserved nonce, after credential authentication and before any new
issuance side effect.

Credential error precedence is mandatory. Backend first performs bounded syntax
validation, then authenticates the supplied intent/refresh credential using its
keyed lookup. A missing, malformed or unmatched credential returns only the
stable corresponding 401 before resolving/exposing payment, license, archive,
device or binding state. Resource-specific 403/404/409/410 codes are available
only after credential authentication and exact record binding. Apply the same
ordering to verify, initial activation and refresh.

---

# 11. Creator Analytics API

## GET `/v1/archives/:archiveId/analytics?period=7d|30d|all`

Owner-only.

Response:

```json
{
  "period": "30d",
  "views": 12481,
  "downloads": 3204,
  "paid_unlocks": 417,
  "conversions": {
    "view_to_download": 0.2567,
    "download_to_purchase": 0.1301
  },
  "revenue": {
    "gross": "4170.00",
    "creator": "3961.50",
    "platform": "208.50",
    "currency": "USDC"
  }
}
```

---

# 12. Health

## GET `/v1/health`

Basic liveness.

## GET `/v1/health/ready`

Readiness for DB/storage/Solana dependencies as appropriate.

---

# 13. API security requirements

- payment amounts never trusted from client after archive creation;
- owner-only endpoints verify ownership on backend;
- download source files never exposed;
- transaction signature is not sufficient alone — full transfer validation required;
- device private key is never sent to backend;
- content key never appears in logs;
- internal storage keys are never public API fields.

### Solana commitment policy for MVP

Production uses the following fixed commitment semantics:

```text
processed
→ informational/pending observation only
→ never creates Payment or Entitlement

confirmed
→ transaction may be treated as observed/landed
→ intent remains `awaiting_finality`
→ never creates Payment or Entitlement
→ never authorizes Device License or Content Key release

finalized
→ authoritative payment threshold for SolArch MVP
→ still requires `meta.err == null`
→ still requires the complete transaction/message/economics/reference/signer/
  mint/device-binding/replay verification checklist
→ only then may Backend atomically commit Payment + Entitlement
```

`confirmed` used by `getLatestBlockhash` during transaction construction and
`finalized` used for payment authorization serve different purposes and MUST NOT
be conflated.

A development/mock environment may explicitly use a weaker test-only commitment,
but such a run is not a real USDC E2E result and does not change the production
contract.