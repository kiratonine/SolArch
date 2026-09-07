# SolArch — System Architecture

---

## 1. Архитектурная цель

SolArch состоит из трёх независимо разрабатываемых областей:

```text
Archive Core + Desktop Viewer
Marketplace Frontend
Marketplace Backend + Solana
```

Главный архитектурный принцип:

```text
Frontend and Viewer are not trusted for payment decisions.
Backend is authoritative for payment verification and access rights.
.slr is self-contained for encrypted content, but not self-authoritative for current payment/license state.
```

---

## 2. High-level architecture

```text
┌─────────────────────────┐
│ Marketplace Frontend    │
│ Next.js + TypeScript    │
└───────────┬─────────────┘
            │ HTTPS
            ▼
┌─────────────────────────┐
│ Marketplace Backend     │
│ NestJS + TypeScript     │
│                         │
│ Auth                    │
│ Archives                │
│ Uploads                 │
│ Marketplace             │
│ Payment Intent          │
│ Payment Verification    │
│ Entitlement             │
│ Device License          │
│ Analytics               │
└───────┬─────────┬───────┘
        │         │
        │         ├──────────────► Solana RPC
        │         │
        │         ├──────────────► SolArch fee payer
        │         │
        │         └──────────────► USDC accounts
        │
        ├────────► PostgreSQL
        └────────► Object Storage
                   │
                   │ generated .slr
                   ▼
            Public Download

┌─────────────────────────┐
│ SolArch Viewer          │
│ Tauri + React + Rust    │
└───────┬─────────────────┘
        │
        ├──────── HTTPS ─────────► Backend
        │
        └──────── local ─────────► .slr

┌─────────────────────────┐
│ solarch-core            │
│ Rust                    │
│ format/crypto/chunks    │
└──────────┬──────────────┘
           │
           ├── used by Viewer
           └── exposed through CLI/adapter for Backend generation
```

---

## 3. Component responsibilities

### 3.1 Marketplace Frontend

Отвечает за:

- public catalog;
- public archive page;
- creator dashboard;
- create archive UX;
- upload UX;
- public metrics rendering;
- creator analytics rendering;
- auth/session UI.

Не отвечает за:

- blockchain verification;
- private keys;
- content key;
- license signing;
- `.slr` crypto.

### 3.2 Marketplace Backend

Отвечает за:

- authentication;
- ownership;
- archive lifecycle;
- metadata;
- upload coordination;
- `.slr` generation adapter;
- public listing;
- public download;
- payment intent;
- transaction construction;
- fee sponsorship;
- payment verification;
- Entitlement;
- Device License;
- analytics;
- moderation status.

### 3.3 `solarch-core`

Отвечает за:

- `.slr` binary format;
- manifest;
- encryption/decryption;
- chunking;
- signatures;
- integrity checks;
- safe parsing.

### 3.4 SolArch Viewer

Отвечает за:

- file association;
- device key;
- secure local storage;
- locked/unlocked UI;
- payment QR client;
- license activation client;
- wrapped content key handling;
- protected rendering;
- watermark.

---

## 4. Trust boundaries

### Untrusted / partially trusted

```text
Browser frontend
Desktop Viewer runtime
User-controlled .slr file
User-controlled local filesystem
Wallet UI
Object storage as plaintext trust boundary
```

### Trusted server-side decisions

```text
archive ownership
immutable price
platform fee
payment intent
expected recipients
expected amounts
USDC mint
payment verification
entitlement issuance
device activation limits
license signing
analytics source of truth
```

---

## 5. Data authority

### `.slr` contains a signed snapshot

Public header может содержать:

- `archive_id`;
- title snapshot;
- creator snapshot;
- price snapshot;
- policy snapshot;
- API endpoints/identifier;
- fingerprint.

Но при online first unlock authoritative state получает Viewer с Backend.

Backend является источником истины для:

```text
archive exists
archive status
current moderation status
immutable price
platform fee
creator payout destination
payment state
entitlement
license state
```

---

## 6. Archive processing

```text
Creator upload
→ Backend validates upload
→ safe extraction / normalized input
→ Backend ArchiveBuilder adapter
→ solarch-cli / solarch-core
→ generated self-contained .slr
→ Object Storage
→ archive technical_status = ready
```

До merge Rust-ветки Backend может использовать mock/stub ArchiveBuilder.

---

## 7. Buyer flow

```text
Guest downloads .slr
→ opens in Viewer
→ Viewer parses public header
→ Viewer asks Backend for current archive metadata
→ Viewer requests payment intent
→ Backend builds USDC split transaction request
→ Buyer signs
→ SolArch fee payer signs/pays network fee
→ transaction submitted
→ Backend verifies chain result
→ payment_confirmed
→ Entitlement created
→ Viewer sends device_public_key
→ Device License created
→ content key wrapped to device
→ Viewer decrypts protected chunks
→ internal renderer displays content
```

---

## 8. Device model

Viewer generates:

```text
device_private_key
device_public_key
```

Rules:

- private key stays local;
- private key stored in OS secure storage;
- backend stores only public key;
- `max_devices = 1` in MVP;
- license signed by server;
- content key never stored plaintext inside `.slr`.

---

## 9. Storage model

Object storage may contain:

```text
source uploads
generated .slr
covers/previews
```

Public Marketplace must expose only controlled `.slr` download.

Original source files are not public buyer assets.

---

## 10. Failure boundaries

### Blockchain failure

Не создавать Entitlement.

### License activation failure

Payment сохраняется confirmed, но Viewer не должен открывать protected content до valid Device License.

### `.slr` corruption

Viewer останавливает parsing/decryption и показывает integrity error.

### Backend unavailable after previously activated license

Offline behavior зависит от signed license/offline policy. Для hackathon достаточно online-first operation; offline grace можно реализовать только если остаётся время.

### Archive blocked

Новые public downloads/payment intents запрещаются.

---

## 11. Shared interfaces

Главные интерфейсы между ветками:

```text
Frontend ↔ Backend:
REST API

Viewer ↔ Backend:
REST API + payment transaction payload

Backend ↔ Core:
ArchiveBuilder adapter / CLI

Viewer ↔ Core:
Rust library integration

Backend ↔ Solana:
RPC + transaction construction/verification
```

Подробности — `API.md` и `INTEGRATION.md`.
