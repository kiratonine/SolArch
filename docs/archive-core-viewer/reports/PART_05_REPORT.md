# SolArch Archive Core & Viewer — Part 05 Report

**Part:** `PART_05`
**Branch:** `integrate/marketplace-backend`
**Status:** `PARTIAL`
**Updated:** `2026-09-14`
**Execution:** strict single-agent

## 1. Scope and outcome

Part 05 requires a real Windows/Devnet integration through a deployed teammate
Backend, a Backend/Core-generated `.slr`, external-wallet test-USDC payment,
finalized verification, Entitlement, real Device License/HPKE, cached Device A
reopen and live Backend rejection on an independent Device B.

The Marketplace Backend is already present in this local working tree. This
follow-up hardened its real ArchiveBuilder, payment issuance/finality,
Entitlement/Device License authority, ACK custody and live configuration paths
without changing the reviewed Viewer/Core crypto or renderer boundaries.

The Part remains correctly **PARTIAL**, not COMPLETE: no deployed HTTPS Backend,
real Backend-generated demo archive, live role public keys, demo wallets, real
external-wallet Devnet test-USDC payment or independent Device B run was
available. No commit, push, merge, rebase or PR was performed.

### Shared-document conflicts and updates

No frozen shared document was changed. The Viewer-side implementation conforms
to the current `.slr`, API, payment, license and crypto contracts. The unresolved
general 95/5 integer-rounding policy remains an explicit integration blocker;
Part 05 uses only an exactly divisible demo price and does not redefine that
contract. The earlier static Backend blockers are superseded by the locally
integrated implementation in sections 9–13; those fixes have deterministic test
coverage but are not represented as live Devnet evidence.

## 2. Viewer-side implementation

- Added a separate Cargo `live-devnet` profile. In a non-test live build it takes
  precedence over `development-fixtures`: fixture trust and fixture Backend
  selection cannot become the payment authority. A release build that combines
  both features is rejected at compile time.
- Live archive-role and license-role public Ed25519 anchors are supplied only as
  compile-time build inputs. IDs use the frozen key-ID grammar, keys require
  canonical padded Base64, exactly 32 bytes and valid Ed25519 encodings, and the
  two roles must use different key pairs. Unknown/wrong-role keys remain denied.
- `SOLARCH_BACKEND_ORIGIN` remains immutable compile-time configuration with the
  existing HTTPS root-origin/no-redirect policy. A live profile now fails startup
  if this configuration is absent or invalid instead of silently starting with
  no Backend client.
- Cargo explicitly tracks all five live compile-time inputs so changing an
  origin or public anchor invalidates cached Viewer builds.
- Added `scripts/viewer-live-devnet-e2e.mjs` with `preflight`, `build`, `evidence`,
  `checklist` and `template` commands. It requires explicit public environment
  configuration and immediately rejects either development-fixture selector.
- Preflight authenticates the exact `.slr` through `solarch-cli verify`, compares
  its full-file SHA-256, inspects the bounded Public Header, checks exact-split
  price/policies, compares the security-critical Backend metadata, requires
  healthy Backend DB/RPC, compares the configured RPC cluster with the official
  Devnet RPC, and verifies the official mint's on-chain decimals.
- Evidence verification requires a successfully finalized payment transaction,
  checks the public reference and signer set, proves the SolArch fee payer is the
  transaction fee payer, and calculates exact buyer/creator/platform test-USDC
  deltas from integer token balances. It separately requires a finalized creator
  ATA-creation transaction paid by the same SolArch fee payer and identifies the
  newly created creator token account.
- The bounded public checkpoint JSON contains only public IDs/keys and explicit
  manual/native results. The harness never accepts intent/refresh credentials,
  private keys, mnemonics or ACK as inputs and never sends authorization headers.

## 3. Files changed

Current Backend hardening changes are in:

```text
apps/api/.env.example
apps/api/README.md
apps/api/prisma/schema.prisma
apps/api/prisma/migrations/20260913000000_harden_payment_issuance_identity/migration.sql
apps/api/prisma/migrations/20260913170000_complete_static_backend_gate/migration.sql
apps/api/src/common/viewer-request-limits.ts
apps/api/src/config/env.service.ts
apps/api/src/config/env.service.spec.ts
apps/api/src/main.ts
apps/api/src/crypto/crypto.spec.ts
apps/api/src/crypto/hpke.util.ts
apps/api/src/modules/archives/archives.service.ts
apps/api/src/modules/archives/archives.spec.ts
apps/api/src/modules/licensing/licensing.controller.ts
apps/api/src/modules/licensing/licensing.dto.ts
apps/api/src/modules/licensing/licensing.service.ts
apps/api/src/modules/licensing/licensing.spec.ts
apps/api/src/modules/payments/payments.controller.ts
apps/api/src/modules/payments/payments.module.ts
apps/api/src/modules/payments/payments.service.ts
apps/api/src/modules/payments/payments.spec.ts
apps/api/src/modules/uploads/ack-custody.service.ts
apps/api/src/modules/uploads/ack-custody.spec.ts
apps/api/src/modules/uploads/archive-builder.adapter.ts
apps/api/src/modules/uploads/archive-builder.adapter.spec.ts
apps/api/src/modules/uploads/uploads.service.ts
apps/api/src/modules/uploads/uploads.spec.ts
apps/api/test/app.e2e-spec.ts
docs/FRONTEND_BACKEND_INTEGRATION_GUIDE.md
docs/archive-core-viewer/reports/PART_05_REPORT.md
```

The existing `uuid@8.3.2` test dependency and both Jest `moduleNameMapper`
compatibility mappings were retained unchanged. No package lockfile changed.

## 4. Devnet decision and official inputs

No current shared source-of-truth document hard-codes the hackathon flow to
Mainnet. Network/mint/RPC remain Backend deployment inputs, so no shared contract
update was needed.

Immediately before validation on 2026-09-12:

- Solana's official cluster documentation identified Devnet's public endpoint as
  `https://api.devnet.solana.com`, noted its rate limits, and stated that Devnet
  tokens are not real assets: <https://solana.com/docs/references/clusters>.
- Circle's current official address list identified Solana Devnet USDC as
  `4zMMC9srt5Ri5X14GAgXhaHii3GnPAEERYPJgZJDncDU`:
  <https://developers.circle.com/stablecoins/usdc-contract-addresses>.
- Circle's current Solana transfer quickstart specifies the same mint, six
  decimals, Devnet SOL and the Circle Faucet for test USDC; it explicitly states
  that no real funds are transferred:
  <https://developers.circle.com/stablecoins/quickstart-transfer-10-usdc-on-solana>.
- A direct query to the official RPC returned current Devnet genesis hash
  `EtWTRABZaYq6iMfeYKouRu166VU2xqa1wcaWoxPkrZBG`; `getTokenSupply` for the Circle
  mint returned `decimals=6` at slot `497169618`.

The harness does not freeze a remembered RPC genesis value. It compares the
explicit Backend-team RPC against the official Devnet endpoint at run time and
checks the mint on-chain immediately before E2E.

## 5. Live Backend origin integration

The build input is:

```text
SOLARCH_BACKEND_ORIGIN=https://<deployed-root-origin>/
```

It is embedded at compile time and accepted only by the existing strict
`BackendConfig`: HTTPS, non-loopback root origin, no credentials, path, query or
fragment. Credential-bearing requests do not follow redirects. Runtime user
input cannot replace it.

No deployed HTTPS origin was present in the repository, environment or current
teammate Backend branch. Therefore no live API request was made and no origin is
claimed as integrated.

## 6. Archive and license trust anchors

### Archive trust anchor integration

The real Devnet build requires these **public-only** inputs:

```text
SOLARCH_ARCHIVE_TRUST_KEY_ID
SOLARCH_ARCHIVE_TRUST_PUBLIC_KEY_B64
SOLARCH_LICENSE_TRUST_KEY_ID
SOLARCH_LICENSE_TRUST_PUBLIC_KEY_B64
```

The archive and license maps remain separate immutable maps. Neither a `.slr`
nor a Backend response can add/replace a key. The final command is
`pnpm viewer:devnet:build`, which performs live preflight and invokes Tauri with
exactly `desktop-runtime,custom-protocol,live-devnet`, without
`development-fixtures`.

Actual public anchor IDs/keys were not supplied. A compile-only check used
synthetic public test values and is not represented as a real Devnet build.
No Backend/private signing key entered this branch.

### License trust anchor integration

The license-role key is independently configured and stored only in the
`LicenseTrustStore`; it cannot authenticate an archive signature. The live
configuration rejects missing, malformed or same-key role inputs. Because the
Backend team's real public license key was not supplied, no real P/W/SIG is
claimed as validated.

## 7. Devnet RPC, test-USDC and demo wallets

The harness requires:

```text
SOLARCH_SOLANA_CLUSTER=devnet
SOLARCH_DEVNET_RPC_URL
SOLARCH_DEVNET_USDC_MINT=4zMMC9srt5Ri5X14GAgXhaHii3GnPAEERYPJgZJDncDU
SOLARCH_USDC_DECIMALS=6
SOLARCH_BUYER_WALLET
SOLARCH_CREATOR_WALLET
SOLARCH_PLATFORM_WALLET
SOLARCH_FEE_PAYER_WALLET
```

Only public wallet addresses are accepted. Buyer and fee payer must differ;
creator and platform must differ. No live teammate RPC configuration or public
demo wallet set was supplied, so balances/funding were not checked and no test
tokens were requested. Devnet test USDC is not real money.

## 8. Fee rounding status

The general shared rounding ambiguity remains unchanged. No floor/ceil/nearest
policy was invented and no frozen money contract changed. Live preflight requires
a positive six-decimal price with `total_micro_usdc % 20 == 0`, then calculates
creator `95%` and platform `5%` exactly with integers. `10.000000 USDC` remains a
valid suggested demo price, producing `9,500,000` and `500,000` base units.

The current Marketplace creation path stores prices at two decimal places. Such
stored values are multiples of 10,000 micro-USDC and therefore always split
exactly at 5%; this is a concrete implementation constraint, not a newly frozen
shared rule. The input path still rounds a wider decimal string rather than
defining the general six-decimal rounding contract, so the shared ambiguity
remains open. The live demo stays restricted to an explicitly exact price.

## 9. Real archive builder integration

**Implemented locally; not verified live.** `ArchiveBuilderAdapter` invokes the
reviewed `solarch` CLI duplex create/pending-verifier/signing protocol, performs
independent final verification and compares the complete-file fingerprint. It
uses a fresh 32-byte ACK subsequently sealed by encrypted custody. Live startup
requires an explicit existing absolute `SOLARCH_CLI_PATH`.

Archive creation, upload completion, builder input, Payment Intent creation and
license issuance all enforce the frozen MVP policy: USDC, 500 bps, one device,
no export and watermark enabled. A real Backend-generated multi-format file has
not yet been produced in the absent live environment.

## 10. Real Payment Intent and Backend API compatibility

**Implemented locally; not run live.** Viewer metadata includes
`platform_fee_bps`; Payment Intent and confirmed verification responses contain
the frozen closed fields; typed Viewer error codes are preserved by the global
filter.

Transaction issuance is serialized with a PaymentIntent row lock. Concurrent
requests from the same construction account receive the byte-identical stored
transaction; a different account receives HTTP 409
`PAYMENT_TRANSACTION_IN_FLIGHT`. The Backend stores the exact fee-payer partial
signature/txid plus message hash and validity height. The buyer must be the sole
other signer and cannot equal the SolArch fee payer. Reference remains an
additional invariant, never transaction identity.

At/after intent TTL, both Solana Pay GET metadata and POST transaction endpoints
return exact HTTP 410 `PAYMENT_INTENT_EXPIRED` and never return a stored
serialized transaction. A transaction issued before TTL remains tracked only by
the authenticated internal verify/finality path and may still confirm after TTL
when it landed within its own block-height window. Reissue occurs only after the
exact txid is authoritatively finalized-failed or an unseen issuance is beyond
its block-height validity window. A processed/confirmed failure remains
reorgable and cannot retire the issuance, authorize replacement, or terminally
fail the intent. An unrelated submitted signature cannot mutate any issuance.

### Database migration

Migration history is append-only. The previously existing
`20260913000000_harden_payment_issuance_identity` was restored to its original
scope: only `expected_transaction_signature` and its unique index. All later
snapshot/audit columns, credential indexes, composite Device A keys/FK and
immutability triggers are in the new
`20260913170000_complete_static_backend_gate` migration.

The upgrade was executed against a disposable PostgreSQL 16 container, without
touching a working/user database. First, the three old migrations were applied,
linked pre-upgrade PaymentIntent/Payment/Entitlement/Activation/License/issuance
rows were inserted, and the new migration applied successfully with the expected
fingerprint, confirmed-buyer and Payment Device A backfills. The composite FK
and all four immutability triggers were queried from PostgreSQL. A second empty
database then passed `prisma migrate deploy`, applying all four migrations in
timestamp order. The dedicated container and both disposable databases were
removed after the check.

## 11. Real Solana transaction, 95/5, fee payer and creator ATA

No external wallet transaction was signed and these fields have no fabricated
values:

```text
transaction signature: NOT AVAILABLE
payment reference: NOT AVAILABLE
creator/platform base-unit deltas: NOT VERIFIED LIVE
fee payer: NOT VERIFIED LIVE
creator ATA address/creation signature: NOT AVAILABLE
```

The evidence command will accept completion only after `getSignatureStatuses`
reports `finalized`, `getTransaction` succeeds at finalized commitment, the
buyer loses exactly the price, creator gains exactly 95%, platform gains exactly
5%, the configured SolArch public key is account zero/fee payer, and a separate
finalized ATA transaction proves creation for the creator/mint by that fee payer.

The Backend branch has a SolArch-sponsored ATA creation path during archive
publish, but it was not deployed or exercised here and no transaction evidence
exists.

## 12. Finalized verification and Payment vs Entitlement

**Implemented locally; not verified live.** Verification accepts only the exact
canonical 64-byte Base58 txid stored for an issuance. It requires a finalized
signature status, resolves its authoritative landing height through
`getBlock(status.slot, finalized)`, and requires transaction/parsed slots to
match. Missing or unavailable status/block/transaction data is retryable and
fails closed; `getTransaction().blockHeight` is not used.

Exact message, reference, fee payer, buyer signer, mint, destinations and 95/5
`transferChecked` amounts are checked before a row-locked atomic Payment plus
Entitlement commit. That transaction atomically stores PaymentIntent
`confirmed_buyer_wallet`, Payment `device_public_key`, and matching buyer/archive/
device bindings. Idempotent verification rechecks those persisted audit bindings.
No simulation signature path can authorize payment. No live Payment/Entitlement
IDs exist yet.

## 13. Device A activation, real P/W/SIG and HPKE

**Implemented locally; not run live.** Activation and refresh issue exact-second
timestamps and enforce confirmed Payment, active/non-expired Entitlement, ready
and allowed archive, exact one-device policy and Device A binding. Recovery also
requires active DeviceActivation and DeviceLicense records and stays within the
10-minute window; revoked/expired/inactive records cannot be reactivated.

Nonce reservation, fresh recovery-token rotation and license writes are under
the same entitlement/license row lock. Concurrent fresh-nonce recovery can
return more than one HTTPS response, but only the latest returned refresh token
remains usable. Refresh reloads and validates the exact activation/license/
entitlement/archive/device binding under lock.

Encrypted ACK custody is mandatory. Missing/tampered custody fails closed and a
64-hex `contentKeyRef` is never treated as plaintext ACK. The existing Viewer
still performs strict fresh-nonce, Ed25519, binding, time and HPKE validation.

The activation route resolves Entitlement only through the exact path
PaymentIntent ID and its authenticated intent secret; an Entitlement ID is not
an alias. Malformed, noncanonical and low-order X25519 keys are HTTP 400
`INVALID_REQUEST`; HTTP 409 `DEVICE_BINDING_MISMATCH` is reserved for a valid
key that differs from authoritative Device A.

## 14. Protected viewers, watermark, cached restart and refresh

The existing Part 04 native synthetic regression passed for PDF, PNG/JPEG/WebP,
DOCX and XLSX, watermark, no-export WebView2 hardening, cached reopen and exact
deadline relock. This proves regression stability only.

The required real-license protected viewing, full process restart with the live
Backend unavailable, live mandatory refresh to a new signed 72-hour window, and
Backend-unavailable mandatory-refresh denial were **not** performed. The public
evidence schema requires all of them before `viewer:devnet:evidence` can pass.

## 15. Device B and negative live cases

An independent Windows machine/VM and live entitlement were unavailable.
Device A/B public keys do not exist for this Part, and no Backend
`DEVICE_LIMIT_REACHED` result is claimed. The local licensing path now returns
the frozen HTTP 409 typed denial and never replaces the bound Device A, but that
is deterministic coverage rather than the required independent-device proof.

The safe live negative cases (wrong fingerprint/device, replayed nonce, invalid
intent/refresh credentials, not-finalized payment, cross-archive reference,
revoked/expired state and Device B) were not sent to any service because no
dedicated deployed Devnet service was provided. Existing deterministic negative
tests remain passing but are not substituted for live evidence.

## 16. Live harness usage and required public evidence

Commands:

```bash
pnpm viewer:devnet:checklist
pnpm viewer:devnet:evidence-template
pnpm viewer:devnet:preflight
pnpm viewer:devnet:build
pnpm viewer:devnet:evidence
```

In addition to the variables already listed, preflight requires the exact
Backend/Core archive path, ID, SHA-256 fingerprint and exact-split price.
Evidence requires public payment/ATA signatures and reference plus a bounded
JSON checkpoint file. The template lists every manual/native result, including
real builder origin, Windows association, finalized-before-activation,
multi-format viewing, watermark, cached restart, refresh and independent Device
B denial. Secrets are intentionally absent from this interface.

Running preflight in the current environment returned the expected fail-closed
result:

```text
LIVE_DEVNET_E2E_BLOCKED: SOLARCH_SOLANA_CLUSTER: required
```

## 17. Security review

- No private/mnemonic/fee-payer/signing key or live credential was added.
- Live configuration embeds only public anchors and a public HTTPS origin.
- Archive and license roles remain distinct; malformed/same-key/unknown-role
  inputs fail closed.
- `live-devnet` disables fixture Backend selection. The final build command does
  not request `development-fixtures`.
- The harness uses bounded archive/HTTP/evidence inputs, refuses symlink archive
  and evidence files, follows no HTTP redirects, and reports sanitized public
  facts only.
- On-chain proof uses integer base units, finalized status, the official mint,
  exact owner deltas, reference, signers and fee payer. It does not infer
  Entitlement or License from the chain.
- Existing no-secret IPC, Rust-only ACK, no plaintext-on-disk and WebView2
  no-save/no-print controls remain unchanged and passing.
- Source/archive searches found only documented synthetic test fixtures and
  public keys; no newly committed private value exists. Generated `target`,
  `dist`, `node_modules`, screenshots and installer outputs remain ignored and
  are excluded by the clean-archive tool.

Backend live/devnet startup now requires explicit canonical mint/platform
wallet, fee payer, CLI path, role-separated matching signing keys, purpose-
separated credential/custody secrets and a canonical HTTPS root origin. Synthetic
fallbacks remain reachable only outside live mode for explicit local tests.

## 18. Final static Backend gate (A–J)

- **A — fingerprint/audit snapshot:** PaymentIntent persists the exact finalized
  `archive_fingerprint`; verify, activation, refresh, signed payload and ACK
  custody compare/use that snapshot. Finalized payment atomically records
  confirmed buyer and device audit values.
- **B — archive immutability:** upload init/completion use conditional DB claims
  and deny ready, published, unpublished, blocked, paid or already-finalized
  archives. A DB trigger independently prevents replacement of the finalized
  fingerprint, ACK custody reference or `.slr` storage key for an Archive ID.
- **C — X25519 validation:** canonical padded Base64 and field-coordinate checks
  precede an audited RFC 9180 KEM encapsulation; low-order/all-zero-DH recipients
  fail before archive lookup or PaymentIntent/reference creation.
- **D/E — Solana failure and TTL:** only a finalized exact issuance failure is
  terminal; reorgable errors keep the issuance occupied. Public Solana Pay
  endpoints return 410 at/after TTL while internal finalized tracking of a
  pre-expiry issuance continues. TTL alone does not persist `expired` while an
  issuance is payable or landed; `expired` is persisted only after the active
  issuance window is authoritatively closed. A terminal expired intent is never
  reconsidered by verify and returns 410.
- **F — DB Device A invariants:** Prisma and the new migration contain the exact
  Entitlement target key, both DeviceActivation uniqueness constraints and the
  composite foreign key with restricted updates. Entitlement and issuance
  identity fields are DB-immutable. Credential keyed hashes are unique indexed
  selectors; nonce replay retains its composite unique constraint.
- **G — routes:** only `payment-intents/:id/activate-device` and
  `device-licenses/:id/refresh` remain. The undocumented entitlement activation
  and license-check routes return 404. The activation `:id` is strictly a
  PaymentIntent ID.
- **H — final builder verify:** final `solarch verify` uses a sanitized
  environment, 300-second timeout, 4 KiB stdout cap, drained/capped 16 KiB
  stderr, forced termination and close-based reap. Full-file SHA-256 is streamed;
  unverified output and plaintext ACK are cleaned/zeroized fail closed. The
  duplex create path retains only the exact 40-byte signing frame plus at most
  4096 bytes of completion JSON; pending-build verify also enforces 4096 bytes
  while reading. Overflow kills and reaps the child. Pending-file SHA-256 is
  streamed rather than loading `.pending` into memory.
- **I — secret separation:** live startup rejects equal intent-HMAC,
  refresh-HMAC and ACK-KEK values in addition to missing/short values.
- **J — archive errors:** PaymentIntent creation maps blocked to exact 403
  `ARCHIVE_BLOCKED`; missing/draft/processing/unpublished map to exact 404
  `ARCHIVE_NOT_AVAILABLE`, before creating intent credentials or references.

- **Viewer API transport:** payment intent, verification, activation and refresh
  request bodies are parsed at a narrow pre-controller boundary with an exact
  4096-byte body cap, compressed bodies disabled, fatal UTF-8 decoding and JSON
  depth at most 8.
  Violations return HTTP 400 `INVALID_REQUEST`; no generic plaintext/secret IPC
  surface was added.

This closes the requested static Backend gate. It does not supply the real
HTTPS/Devnet evidence required to mark Part 05 complete.

### Residual external-review closure

- Payment verification and activation now authenticate the bounded TOKEN32
  credential through the unique purpose-domain `clientSecretHmac` selector and
  constant-time verification before binding the exact PaymentIntent path ID or
  disclosing payment, Entitlement or archive state. A valid credential for a
  pending payment returns exact 403 `PAYMENT_NOT_CONFIRMED`; missing, malformed,
  wrong or wrong-path credentials return a stable 401 response.
- Device License refresh follows the same authority ordering through the unique
  purpose-domain `refreshTokenHmac` selector, constant-time verification and
  only then exact license path/device/state binding. Guessed license IDs do not
  become credential authority.
- Activation recovery now requires exactly one existing active DeviceLicense
  bound to the existing active DeviceActivation. An activation with no license,
  or with multiple license records, fails closed as generic 503
  `BACKEND_UNAVAILABLE` before nonce reservation, ACK custody access, HPKE,
  signing or license/token persistence. Initial Device A activation still
  atomically creates its activation and sole license; the existing 10-minute
  recovery path for one valid active license is unchanged. The separate Device B
  error-contract question was intentionally not reinterpreted in this follow-up.
- Live/devnet startup now requires a nonblank `JWT_SECRET` of at least 32 UTF-8
  bytes. The known development fallback remains available only outside live
  mode, and the example environment contains only an empty placeholder.
- The Solana Pay transaction POST narrowly ignores unknown request fields for
  forward compatibility while still requiring and canonically validating
  `account`; every closed Viewer DTO remains under the strict global validation
  policy. E2E coverage proves a future field produces the same semantic
  transaction.
- Verify uses the exact `now >= expires_at` boundary. Stale references to the
  removed `/v1/licenses/check` route were removed from the API README and the
  non-authoritative frontend/backend integration guide; frozen API documents
  were not edited.

## 19. Tests added

- Rust: valid live role-separated public anchors; missing anchor, invalid key
  ID, malformed Base64/public key and same key pair fail closed.
- Node harness: explicit valid configuration; fixture selector, Mainnet, wrong
  mint, non-exact split, HTTP loopback origin and same role key fail closed;
  integer USDC parsing; evidence-mode public input requirements.
- Live commands expose the complete manual checkpoint template without storing
  or requesting secret credentials.
- Backend payment tests cover same/different-wallet concurrent issuance, exact
  txid persistence, fee-payer/buyer separation, malformed signatures, unrelated
  failed signatures, non-final failure retention, finalized-failure authority,
  strict endpoint TTL, retention of a still-payable issuance after TTL,
  authoritative terminal expiry, terminal-expired verify denial, internal
  post-TTL continuation, immutable fingerprint
  comparison, finalized slot-to-block-height validation, missing block data,
  HMAC-keyed PaymentIntent lookup, stable pre-auth 401 behavior, exact path
  binding, pending-payment 403 behavior and the inclusive TTL boundary.
- Licensing tests cover malformed/replayed nonce, exact device presentation
  fields, malformed/noncanonical/low-order device keys as 400, exact
  PaymentIntent-only activation lookup, revoked recovery denial, inactive
  activation refresh denial and
  serialized recovery where only the latest refresh token remains usable, plus
  purchase-snapshot mismatch denial, HMAC-keyed license lookup and wrong-token /
  wrong-path refresh denial. The missing-license recovery regression requires a
  typed failure with no response payload and asserts no nonce write, activation
  or license write, ACK unseal, HPKE wrap or license signature; the ordinary
  first-activation and active-license recovery controls remain passing.
- Archive/custody/config tests cover invalid frozen archive policy, denial of
  plaintext-hex ACK fallback, tampered/missing custody, strict public origin and
  complete role-separated live startup configuration, purpose-separated live
  secrets, finalized rebuild denial and fingerprint/ACK immutability guards.
- Final-builder tests cover sanitized process environment, bounded success
  output, final/pending/create stdout overflow, streaming pending digest,
  bounded/drained stderr, timeout and process-error kill/reap behavior. API e2e
  asserts both removed routes remain absent and rejects oversized/deep Viewer
  requests before controller dispatch. Solana Pay E2E additionally proves that
  an unknown future POST field is ignored without changing transaction
  semantics. Env tests cover missing, blank, whitespace-only and short live JWT
  secrets while retaining the explicitly non-live test fallback.

## 20. Commands and results

Backend-integration follow-up checks on 2026-09-14:

| Command | Result |
| --- | --- |
| `rtk pnpm --filter @solarch/api lint` | PASS |
| `rtk pnpm --filter @solarch/api test` | PASS, 11 suites / 111 tests |
| `rtk pnpm --filter @solarch/api test:e2e` | PASS, 1 suite / 23 tests |
| `rtk pnpm --filter @solarch/api build` | PASS |
| `rtk pnpm --filter @solarch/viewer lint` | PASS |
| `rtk pnpm --filter @solarch/viewer test` | PASS, 3 files / 34 tests |
| `rtk pnpm --filter @solarch/viewer build` | PASS, 1,873 modules and local PDF worker |
| `rtk cargo test --workspace` | PASS, 128 tests across seven suites |
| disposable PostgreSQL 16: old migrations + linked fixture rows + new migration | PASS; required audit fields backfilled, composite FK/triggers present |
| disposable PostgreSQL 16: `prisma migrate deploy` on empty database | PASS; all four migrations applied in timestamp order |
| `node --test scripts/create-clean-archive.test.mjs` | PASS, 11/11 |
| `node --test scripts/viewer-live-devnet-e2e.test.mjs` | PASS, 4/4 |
| `rtk git diff --check` | PASS |

An early supplemental `prisma validate` invocation had no `DATABASE_URL` and
returned Prisma P1012 before schema validation. It is not counted as the gate;
the real disposable PostgreSQL upgrade and `prisma migrate deploy` checks above
subsequently passed.

The complete Viewer/Core Part 05 baseline previously passed these additional
source-state checks before the Backend-only follow-up:

| Command | Result |
| --- | --- |
| `rtk cargo fmt --check` | PASS |
| `rtk cargo clippy --workspace --all-targets --all-features -- -D warnings` | PASS, no issues |
| `rtk cargo test --workspace` | PASS, 128 tests across seven suites |
| `rtk pnpm install --frozen-lockfile` | PASS |
| `rtk pnpm lint` | PASS |
| `rtk pnpm test` | PASS, 34 tests in three files |
| `rtk pnpm build` | PASS, 1,873 modules and local PDF worker |
| `rtk pnpm audit --audit-level high` | PASS, no known vulnerabilities |
| `node --test scripts/create-clean-archive.test.mjs` | PASS, 11/11 |
| `node --test scripts/viewer-live-devnet-e2e.test.mjs` | PASS, 4/4 |
| compile-only `cargo check -p solarch-viewer --features live-devnet` with synthetic public inputs | PASS |
| `cargo check --release -p solarch-viewer --features live-devnet,development-fixtures` | EXPECTED FAIL CLOSED at compile time |
| `node scripts/viewer-live-devnet-e2e.mjs checklist` | PASS |
| `node scripts/viewer-live-devnet-e2e.mjs template` | PASS |
| `node scripts/viewer-live-devnet-e2e.mjs preflight` without live inputs | EXPECTED FAIL CLOSED: required cluster missing |

One intermediate all-features clippy run found an unused test-configuration
function; its cfg was narrowed and the full final sequence above then passed.
`cargo audit` is not installed and was not run or claimed.

Frozen deterministic vectors were independently decoded and hashed:

```text
slr_v1_vector.b64: 1166 bytes
57ce84068fdd9b23f8860afa27834151f4fefb038d812c2ac77e8a861b1eecdb

slr_v1_multiformat.b64: 7655 bytes
410964651c82df094a4e2e653e9340816b0c5f0b1908343ab55b493a0c0692c4
```

## 21. Windows-native results

Actually run through native Windows tools:

- `cargo.exe test --workspace` — PASS: 10 CLI, 60 Core and 60 Viewer tests,
  including Windows Credential Manager and the new public-anchor regression.
- `cargo.exe check --manifest-path apps/viewer/src-tauri/Cargo.toml
  --all-features` — PASS.
- Native release build with
  `desktop-runtime,custom-protocol,development-fixtures` — PASS solely for the
  existing Part 04 regression smoke.
- `viewer-windows-native-smoke.ps1 -Part04DevIntegration` — PASS with
  `WINDOWS_WEBVIEW2_NO_EXPORT_PASS`,
  `WINDOWS_PROTECTED_KEYBOARD_NAVIGATION_PASS`, and
  `WINDOWS_NATIVE_PART04_DEV_INTEGRATION_PASS`.
- Direct `tauri=2.11.5` with `tauri-runtime-wry=2.11.4` built the x64 NSIS bundle
  — PASS. Frontend production build
  had already passed under pnpm; the native Tauri call skipped only its duplicate
  `beforeBuildCommand` because WSL-created `.bin` symlinks are not executable by
  Windows Node.
- `viewer-windows-installer-smoke.ps1` — PASS:
  `WINDOWS_NSIS_LANGUAGE_SELECTOR_PASS`,
  `WINDOWS_INSTALLER_RU_AND_VIEWER_SWITCH_PERSIST_PASS`,
  `WINDOWS_INSTALLER_EN_FIRST_LAUNCH_PASS`,
  `WINDOWS_FILE_ASSOCIATION_SINGLE_INSTANCE_PASS`,
  `WINDOWS_UNTRUSTED_ARGV_FAIL_CLOSED_PASS`, and
  `WINDOWS_UNINSTALL_ASSOCIATION_CLEANUP_PASS`.

The production-style installer remained intentionally untrusted toward synthetic
archives. No native `live-devnet` installer was built because embedding synthetic
anchors/origin and calling it a real demo would violate Part 05.

## 22. Deployment/E2E handoff required

The remaining handoff is operational evidence, not a Viewer contract workaround:

1. deploy this Backend at a real HTTPS root origin with secret-manager-provided
   fee-payer/custody/HMAC/private-signing configuration;
2. provide the matching public archive/license anchors and sanitized Devnet
   RPC/mint/platform/fee-payer/creator public configuration;
3. produce one exact-split multi-format archive through the real CLI adapter;
4. fund disposable Devnet wallets with clearly identified test assets and run
   the external-wallet purchase through finalized;
5. record the creator-ATA creation transaction and independent Device B HTTP 409
   `DEVICE_LIMIT_REACHED` result.

Once those inputs exist, the implemented harness can run the non-wallet checks;
external wallet approval and the two-machine UI checkpoints remain explicit
manual steps as allowed by the Part instruction.

## 23. Known limitations and not verified

- No live HTTPS Backend was contacted.
- No real Backend/Core `.slr` was produced or opened.
- No real Devnet Payment Intent, Solana Pay QR or external-wallet transaction
  occurred.
- No public Payment/Entitlement/License IDs, transaction/reference, trust-anchor
  IDs, demo wallets or watermark identity exist to record.
- No real P/W/SIG/HPKE, cached live reopen or live refresh was observed.
- No independent Device B/VM test was possible.
- The general six-decimal 95/5 rounding rule remains post-hackathon work.
- Mainnet, production RPC SLA, KMS/HSM, code signing, update and monitoring remain
  outside this Part.

These are mandatory Definition-of-Done gaps, so status remains PARTIAL.

### Mainnet and post-hackathon work

Mainnet deployment, production RPC/SLA configuration, KMS/HSM-backed signing,
code signing, updater and operational monitoring remain outside Part 05. The
general six-decimal fee-rounding rule also requires an explicit shared-contract
decision before prices that are not exactly divisible into 95/5 base-unit shares
can be integrated.

## 24. Clean review archive

The clean archive is generated after this report is saved and final checks pass.
Its path and validated content result are recorded in the delivery response to
avoid a self-referential report/archive filename. It includes current source,
tests, TODO and reports while excluding `.git`, `.codex`, `target`,
`node_modules`, `dist`, screenshots, credentials, secrets and prior archives.
