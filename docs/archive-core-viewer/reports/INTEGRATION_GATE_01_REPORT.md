# INTEGRATION_GATE_01 Report

**Status: COMPLETE**

**Date:** 2026-09-08

**Branch:** `feat/archive-core-viewer`

**Owner:** Main Orchestrator

## Purpose and outcome

Backend ↔ Archive Core ↔ Windows Viewer cryptographic and wire contracts are
frozen at documentation level. External review replaced the earlier buyer-session
proposal with immutable pre-payment Device A binding, device credentials and a
signed 72-hour offline license. A later payment-contract review replaced the
intent-wide serialized transaction with an exact Solana Pay transaction-request
and separated intent issuance expiry from transaction validity/finality. The
corrections are integrated and independently reviewed. No security-critical wire
ambiguity remains.

This status means the documentation gate is complete. It does not claim that
Backend, Viewer, production `solarch create/verify`, secure storage or payment
code exists. Part 01 remains implementation-PARTIAL and Part 02 was not started.

## Source material reviewed

Read: applicable personal/root `AGENTS.md`, `TODO/INTEGRATION_GATE_01.md`, project
agent profiles, current README/SPEC/ARCHITECTURE/API/SLR_FORMAT/DATA_MODEL/
PAYMENTS/SECURITY/INTEGRATION/TESTING/DECISIONS docs, Archive/Viewer and Backend
role docs, Part 01 report and relevant current Core/CLI constraints. Historical
`docs/context/SolarArchive_*` files were not used as current authority.
The public GET/POST and conditional URL-encoding shape was checked against the
[Solana Pay transaction-request specification](https://github.com/solana-foundation/pay/blob/master/SPEC.md#specification-transaction-request).

## Files changed

- `docs/SLR_FORMAT.md`: exact v1 bytes, content encryption, signature,
  fingerprint, limits and offline-open validation order.
- `docs/API.md`: exact device-bound Payment Intent, public Solana Pay GET/POST,
  issuance/finality/reconciliation, verification, activation, credentials,
  signed license, HPKE and refresh DTO/errors.
- `docs/PAYMENTS.md`: Backend-derived payer, pre-payment device/reference binding,
  transaction-request issuance, finality-after-expiry and atomic Entitlement.
- `docs/SECURITY.md`: role trust, token/oracle protection and 72-hour
  offline/rollback/revocation tradeoff.
- `docs/INTEGRATION.md`: safe ACK/signing/verifier IPC, Viewer integration and
  corrected deterministic vectors.
- `docs/DATA_MODEL.md`: immutable Device A, credential hashes, nonce ledger,
  one-activation constraints and offline license fields.
- `docs/DECISIONS.md`: ADR-019–021 retained; ADR-022 replaced with the approved
  pre-payment binding/device-credential decision.
- `docs/ARCHITECTURE.md`, `docs/TESTING.md`, and both Archive/Viewer and Backend
  role docs: flow/test/ownership consistency.
- This report was updated in place. `AGENTS.md` and `.gitignore` were unchanged.

## Contracts frozen

### Existing crypto contracts retained

- Final archive fingerprint is lowercase SHA-256 hex over every finalized `.slr`
  byte including signature; it is immutable and absent from PublicHeader.
- Exact 104-byte SIG1 block; pure Ed25519 signs the distinct container domain plus
  streamed SHA-256 through signature metadata, excluding only final signature.
- Fresh 32-byte ACK per build attempt; HKDF-SHA-256-separated manifest/index/
  content keys and exact XChaCha20-Poly1305 nonce/AAD rules.
- Bounded private ACK/signing IPC, Backend-owned signing key, trusted pending Core
  verification and no secret in argv/env/log/stdout/sidecar/container.
- Coherent v1 limits: 1 GiB final, 512 MiB plaintext/single file, 10000 files,
  1 MiB chunks, 16384 chunks and exact metadata/path limits.
- Canonical X25519 device key, RFC 8785 JCS license, separate Ed25519 license
  key/domain, RFC 9180 Base HPKE X25519/HKDF-SHA256/AES-256-GCM, bundled
  role-specific Windows trust maps and established rotation rules.

### Corrected payment and authorization model

- Viewer sends `archive_id + device_public_key` to a public Payment Intent
  endpoint only for a ready/published archive. Backend immutably binds intent,
  archive/fingerprint, Device A, USDC economics, unique Solana reference and exact
  30-minute payment deadline before QR/payment.
- A 32-byte/43-character unpadded base64url intent credential is returned only to
  Viewer over HTTPS and stored in Windows secure storage before QR display. It is
  excluded from QR/URL/logs/telemetry/argv/Git and represented server-side by a
  purpose-separated keyed HMAC lookup.
- Backend validates the full authoritative USDC transaction and derives
  `buyer_wallet` from its single debited source owner/authority. Another wallet
  may pay Device A's QR without moving access. Viewer-supplied wallet is never
  proof or authorization.
- Payment → Entitlement atomically copies immutable Device A. Persistence mandates
  `UNIQUE(entitlement_id)`, a composite Entitlement target key/FK, and row-lock or
  serializable enforcement. Post-payment replacement and Device B reuse fail.
- Initial activation uses the intent credential and returns signed P, HPKE W and a
  separate random 256-bit refresh token. Lost intent credential before activation
  has no wallet/account recovery and fails closed; MVP requires a new purchase.
- Refresh token uses the same exact TOKEN32 transport, Windows secure storage and
  purpose-separated HMAC model. Server record binds entitlement, license, archive
  and exact Device A. It cannot create/replace a device. There is no buyer account,
  auth page, wallet reconnect/signMessage, device transfer or reset.
- IDs, payment signatures, wallet values and public keys are not bearer
  credentials. Credential authentication precedes resource-specific lookup/error
  disclosure. Activation/refresh nonces are single-use per credential: atomic
  SHA-256 nonce ledger uniqueness rejects duplicates with
  `REQUEST_NONCE_REPLAY` before P/W/token side effects.

### Corrected Solana Pay lifetime and finality contract

- Payment Intent response returns exact `solana_pay_url` plus the private
  `payment_intent_client_secret`; it contains no serialized transaction. The
  secret is absent from QR/URL and the public transaction-request endpoint.
- QR is `solana:<absolute HTTPS endpoint>` without encoding while the exact route
  has no query. Public GET returns label/icon; POST accepts wallet `account` only
  as untrusted construction input and returns a canonical Base64 legacy Solana
  transaction plus bounded message.
- Backend returns at most one blockhash-valid issuance. It must carry a valid
  first-slot SolArch fee-payer signature; wallet `account` is the sole missing
  signer. Same-account POST is byte-idempotent. Replacement uses a current
  blockhash only after the prior transaction can no longer pay.
- The 30-minute intent deadline stops new issuance. A pre-expiry transaction
  landed within its own `lastValidBlockHeight` is tracked through authoritative
  finality after the wall deadline. `pending`, `awaiting_finality`, `confirmed`,
  `expired` and narrowly defined `failed` transitions are exact.
- Message hash plus full economics/reference/signers bind verification to a
  stored issuance. Unissued, modified, late or reference-only transactions have
  no state effect. Authoritative terminal chain failure permits reissue; dropped,
  reorged or non-final observations wait for their old window to close.
- Final confirmation atomically commits intent, one Payment, one Entitlement with
  Device A and a durable event under unique constraints. DB/service failure stays
  retryable `awaiting_finality` for reconciliation. Cancellation/block stops new
  issuance but cannot become terminal until every live window closes; an eligible
  pre-stop landing still receives Payment/Entitlement after finality.

### Corrected 72-hour license

- Closed signed P contains `issued_at` and
  `offline_valid_until = issued_at + 259200 seconds`; old `not_before`, short
  `expires_at` and 300-second online-only lease were removed.
- Backend issues only ACTIVE grants and refuses a proposed window that would
  exceed any known Entitlement/License expiry. Revoked, expired, blocked, wrong
  device and device-limit states deny with exact API errors.
- Viewer locally stores signed P/W; private key and refresh token use secure
  storage, while plaintext ACK stays in memory only. Before the exclusive
  deadline it may open fully offline.
- At the deadline Viewer continuously closes protected renderers, drops plaintext
  and zeroizes ACK/derived keys. A new unlock requires authoritative refresh;
  unavailable Backend denies. Keeping a renderer open cannot extend the window.
- Revocation during the offline window applies to an honest Viewer no later than
  mandatory refresh. Best-effort monotonic/secure UTC high-water checks use a
  300-second rollback tolerance without promising a trusted clock or absolute DRM.

## Deterministic interoperability vectors

`docs/INTEGRATION.md` §15 contains complete synthetic container, device, license,
HPKE, signature and TOKEN32 values. Container bytes are unchanged: 1166 bytes,
fingerprint
`57ce84068fdd9b23f8860afa27834151f4fefb038d812c2ac77e8a861b1eecdb`.

The corrected P uses `offline_valid_until=2026-09-10T00:00:00Z`. Recalculated
license-bound results:

- HPKE ciphertext:
  `GO7bNoKdgUkCfV0rm1B3O7zAZPDfjLgoajBypokNP5+GsUXCjUMLys2HbagyFi6I`;
- signed message: 812 bytes; SHA-256
  `17ae2291fde9757ddbae9a07913c3c068a246d6b7971041468d2dce2f7ad187a`;
- Ed25519 signature:
  `wLcOtVg7S0qywsufOSmRTPHACKPxVTO5qYivffQ5Xk0ylSvAjIV7b5u4LlnEycUM++zQ/5d5nMr4tTUaiWg1BA==`.

All keys/tokens are obvious synthetic arithmetic test data and cannot be used as
production credentials or trust anchors.

## Sub-agents and review

- `contract_reviewer` (`gate_contract_audit`) reviewed the corrected contract. It
  found and Main fixed intent-secret-loss behavior, credential-first error
  precedence, mandatory one-device enforcement and PostgreSQL composite FK target
  validity. During the payment correction it found and Main fixed the mandatory
  fee-payer signature and landed-failure reissue rule. Final bounded re-review:
  PASS.
- `test_security_reviewer` (`gate_security_review`) found and Main fixed known
  server-expiry overlap, running-renderer deadline enforcement, direct intent
  availability, credential recovery wording, response-vector shape and duplicate
  nonce concurrency. During the payment correction it found and Main fixed
  finalized-payment commit recovery, public-reference state-change DoS and the
  cancellation-versus-live-issuance race. Final bounded re-review: PASS, with no
  remaining critical security or interoperability ambiguity.

Sub-agents were read-only, created no files and did not choose competing shared
protocols. Main Orchestrator owns all edits/integration/final checks.

## Validation

- `node /tmp/solarch-gate01/vectors.mjs` — exit 0: corrected P/W/signature
  generated; six negative cases denied; `.slr` 1166 bytes and fingerprint
  unchanged.
- `cargo run --manifest-path /tmp/solarch-gate01/rust/Cargo.toml --quiet` — exit 0:
  independent Rust matched Node JCS, content AEAD, fingerprint, both Ed25519
  signatures, device derivation and HPKE Open; four negative cases denied.
- `python3 /tmp/solarch-gate01/check_docs.py` — exit 0: 12 docs-only changes, all
  22 implementation hashes unchanged, 14 local links/anchors, 30 JSON blocks,
  zero stale gate placeholders; documented vectors, encodings, layout, limit
  arithmetic, PNG CRC and TOKEN32/72-hour payload checks matched.
- `git diff --check` — exit 0 with no diagnostics.
- `git diff --no-index --check /dev/null
  docs/archive-core-viewer/reports/INTEGRATION_GATE_01_REPORT.md` — exit 1 with
  empty output: file differs from `/dev/null`, with no whitespace diagnostics.
- Rejected short-license/AUTH term and stale crypto-placeholder `rg` searches over
  authoritative docs (excluding historical context/reports) — exit 1 with empty
  output, meaning zero matches.
- Payment-specific stale-contract search for intent-wide serialized transaction,
  finality-at-intent-expiry, pre-payment buyer wallet and the superseded ADR phrase
  — exit 1 with empty output, meaning zero prohibited matches. Positive contract
  search confirmed the Solana Pay URL, issuance validity, `awaiting_finality`,
  atomic uniqueness and no-state-effect rules across source-of-truth docs.
- Complete `git diff`/status inspection confirmed only the listed Markdown docs
  and this report are changed; no feature implementation.
- Baseline SHA-256 comparison covers 22 implementation/Cargo/script files; no
  feature code or project dependency/lockfile changed.

Temporary vector tooling/dependencies exist only under `/tmp/solarch-gate01`.
Node used pnpm 10.32.1 with `@hpke/core` 1.9.0,
`@hpke/dhkem-x25519` 1.8.0, `@noble/ciphers` 2.4.0 and `canonicalize` 4.0.0.
Independent Rust used hpke 0.13.0, chacha20poly1305 0.10.1, hkdf 0.12.4, sha2
0.10.9, ed25519-dalek 2.2.0 and serde_jcs 0.1.0.

No repository Markdown/package checker exists. Workspace fmt/clippy/tests, Viewer
build and Windows-native tests were not run because this continuation changes
documentation only. The existing Node and independent Rust vector checks were
rerun and remained byte-identical; no vector was edited. Prior Part 01 results are
not reused as current pass claims.

## Remaining issues and cross-branch actions

No security-critical documentation blocker remains. Production provisioning of
role-separated signing/trust keys, token peppers, trusted Backend origins and
authenticated release data is future deployment work, not an ambiguous wire
decision.

After approval of this COMPLETE gate, Backend must implement exact payment/device
records, tokens, atomic constraints and license/HPKE issuance. Core/Viewer must
later implement reviewed serialization/verifiers, secure storage, offline clock/
deadline behavior and shared fixtures under separately authorized Part scope.
Native Windows and real USDC Device A/Device B E2E remain unverified.

No Backend, Viewer, payment, production create/verify, secure-storage or Part 02
feature code was implemented. No commit, push, merge, rebase, reset, clean or PR
was performed.

## Manual external-review commitment clarification — 2026-09-08

After the final external review, one remaining documentation ambiguity was
resolved manually without another AI-agent implementation cycle.

The production Solana commitment contract is now explicit:

```text
transaction construction:
getLatestBlockhash commitment = confirmed

processed:
informational/pending only

confirmed:
awaiting_finality only

authoritative payment threshold:
confirmationStatus = finalized
```

Payment/Entitlement creation additionally requires `meta.err == null` and the
complete SolArch transaction verification checklist.

The distinction is intentional: `confirmed` is used for fresh transaction
construction, while `finalized` is required before irreversible protected-content
authorization.

This manual clarification changes documentation only. It does not modify `.slr`,
crypto vectors, Device A binding, TOKEN32 credentials, 72-hour offline license,
HPKE, Content Key handling or production feature code.

External reviewer status after this clarification: **PASS for
INTEGRATION_GATE_01 documentation contract**, subject to the manual consistency
checks recorded below.
