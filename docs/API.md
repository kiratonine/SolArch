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

Viewer должен получать authoritative metadata до payment.

## GET `/v1/viewer/archives/:archiveId`

Response:

```json
{
  "archive_id": "arc_...",
  "status": "published",
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
  "archive_fingerprint": "..."
}
```

---

# 7. Payment Intent API

## POST `/v1/payment-intents`

Request from Viewer:

```json
{
  "archive_id": "arc_...",
  "buyer_wallet": "BUYER_SOLANA_WALLET"
}
```

Response:

```json
{
  "payment_intent_id": "pi_...",
  "archive_id": "arc_...",
  "amount": "10.00",
  "currency": "USDC",
  "creator_share": "9.50",
  "platform_share": "0.50",
  "expires_at": "2026-09-06T20:00:00Z",
  "transaction": {
    "encoding": "base64",
    "serialized": "..."
  }
}
```

`transaction.serialized` представляет подготовленную backend transaction payload согласно payment implementation.

Frontend/Viewer не должен менять trusted amounts/recipients.

---

# 8. Payment Status / Verification API

В зависимости от wallet flow Backend может сам отслеживать signature или Viewer передаёт signature.

## POST `/v1/payment-intents/:paymentIntentId/verify`

Request:

```json
{
  "transaction_signature": "..."
}
```

Response success:

```json
{
  "verified": true,
  "payment_id": "pay_...",
  "entitlement_id": "ent_...",
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

Backend обязан проверить все условия из `PAYMENTS.md`.

---

# 9. Device Activation API

## POST `/v1/entitlements/:entitlementId/activate-device`

Request:

```json
{
  "device_public_key": "BASE64_OR_ENCODED_PUBLIC_KEY",
  "device_name": "Windows PC",
  "viewer_version": "0.1.0"
}
```

Response:

```json
{
  "license": {
    "license_id": "lic_...",
    "archive_id": "arc_...",
    "status": "active",
    "device_public_key": "...",
    "rights": {
      "open": true,
      "export": false,
      "max_devices": 1,
      "watermark_enabled": true
    },
    "server_signature": "..."
  },
  "wrapped_content_key": "BASE64..."
}
```

Possible error:

```json
{
  "code": "DEVICE_LIMIT_REACHED",
  "message": "This entitlement allows only one device."
}
```

---

# 10. License Check API

## POST `/v1/licenses/check`

Request:

```json
{
  "license_id": "lic_...",
  "archive_id": "arc_...",
  "device_public_key": "..."
}
```

Response:

```json
{
  "status": "active",
  "rights": {
    "open": true,
    "export": false,
    "watermark_enabled": true
  }
}
```

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
