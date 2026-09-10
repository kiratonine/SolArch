# SolArch Agent Guidelines & Workspace Instructions

This document defines conventions, operational boundaries, architectural invariants, and standards for AI agents operating on the SolArch codebase, specifically within the `marketplace-backend` branch.

---

## 1. Monorepo Structure & Branch Boundaries

The repository is organized as an npm workspace monorepo:

```text
solarch/
├── apps/
│   ├── api/            # [BACKEND BRANCH OWNERSHIP] Marketplace Backend (NestJS + TypeScript)
│   ├── web/            # [FRONTEND BRANCH OWNERSHIP] Next.js Marketplace Web UI
│   └── viewer/         # [ARCHIVE CORE OWNERSHIP] Tauri + React Desktop Viewer
├── crates/             # [ARCHIVE CORE OWNERSHIP] Rust core engine & CLI
│   ├── solarch-core/
│   └── solarch-cli/
├── docs/               # Shared source-of-truth contracts & specifications
├── .agents/skills/     # Workspace skills for Antigravity agents
├── package.json        # Root workspace configuration
└── AGENTS.md           # This file
```

### Absolute Branch Rule
- **Current branch:** `marketplace-backend` (or `feat/marketplace-backend`).
- All backend work is strictly confined to `apps/api`, database schemas, migrations, backend tests, and backend agent documentation.
- Never modify or commit code into `apps/web`, `apps/viewer`, or `crates/*`.
- Never switch to other branches without explicit instruction.

---

## 2. Frozen Architectural Invariants (Non-Negotiable)

1. **Asset:** **USDC Only** (configured canonical SPL token mint with 6 decimals). No SOL pricing, dynamic FX, or x402.
2. **Immutable Pricing:** Price amount and currency are frozen at `POST /v1/archives`. Ordinary `PATCH` cannot modify price or `platform_fee_bps` (fixed snapshot at 500 bps = 5%). To change price, a new archive must be created.
3. **Non-Custodial 95/5 Split:** Every purchase is an atomic Solana transaction:
   - 95% USDC transferred directly to Creator Associated Token Account (ATA).
   - 5% USDC transferred directly to SolArch Platform ATA.
   - SolArch never holds custodial creator balances and does not perform batch withdrawals.
4. **Fee Sponsorship:** SolArch is the Solana transaction fee payer (pays network fee in SOL). Buyer pays 0 SOL network fee.
5. **Authoritative Backend:** Neither frontend nor desktop viewer are trusted for financial or licensing decisions. Payment confirmation and license issuance are strictly executed and validated on the backend.
6. **No Buyer Accounts in MVP:** The buyer does not register or log in with a wallet. The device creates an X25519 keypair locally; `device_public_key` (Device A) is bound to the `PaymentIntent` *before* payment.
7. **Single Device Policy:** `max_devices = 1`. Device A unlocks the archive. Device B is rejected with `DEVICE_LIMIT_REACHED`.
8. **DRM Cryptographic Profile:**
   - Canonical JSON serialization: **RFC 8785 (JCS)**.
   - Content Key (ACK) wrapping: **RFC 9180 HPKE Base mode** (KEM: DHKEM-X25519 `kem_id=32`, KDF: HKDF-SHA256 `kdf_id=1`, AEAD: AES-256-GCM `aead_id=2`).
   - Server signature: **Pure Ed25519** with role-separated License Signing Private Key.
   - Offline window: Exactly **72 hours** (`offline_valid_until = issued_at + 259200s`).
   - Refresh token: **TOKEN32** (32 CSPRNG bytes, unpadded base64url, 43 chars). Keyed HMAC stored in database.
   - Replay protection: Unique SHA-256 hash of `request_nonce` per credential.
9. **Archive Container Generation:** The backend delegates `.slr` packaging to `ArchiveBuilder` (CLI adapter for `solarch-cli`). It does not reimplement the binary `.slr` container format in TypeScript.

---

## 3. Security & Operational Rules

- **Zero-Secret Logging:** Never log private keys, content keys, plaintext passwords, auth tokens, or seed phrases.
- **Path Traversal Defense:** Reject uploaded zip files containing directory traversal (`../`), excessive nesting, or executable content.
- **Source Protection:** Never expose original uploaded archives (ZIP/RAR) or raw files via public endpoints. The public download endpoint `/v1/marketplace/archives/:slug/download` serves *only* generated `.slr` files.
- **Windows Path Handling:** Always use forward slashes in URLs and normalize Windows filesystem paths (`\` vs `/`).

---

## 4. Key Developer Commands

```bash
# Start local PostgreSQL container
npm run db:up

# Start API in development mode
npm run api

# Run API tests
npm run api:test

# Build API bundle
npm run api:build
```
