# SolArch — Architecture & Product Decisions

Этот файл фиксирует решения, которые нельзя менять в одной ветке без согласования команды.

---

## ADR-001 — Название и формат

```text
Product = SolArch
Container extension = .slr
```

---

## ADR-002 — Self-contained container

`.slr` v1 хранит encrypted protected content внутри самого файла.

Причина: file-first distribution является ключевой ценностью.

---

## ADR-003 — USDC only

Hackathon/MVP принимает только USDC.

Не добавляем SOL price/FX, чтобы избежать oracle/quote/slippage complexity.

---

## ADR-004 — Immutable price

Цена archive фиксируется при создании.

Изменение цены требует нового archive.

---

## ADR-005 — Non-custodial creator payout

Creator предоставляет собственный Solana payout wallet.

SolArch не создаёт custodial creator wallet и не хранит creator balance.

---

## ADR-006 — 5% platform fee

```text
Creator = 95%
SolArch = 5%
```

Fee snapshot фиксируется при archive create.

---

## ADR-007 — Atomic split payment

Одна purchase transaction включает creator и platform USDC transfers.

Purchase подтверждается только при полном успешном 95/5 split.

---

## ADR-008 — SolArch pays network fees

SolArch является fee payer.

Buyer pays archive price only.

---

## ADR-009 — Automatic creator ATA

Если creator USDC ATA отсутствует, SolArch создаёт его автоматически и покрывает associated network/rent cost.

Prefer creation before publication.

---

## ADR-010 — Payment → Entitlement → Device License

Эти сущности не объединяются.

```text
Payment
→ Entitlement
→ Device License
→ Content Key access
```

---

## ADR-011 — Device key instead of MAC

Viewer генерирует asymmetric device key pair.

Private key remains local.

---

## ADR-012 — MVP max devices

```text
max_devices = 1
```

Это обязательно демонстрируется на Device A / Device B.

---

## ADR-013 — Supported protected formats

```text
PDF
PNG/JPG/WebP
DOCX
XLSX
```

No video/audio.

---

## ADR-014 — Internal protected rendering

Protected files не открываются через external applications.

Viewer renders supported formats internally.

---

## ADR-015 — Public Marketplace metrics

Visible to all:

```text
views
downloads
paid_unlocks
```

Author receives extended analytics.

---

## ADR-016 — Backend authoritative security decisions

Frontend/Viewer cannot self-confirm:

```text
price
payment
entitlement
device limit
```

---

## ADR-017 — No absolute DRM claim

SolArch provides practical DRM + device licensing + watermark.

It does not guarantee prevention of screenshots, recording, reverse engineering or photographing the screen.

---

## ADR-018 — Desktop Viewer localization

Hackathon/MVP версия SolArch Desktop Viewer поддерживает два языка:

```text
Russian
English
```

Windows installer обязан предоставить пользователю явный выбор `Русский` / `English` до установки.

Выбранный язык installer становится начальной locale Viewer и сохраняется как локальная пользовательская настройка.

Viewer должен позволять переключать язык между Russian и English после установки без переустановки приложения.

Localization распространяется на системный UI SolArch Viewer:

- locked/payment/license states;
- errors;
- dialogs;
- settings;
- internal viewer controls;
- application notifications.

Localization не изменяет protected content или creator-provided metadata.

SolArch не выполняет автоматический перевод:

```text
PDF/DOCX/XLSX content
archive title
archive description
file names
file paths
```

Language preference является локальной настройкой Desktop Viewer и не является частью `.slr` crypto format, Entitlement, Device License или Backend security decision.

Все production UI strings Viewer должны проходить через единый localization/i18n layer.


## ADR-019 — Exact `.slr` v1 bytes, signatures and resource profile

**Status:** accepted/frozen by INTEGRATION_GATE_01 external review; Core + Viewer archive verification implemented, Backend integration pending.
**Scope:** Backend, Archive Core, Windows Viewer; normative bytes in SLR_FORMAT.md.

Decision: 96-byte LE prelude, contiguous five sections, JCS header/manifest, binary IDX1 index/DAT1 data, XChaCha20-Poly1305 with HKDF-SHA-256 separate manifest/index/content keys and exact domain/nonce/AAD rules. ACK is fresh per build attempt. SIG1 is 104 bytes; pure Ed25519 signs the NUL-terminated `SolArch/slr-signature/v1` domain plus SHA-256 of every preceding byte including the 40-byte signature metadata. Final fingerprint is lowercase SHA-256 hex of the entire signed file and is absent from PublicHeader. Limits: 1 GiB finalized, 512 MiB plaintext/single file, 10000 files, 1 MiB per-file chunks, 16384 total chunks; remaining numeric caps in SLR_FORMAT are mandatory together.

Why: bounded streaming verifies large files, fixed signed ranges authenticate offsets/key selection, final-byte hashing avoids JSON/platform discrepancies and recursive fingerprint fields. Independent per-file chunks support random access. Resource caps replace inconsistent foundation constants and limit hostile metadata work.

Rejected: unspecified SHA-256/BLAKE3 choice, fingerprint inside its own preimage, signature metadata outside authentication, ordinary JSON signing, whole-file Ed25519 buffering, optional content suites/nonces selected by each implementation. This is SHA-256 plus pure Ed25519, explicitly not Ed25519ph. AEAD and file hashes have different roles from the platform signature.

MVP limitation: no compression, suite negotiation, offline trust refresh or backwards compatibility promise for foundation in-memory structs. Part 01 covers Unicode 15.1 path collision rules and strict JCS in Rust; cross-language negative fixtures remain integration work. Extension: breaking bytes/suites require a reviewed new major profile; adding a trusted public key through an authenticated release preserves v1 bytes.

## ADR-020 — Backend key custody and duplex builder signing

**Status:** accepted/frozen by INTEGRATION_GATE_01 external review; Part 01 Rust Core/CLI duplex builder and pending verifier implemented, Backend custody/orchestration pending.
**Scope:** Backend ↔ ArchiveBuilder/CLI; exact frames in INTEGRATION.md §5.

Decision: Backend CSPRNG generates 32-byte ACK per attempt. Private bounded stdin sends `SLRKEY01` + ACK, stdout returns `SLRSIGN1` + public digest, Backend independently validates pending encrypted artifact and signs, stdin sends 64 signature bytes, stdout then returns bounded public JSON. Archive signing key never enters Core child. Backend persists only authenticated encrypted ACK custody/reference bound to archive/fingerprint before publishing.

Why: Node can integrate Core without TypeScript container crypto, argv/env/sidecar leaks or giving the child a long-lived signer secret. Independent trusted Core verification of AEAD, full hashes and exact authorized source/header inventory prevents signing a merely structurally valid but incorrect build; Backend also recomputes the signing digest. The exact pending-verifier mode is in INTEGRATION.md §5.3. A signer callback provides equivalent in-process behavior.

Rejected: ACK in normal stdout/argv/environment, plaintext key files, builder-owned undisclosed key storage, passing archive signing seed to the builder, publish-before-custody, ACK reuse after failed builds. Secret-store vendor choice remains an internal Backend infrastructure choice, with mandatory authenticated encryption/access controls rather than a new public storage wire protocol.

MVP limitation: trusted same-host job/service boundary, managed runtime zeroization best-effort, no protection against compromised Backend/admin. Extension: a reviewed remote signer/worker RPC can replace local IPC without changing signed `.slr` bytes; it must preserve authorized-artifact checks.

## ADR-021 — Canonical license and HPKE device envelope

**Status:** accepted/frozen by the corrected INTEGRATION_GATE_01 review; Viewer-side Part 02 license/HPKE implementation complete, Backend issuance/integration pending.
**Scope:** Backend ↔ Windows Viewer; exact closed schemas in API.md §§9–10.

Decision: canonical X25519 raw public key, padded standard Base64; RFC 9180 HPKE Base, KEM 32 / KDF 1 / AEAD 2 (X25519/HKDF-SHA256/AES-256-GCM). One fresh context/ephemeral key and one sequence-0 seal per response. Exact JCS(P) supplies info/AAD context; pure Ed25519 signs the domain plus JCS({payload:P,wrapped_content_key:W}), including the whole wrapper. Signatures use padded Base64 (64 raw bytes), distinct license-role key and domain from archive signing. Bundled authenticated Viewer release maps select trusted keys; input-provided keys never establish trust.

Why: standardized Rust/Node-compatible wrapping avoids custom ECDH protocols, JCS fixes cross-language signature bytes, envelope coverage authenticates the HPKE Base sender and prevents wrapper substitution. Domains bind all archive/device/license/rights/time/nonce fields with no circular dependency.

Rejected: ad-hoc X25519+HKDF layout, base64/base64url alternatives, noncanonical JSON, signing only P while leaving W unauthenticated, trusting public keys in an archive, reusing archive/license private keys. Candidates are documented, not claimed universally audited; dependency/security review remains required for production.

MVP limitation: a signed license is locally valid for exactly 72 hours after
issuance. Revocation/block during that window affects an honest Viewer no later
than mandatory refresh; extracted keys cannot be recalled. Viewer stores P/W
locally, keeps private key/refresh token in Windows secure storage, never persists
plaintext ACK, and applies best-effort rollback detection without claiming a
trusted clock. Extending/changing offline duration or suites requires a reviewed
policy/schema update; production trust keys/domains still require provisioning.

## ADR-022 — Pre-payment Device A binding and device refresh credential

**Status:** accepted/frozen by external review; supersedes the former blocked
buyer-auth/session proposal.
**Scope:** Viewer Payment Intent, Payment/Entitlement, initial activation and
72-hour license refresh.

Decision: MVP has no buyer SolArch account/login/session. Viewer supplies its
X25519 public key when creating a Payment Intent; Backend immutably binds archive,
device, price, unique reference and expiry before payment. Backend derives
`buyer_wallet` only from the authoritative confirmed USDC transaction and creates
an Entitlement whose sole Device A is the intent key. Another wallet may pay the
QR without moving access to that payer's device.

Initial activation is authorized by a 256-bit intent client secret delivered only
to Viewer. It returns a separate 256-bit refresh token bound to entitlement,
license, archive and exact device key. Backend stores purpose-separated keyed
hashes, Viewer uses Windows secure storage, and refresh never replaces/creates a
device. IDs, payment signatures, wallet values and public keys alone are rejected
as authorization. MVP has no transfer/reset flow.

Why: only Device A is fixed in the Payment Intent before funds move. Entitlement
is created exclusively after authoritative payment verification/finality and
copies that binding, so no later wallet account or proof can claim another
device. HPKE still makes any returned wrapper usable only with Device A's private
key.

Payment uses a Solana Pay transaction-request URL. Backend obtains transaction
blockhashes using `getLatestBlockhash` with commitment `confirmed`; this choice is
only for fresh transaction construction and does not authorize payment. Intent
expiry stops new transaction issuance, while each issued transaction retains its
own recent-blockhash validity.

A pre-expiry issuance landed within that validity remains eligible after intent
expiry. `processed` is informational only and `confirmed` remains
`awaiting_finality`. The fixed production authorization threshold is Solana
`finalized`. Payment and Entitlement are created only after
`confirmationStatus == finalized`, `meta.err == null`, and the complete SolArch
verification checklist succeeds.

Rejected: buyer login/auth page, wallet challenge/signMessage at activation or
reopen, wallet address as ownership proof, post-payment device selection,
entitlement/license/payment IDs as bearer secrets and Device B transfer. Exact
credential formats/recovery/error handling are in API §§7–10.

MVP limitation: loss of Device A private key or refresh token has no reset path;
the user must repurchase with a new intent/device. Token theft may request a new
wrapper for Device A but cannot change the key or decrypt without Device A's
private key. Post-hackathon reset/transfer requires a separately reviewed policy.
