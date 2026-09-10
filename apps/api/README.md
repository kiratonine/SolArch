# SolArch Marketplace Backend API (`apps/api`)

Marketplace Backend service for the SolArch platform. Built with **NestJS**, **TypeScript**, **PostgreSQL (Prisma)**, and **Solana Web3.js**.

The backend serves as the single source of truth and authoritative enforcement layer for:
- Creator authentication and archive catalog lifecycle;
- Safe upload inspection, path traversal defense, and `.slr` container generation;
- Atomic non-custodial 95/5 USDC payment transactions with SolArch fee sponsorship;
- Authoritative on-chain transaction verification and Entitlement creation;
- Hardware/Device-bound DRM licensing (RFC 8785 JCS, RFC 9180 HPKE, Pure Ed25519, 72-hour offline lease, TOKEN32 refresh credentials);
- Real-time marketplace metrics and creator revenue analytics.

---

## 1. Non-Negotiable Architectural Invariants

1. **Asset: USDC Only**: Canonical SPL token mint (6 decimals). No SOL pricing, dynamic FX, or x402.
2. **Immutable Commercial Terms**: `price.amount`, `price.currency`, and `platform_fee_bps` (500 bps = 5%) are frozen at `POST /v1/archives`. Metadata `PATCH` cannot modify financial terms.
3. **Non-Custodial 95/5 Split**: Atomic Solana transaction:
   - 95% USDC directly to Creator Associated Token Account (ATA);
   - 5% USDC directly to SolArch Platform ATA;
   - SolArch never holds custodial creator balances and performs no batch withdrawals.
4. **Fee Sponsorship**: SolArch is transaction fee payer (pays in SOL). Buyer pays 0 SOL network fee.
5. **Authoritative Backend**: Payment confirmation and license issuance are strictly executed and validated on the backend.
6. **No Buyer Accounts**: Devices generate X25519 keypairs locally; `device_public_key` (Device A) is bound to the `PaymentIntent` *before* payment.
7. **Single Device Policy**: `max_devices = 1`. Device A unlocks the archive; Device B is rejected with `DEVICE_LIMIT_REACHED`.
8. **DRM Cryptographic Profile**:
   - Canonical JSON: **RFC 8785 (JCS)**;
   - Content Key (ACK) wrapping: **RFC 9180 HPKE Base mode** (`kem_id=32`, `kdf_id=1`, `aead_id=2`);
   - Server signature: **Pure Ed25519** with role-separated License Signing Key;
   - Offline window: Exactly **72 hours** (`offline_valid_until = issued_at + 259200s`);
   - Refresh token: **TOKEN32** (32 CSPRNG bytes, unpadded base64url, 43 chars) with keyed HMAC in DB;
   - Replay protection: SHA-256 hash of `request_nonce` per credential.
9. **Archive Container Generation**: `.slr` packaging delegates to `ArchiveBuilder` with SHA-256 fingerprint over 100% of container bytes.

---

## 2. Quick Start

### Prerequisites
- Node.js 20+
- PostgreSQL (or Docker)

### Installation & Environment Setup
```bash
# In monorepo root:
npm install

# Copy environment configuration:
cp apps/api/.env.example apps/api/.env

# Start local PostgreSQL container (from root):
npm run db:up

# Generate Prisma client and apply migrations:
npm run prisma:generate --workspace apps/api
npm run prisma:migrate --workspace apps/api
```

### Running the API
```bash
# Start API in development mode (hot-reload):
npm run api

# Build API bundle:
npm run api:build

# Start production build:
npm run start:prod --workspace apps/api
```

The API will listen on `http://localhost:3000`.  
Interactive Swagger documentation is available at `http://localhost:3000/docs`.

---

## 3. Running Tests

```bash
# Run all unit and contract tests:
npm run api:test

# Run end-to-end (E2E) integration tests:
npm run test:e2e --workspace apps/api

# Run test coverage:
npm run test:cov --workspace apps/api
```

---

## 4. API Endpoints Overview

| Method | Endpoint | Description | Auth |
|---|---|---|---|
| `GET` | `/v1/health` | Service liveness check | Public |
| `GET` | `/v1/health/ready` | Database & Solana RPC readiness check | Public |
| `POST` | `/v1/auth/wallet/challenge` | Generate sign challenge for wallet | Public |
| `POST` | `/v1/auth/wallet/verify` | Verify Ed25519 signature & issue JWT | Public |
| `GET` | `/v1/me` | Current creator profile | Bearer JWT |
| `POST` | `/v1/archives` | Create archive & freeze 95/5 economics | Bearer JWT |
| `GET` | `/v1/archives/:id` | Creator archive details | Bearer JWT (Owner) |
| `PATCH` | `/v1/archives/:id` | Update metadata (immutable price protected) | Bearer JWT (Owner) |
| `POST` | `/v1/archives/:id/publish` | Verify ATA & publish archive | Bearer JWT (Owner) |
| `POST` | `/v1/archives/:id/unpublish` | Unpublish archive | Bearer JWT (Owner) |
| `POST` | `/v1/uploads/init` | Initialize archive upload | Bearer JWT (Owner) |
| `POST` | `/v1/uploads/:id/file` | Upload archive ZIP file | Bearer JWT (Owner) |
| `POST` | `/v1/uploads/:id/complete` | Traversal check, container build & ready | Bearer JWT (Owner) |
| `GET` | `/v1/marketplace/archives` | Public catalog with pagination & sort | Public |
| `GET` | `/v1/marketplace/archives/:slug` | Public archive detail & view event | Public |
| `GET` | `/v1/marketplace/archives/:slug/files` | Public file listing (safe) | Public |
| `GET` | `/v1/marketplace/archives/:slug/download`| Download `.slr` container & download event| Public |
| `GET` | `/v1/viewer/archives/:id` | Public metadata for desktop viewer | Public |
| `POST` | `/v1/payment-intents` | Pre-payment Device A binding & TOKEN32 | Public |
| `GET` | `/v1/solana-pay/.../transaction` | Public Solana Pay label & icon | Public |
| `POST` | `/v1/solana-pay/.../transaction` | Build sponsored 95/5 atomic transaction | Public |
| `POST` | `/v1/payment-intents/:id/verify` | Authoritative on-chain verify & Entitlement| `SolArchIntent` |
| `POST` | `/v1/payment-intents/:id/activate-device` | 72h offline lease, HPKE wrap & Ed25519 sign | `SolArchIntent` |
| `POST` | `/v1/device-licenses/:id/refresh` | Renew 72h lease with refresh token | `DeviceRefresh` |
| `POST` | `/v1/licenses/check` | Check license status & rights | Public |
| `GET` | `/v1/archives/:id/analytics` | Creator revenue and conversion metrics | Bearer JWT (Owner) |

---

## 5. Security Architecture

- **Zero-Secret Logging**: Content keys, private keys, wallet seed phrases, and auth tokens are strictly excluded from logs.
- **Path Traversal Defense**: Zip uploads are inspected using canonical path normalization; any attempt to write outside target directories (`..`) or absolute paths results in immediate rejection.
- **Source Protection**: Uploaded source zip files are kept in private server-side storage and never exposed to the public. The download endpoint serves only generated `.slr` containers.
- **Replay Defense**: Transaction signatures and request nonces are tracked via unique database constraints (`payments.transaction_signature` and `request_nonce_records`).
