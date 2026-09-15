# SolArch Archive Core & Viewer — Part 05 Report

**Part:** `PART_05`
**Branch:** `integrate/marketplace-backend`
**Status:** `COMPLETE — FUNCTIONAL/E2E PASS`
**Updated:** `2026-09-16`
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

The Part is now **COMPLETE for the hackathon/MVP functional and E2E scope**.
A real Backend instance, disposable PostgreSQL 16 database, Devnet RPC, transient
public HTTPS origin, real role-separated signing keys, real Backend/Core
multi-format archive, live public trust anchors, demo wallets and sponsored
creator-ATA creation were integrated and verified.

The primary Device A flow completed end to end: an external wallet submitted the
real test-USDC purchase, Backend verified the finalized transaction, committed
distinct Payment and Entitlement records, issued a signed device-bound license
plus HPKE-wrapped Archive Content Key, and the installed Windows Viewer rendered
PDF, PNG, DOCX and XLSX with watermark and no protected export path. Cached
reopen succeeded both online and while Backend was unavailable. The isolated
debug-only live-E2E clock then verified both mandatory-refresh branches while
preserving the exact 259200-second signed window.

The remaining external-review gap was subsequently closed on an independent
Windows VM. Device B used a distinct secure store and X25519 public key, opened
the same exact `.slr` as Locked, and never obtained protected content. A
coordinated real Devnet security-test purchase bound to Device A provided an
authenticated activation credential; presenting the independent Device B key
returned HTTP 409 `DEVICE_BINDING_MISMATCH`. Database inspection showed zero
Device B activation rows and zero Device B license rows, and the Viewer remained
Locked. The authenticated live negative matrix was completed and the final
`viewer:devnet:evidence` run exited successfully with code 0.

This is a functional/E2E PASS for the Part 05 hackathon/MVP scope, not a claim of
production DRM perfection or a clean dependency audit. Recorded dependency,
deployment and post-hackathon residuals remain in section 23. No development
fixture became authority. No commit, push, merge, rebase or PR was performed.

### External-review follow-up: deterministic mandatory refresh

- Viewer adds an opt-in `live-e2e-clock` Cargo feature. It requires `live-devnet`,
  accepts only canonical bounded Unix seconds, and is a compile-time error in a
  release build. The native evidence build was debug-only and omitted
  `development-fixtures`, so it retained the real HTTPS Backend and real public
  archive/license anchors.
- Backend issuance obtains time through `EnvService.currentTime`. An override is
  accepted only for the conjunction `NODE_ENV=test`, `SOLANA_LIVE_DEVNET=true`
  and `SOLANA_NETWORK=devnet`; explicit live mode still runs the complete live
  key/secret validation. Missing, malformed, production or non-Devnet override
  configurations fail startup/issuance closed.
- Viewer app-data and Windows Credential Manager namespaces are separately
  scoped only in that debug feature. Both an absolute app-data override and a
  canonical credential scope are mandatory at startup; missing or malformed
  isolation inputs fail closed and cannot fall back to the ordinary Viewer
  profile. Two byte-identical, in-memory credential copies and app-state copies
  were made before advancing logical time; no private key, refresh credential or
  ACK was printed or written to evidence/report.
- The old signed window remained exactly 259200 seconds. At one minute after its
  deadline, the online snapshot used the real refresh credential and Backend
  authority to retain `lic_b908b32360074d74` while replacing its signature and
  HPKE envelope. The new window is also exactly 259200 seconds and protected PDF
  plus watermark opened. The separate offline snapshot exposed no protected file
  table. No snapshot clock was moved backwards.

### Live Devnet follow-up: landing-block metadata regression

- A later real finalized test-USDC transaction reproduced an RPC interoperability
  regression while verifying its already-issued transaction: the target payment
  was a supported v0 transaction, but the finalized landing block also contained
  an unrelated v1 transaction. Asking `getBlock(slot)` for the entire block with
  `maxSupportedTransactionVersion: 0` therefore failed before the authoritative
  `blockHeight` could be read.
- The landing-slot request now explicitly asks only for finalized block metadata
  with `transactionDetails: 'none'`, `rewards: false`, and
  `maxSupportedTransactionVersion: 1`. The exact target
  `getParsedTransaction()` and `getTransaction()` calls remain capped at version
  0. Txid, serialized-message hash, reference, signer, mint, destination, 95/5,
  finality and landing-height checks are unchanged.
- No new Payment Intent or transaction was created for the retry. Backend was
  rebuilt and restarted against the same disposable live database/environment;
  the retained mode-0600 intent credential was consumed only in process and was
  not printed. Re-verification of PaymentIntent
  `9510e226-b5a7-4b94-b31a-d3e86450fefd` and its already-submitted transaction
  `3pdqMKh1Vws21KKzrk6WjtcrfH9sHUN9PQqeBvSiPjybRMv3rPH9EtiMXV2dptjQQfoTENZ9VFxECFGwxQVU1Fot`
  returned HTTP 200 `confirmed`. Database state then showed issuance `consumed`,
  Payment `4b36375c-fe9d-4955-b690-a1a871288165`, and Entitlement
  `e2e3d613-4474-4585-9f98-ec8f966e8926`.

### Final external-review closure: independent Device B and live negative matrix

An independent Windows VM was used as Device B with its own application data,
Windows secure-store namespace and freshly generated X25519 key.

```text
Device A:
Y9W1I6ifJsJWzibkr1zDrh7/LxvTWgMHnj84Rw4uoGI=

Device B:
ALzIOw8z9UQNnJuYC17HEUiWQoiH5+Pj8curIrvZqyE=
```

The keys were distinct. The exact same authenticated archive remained Locked on
Device B and exposed no protected file table or protected content.

A separate disposable Devnet security-test purchase was intentionally used only
to obtain a legitimate authenticated activation/recovery path without modifying
the retained primary evidence purchase:

```text
PaymentIntent: 9510e226-b5a7-4b94-b31a-d3e86450fefd
transaction: 3pdqMKh1Vws21KKzrk6WjtcrfH9sHUN9PQqeBvSiPjybRMv3rPH9EtiMXV2dptjQQfoTENZ9VFxECFGwxQVU1Fot
Payment: 4b36375c-fe9d-4955-b690-a1a871288165
Entitlement: e2e3d613-4474-4585-9f98-ec8f966e8926
Device A security-test license: lic_22d778abf2f241e8
```

The retained transaction initially exposed a real RPC interoperability regression
because its finalized landing block contained an unrelated v1 transaction. After
the metadata-only `getBlock` fix, the exact same PaymentIntent/transaction
verified as HTTP 200 `confirmed`; no replacement payment was created for that
retry.

The live authenticated negative matrix then passed:

```text
wrong intent credential        -> HTTP 401 INVALID_INTENT_CREDENTIAL
wrong refresh credential       -> HTTP 401 INVALID_REFRESH_CREDENTIAL
unknown archive                -> HTTP 404 ARCHIVE_NOT_AVAILABLE
not-finalized activation       -> HTTP 403 PAYMENT_NOT_CONFIRMED
nonce replay                   -> HTTP 409 REQUEST_NONCE_REPLAY
independent Device B           -> HTTP 409 DEVICE_BINDING_MISMATCH
cross-archive binding attempt  -> HTTP 409 DEVICE_BINDING_MISMATCH
revoked license authority      -> HTTP 403 LICENSE_REVOKED
expired entitlement authority  -> HTTP 410 ENTITLEMENT_EXPIRED
```

For the independent Device B attempt, database inspection returned:

```text
device_b_activations = 0
device_b_licenses = 0
```

No Device B license, ACK or protected access was produced, and reopening the
same `.slr` on the VM remained Locked. The bounded public evidence checkpoint
therefore records `negative_cases_verified=true`,
`device_b_independent_secure_store=true`,
`device_b_protected_content_denied=true`, HTTP 409 and
`DEVICE_BINDING_MISMATCH`.

### Shared-document conflicts and updates

No frozen shared document was changed. The Viewer-side implementation conforms
to the current `.slr`, API, payment, license and crypto contracts. The unresolved
general 95/5 integer-rounding policy remains an explicit integration blocker;
Part 05 uses only an exactly divisible demo price and does not redefine that
contract. The earlier static Backend blockers are superseded by the locally
integrated implementation in sections 9–13; those fixes have deterministic test
coverage but are not represented as live Devnet evidence.

### External-review follow-up: review artifact, Device B evidence and audit

- `scripts/create-clean-archive.mjs` now excludes every directory named
  `storage_data`, case-insensitively and at any depth, before staging. A dedicated
  archive-level regression proves that root/nested runtime uploads are absent
  while source files such as `src/storage_data.ts` remain reviewable. The earlier
  `20260914T094954Z` and `20260914T095103Z` archives both contained the runtime
  source ZIP and were moved to a mode-0700 temporary quarantine outside the
  repository; they are unsafe to distribute and are superseded by the new
  artifact recorded at delivery.
- The live evidence schema follows the existing frozen API/Backend behavior
  instead of forcing one preferred error name. Device B proof requires HTTP 409,
  exact documented `DEVICE_BINDING_MISMATCH` or `DEVICE_LIMIT_REACHED`, distinct
  Device A/B keys, and explicit proof that no license, ACK or protected access was
  produced. The current Backend E2E exercises `DEVICE_BINDING_MISMATCH`.
- Reachable upload dependencies were minimally patched: both direct and Nest
  Multer edges resolve to `2.3.0`; `adm-zip` resolves to `0.6.0`. Narrow pnpm
  overrides patch the affected Nest Swagger/config `lodash`, Swagger `js-yaml`,
  and the reported Nest CLI `glob`/`picomatch`/`tmp` edges without a dependency
  family upgrade. A new Multer test executes real multipart parsing and its
  configured file-size rejection.
- Both audits still intentionally report failure because
  `@solana/spl-token -> @solana/buffer-layout-utils -> bigint-buffer@1.1.5`
  has the unpatched high `GHSA-3gc7-fjrx-p6mg`. The package is loaded by the live
  Solana paths, but this install cannot load its native binding and demonstrably
  uses its pure-JS conversion fallback; the vulnerable native
  `converter.toBigInt()` sink is therefore not active in the tested build. This
  remains an accepted, visible residual risk: a deployment that enables the
  native addon must be re-evaluated, and no audit PASS is claimed.
- The refreshed advisory database also reports production moderate findings in
  transitive Nest/Solana packages and a new no-patch `adm-zip@0.6.0` symlink
  advisory. They remain visible in the exact audit counts in section 20. This
  continuation did not perform another dependency-family/static-hardening pass
  because no new live E2E blocker was reproduced; archive extraction retains its
  existing bounded/path-validation tests. These advisories require separate
  dependency/vendor review before production deployment.
- The first live payment submission reproduced a concrete Solana Pay integration
  defect: the public reference had been attached to the Memo instruction, whose
  runtime requires every supplied account to sign. The finalized transaction
  failed atomically with `MissingRequiredSignature` and transferred no USDC.
  `PaymentsService` now appends the reference as a read-only non-signer to the
  creator SPL `transferChecked` instruction and keeps the Memo account list empty.
  A regression deserializes the exact response transaction and checks both
  invariants. The same Payment Intent was reissued only after the failed issuance
  was finalized; the replacement transaction then finalized successfully.

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

The earlier static Backend hardening remains as recorded below. This live step
additionally changes `TODO/PART_05.md`, `apps/api/package.json`,
`pnpm-lock.yaml`, `scripts/viewer-live-devnet-e2e.mjs` and this report. The API
package change pins the already-resolved `express@4.22.1` as a direct runtime
dependency because the request-limit middleware imports it directly; the lock
change contains no unrelated upgrade. The live harness now invokes the exact
pinned Tauri CLI through an isolated native-Windows `pnpm dlx`, with an explicit
prebuilt-frontend mode for WSL/Windows shared checkouts.

The final external-review follow-up additionally changes root `package.json`,
`scripts/create-clean-archive.mjs`, `scripts/create-clean-archive.test.mjs`,
`scripts/viewer-live-devnet-e2e.test.mjs`, and adds
`apps/api/src/modules/uploads/multer-compatibility.spec.ts`. No migration or
frozen shared contract changed in this follow-up.

The retained live-payment blocker fix changes:

```text
apps/api/src/modules/payments/payments.service.ts
apps/api/src/modules/payments/payments.spec.ts
docs/archive-core-viewer/reports/PART_05_REPORT.md
```

This mandatory-refresh continuation additionally changes:

```text
apps/api/src/config/env.service.ts
apps/api/src/config/env.service.spec.ts
apps/api/src/modules/licensing/licensing.service.ts
apps/api/src/modules/licensing/licensing.spec.ts
apps/viewer/src-tauri/Cargo.toml
apps/viewer/src-tauri/src/clock.rs
apps/viewer/src-tauri/src/lib.rs
apps/viewer/src-tauri/src/secure_store.rs
docs/archive-core-viewer/reports/PART_05_REPORT.md
```

There is no migration, dependency, wire/crypto contract or frozen-document
change in this continuation.

Operational live scripts/checkpoints remain under ignored `artifacts/live-devnet/`
and are excluded from the clean review archive. They contain public evidence only;
private keys and Backend secrets remain outside the repository.

Current combined Backend hardening files are:

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
compatibility mappings were retained. The lockfile changed only to make the
existing Express runtime package a direct API dependency.

## 4. Devnet decision and official inputs

No current shared source-of-truth document hard-codes the hackathon flow to
Mainnet. Network/mint/RPC remain Backend deployment inputs, so no shared contract
update was needed.

Immediately before validation on 2026-09-14:

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
  mint returned `decimals=6` at finalized slot `497929793`.

The harness does not freeze a remembered RPC genesis value. It compares the
explicit Backend-team RPC against the official Devnet endpoint at run time and
checks the mint on-chain immediately before E2E.

## 5. Live Backend origin integration

A real production-built API process was started against a disposable PostgreSQL
16 database with all four migrations applied and the official public Devnet RPC.
It was exposed for this integration checkpoint at the strict HTTPS root origin:

```text
https://interpolative-interiorly-jase.ngrok-free.dev/
```

Public `/v1/health` and `/v1/health/ready` both passed; readiness reported the
database and Solana RPC as `ok`. The same origin was compiled into the native
Windows `live-devnet` Viewer build and used by the successful live preflight.
Credential-bearing redirects remain disabled.

This is an accountless Cloudflare Quick Tunnel, not a durable production
deployment: it has no uptime guarantee and prior tunnel origins expired during
the session. The Backend and tunnel were restarted with a new mutually
consistent `PUBLIC_API_ORIGIN`, and the debug live-E2E Viewer was rebuilt with
that exact origin; a durable named deployment is still required for a repeatable
two-device demonstration.

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

The real public-only anchors used for this checkpoint are:

```text
archive key ID: archive-devnet-20260914
archive public key: v15RH9BIeXS5EFgRAuc3SXRoH6Q3SzA5ghvRcAVR6nU=
license key ID: license-devnet-20260914
license public key: DV69rejywU72q6WkQS0sTNlqPF1/NbffB/WORgxuw7A=
```

The corresponding private signing material stayed in the mode-0600 operational
workspace outside the repository and is not included in this report/archive.

### License trust anchor integration

The license-role key is independently configured and stored only in the
`LicenseTrustStore`; it cannot authenticate an archive signature. The native
live build embedded the real public license anchor above. Backend issued a real
P/W/SIG under `license-devnet-20260914`; Viewer verified its Ed25519 signature,
fresh request nonce, archive/fingerprint/device/rights/time bindings and HPKE
envelope before installing protected access. No private license key entered the
Viewer build or repository.

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

Only public wallet addresses are accepted. The disposable role-separated public
wallets are:

```text
fee payer: 3nwTpSGRTosed4ZLACkTyE2a5kmvsnaA85e5xbe8hQiM
platform: 9HvUyMLZPzfr92n5bqosiWF3z42GRUXgc5KPj4A3DQy4
creator: GXeFmnNdm3CqqsPuhUTYUk2AisrphPrEHZdRDJUowvV7
buyer: AumZDnQhNj83fFR4rNY4s37BximJbKoJqtMJTK8ZdRNc
```

The fee payer received only Devnet SOL and funded the real creator/platform ATA
operations and payment fee. Immediately before purchase, an independent official
RPC query resolved buyer ATA
`B8JW3xahkuxN8c2VGNfWwBhyCGDYyuzykew5gwYoZvEj`, confirmed the official Circle
mint and `decimals=6`, and returned exactly `20.000000` test USDC. After the
finalized purchase the authoritative balances were buyer `19.000000`, creator
`0.950000`, platform `0.050000`. Funding was manual; no CAPTCHA was automated or
bypassed. Devnet SOL and test USDC have no monetary value.

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
remains open. This live archive uses exactly `1.000000 USDC`, yielding intended
shares of `950000` and `50000` micro-USDC.

## 9. Real archive builder integration

**Verified through the real live Backend/Core path.** `ArchiveBuilderAdapter` invokes the
reviewed `solarch` CLI duplex create/pending-verifier/signing protocol, performs
independent final verification and compares the complete-file fingerprint. It
uses a fresh 32-byte ACK subsequently sealed by encrypted custody. Live startup
requires an explicit existing absolute `SOLARCH_CLI_PATH`.

Archive creation, upload completion, builder input, Payment Intent creation and
license issuance all enforce the frozen MVP policy: USDC, 500 bps, one device,
no export and watermark enabled. Creator authentication, archive creation,
multi-format ZIP upload, finalization, Backend signing, encrypted ACK custody,
download and publish all ran over the real API. The result is:

```text
archive ID: 60ad6fed-6d73-4a20-af54-71f901da2460
fingerprint: 885f7dc489d6f5042ba9cd287a5ff13109585a485d0067fd9365d249aa89b3e6
size: 6815 bytes
files: 4 (PDF, PNG, DOCX, XLSX)
price: 1.000000 USDC
policy: max_devices=1, allow_export=false, watermark_enabled=true
state: ready + published
```

Release `solarch verify` returned `AUTHENTICATED_CONTAINER` with archive signing
key `archive-devnet-20260914` and the exact fingerprint. A copy of the encrypted
archive is retained only as the ignored local artifact
`artifacts/live-devnet/solarch-devnet-multiformat.slr`; it contains no plaintext
protected content or credential.

## 10. Real Payment Intent and Backend API compatibility

The published archive's authoritative Viewer metadata was fetched from the real
HTTPS Backend and exactly matched the archive fingerprint, creator, price,
currency, fee, rights and policy. Windows Device A then created real Payment
Intent `cd90741d-6f5e-4af7-8d8a-8d91665873c8`, bound to its fresh X25519 public
key. Viewer showed the real Solana Pay QR while protected access remained locked.
The TOKEN32 credential stayed in Windows secure storage and was never printed,
logged, placed in the evidence JSON or copied into this report. Viewer metadata
includes `platform_fee_bps`; Payment Intent and confirmed verification responses
contain the frozen closed fields; typed Viewer error codes are preserved by the
global filter.

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

This authority ordering was exercised live. A first exact issuance finalized
failed because the reference had incorrectly been supplied to the Memo program.
No token transfer occurred. After the narrow instruction-layout fix, Backend
classified that exact txid as failed and reissued under the same Payment Intent;
it did not create a duplicate intent or treat the unrelated/earlier issuance as
the successful payment.

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

Archive publication exercised the real SolArch-sponsored creator ATA creation.
Independent finalized RPC inspection proved:

```text
creator ATA: 82Cgry3aViHWxpwCCZv3oAgfbfb3uKtMefwVHTx9oCSC
creation signature: ruipkjeH5asWjKFc6PxNQ56WtgT6PWFEsyN62mkpdVfvijrN54VzhJFZBkGwPYwgxccqkD1JXfNMnSVwRBe2ZuA
finalized slot: 497936089
fee payer: 3nwTpSGRTosed4ZLACkTyE2a5kmvsnaA85e5xbe8hQiM
fee: 5000 lamports
mint: 4zMMC9srt5Ri5X14GAgXhaHii3GnPAEERYPJgZJDncDU
decimals: 6
```

The creator token account did not exist in the pre-balances and appeared in the
finalized post-balances for the configured creator and official mint. The
external buyer then signed the real test-USDC transaction. Independent official
RPC inspection and `viewer:devnet:evidence` on-chain validation proved:

```text
transaction signature: eSXDoz5tM6BEQSHh5cGHD4hu9NoYrRZQrPUbAgdu7Ux7cMxXKq2MoHki5swjWM4o9hvs7HZJsm4W4XqNDLsHVzt
finalized slot: 498304223
payment reference: B55XAeCxidr3nzmAtMVQ6Y8WoZ35eCYjsgQUE7cbDoxX
buyer signer/debit: AumZDnQhNj83fFR4rNY4s37BximJbKoJqtMJTK8ZdRNc / -1000000
creator credit: GXeFmnNdm3CqqsPuhUTYUk2AisrphPrEHZdRDJUowvV7 / +950000
platform credit: 9HvUyMLZPzfr92n5bqosiWF3z42GRUXgc5KPj4A3DQy4 / +50000
fee payer: 3nwTpSGRTosed4ZLACkTyE2a5kmvsnaA85e5xbe8hQiM
fee: 10000 lamports
mint/decimals: 4zMMC9srt5Ri5X14GAgXhaHii3GnPAEERYPJgZJDncDU / 6
```

The payment used two `transferChecked` instructions in one atomic transaction.
The reference was a read-only non-signer on the creator transfer, the buyer was
the other signer, and the configured SolArch wallet was account zero/fee payer.
Post-transaction balances were independently rechecked as 19.00 buyer, 0.95
creator and 0.05 platform test USDC.

## 12. Finalized verification and Payment vs Entitlement

**Verified live.** Verification accepts only the exact
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
The real finalized transaction produced distinct public records:

```text
Payment: 22adc2f5-c19c-41e3-a2c8-40bdd186bcc3 (confirmed)
Entitlement: fcea37a3-bcc6-4066-9ae2-91f9bc8a6f68 (active)
```

Database inspection confirmed the authoritative buyer and exact Device A public
key on the Payment snapshot before activation began.
No simulation signature path authorized this payment.

## 13. Device A activation, real P/W/SIG and HPKE

**Device A activation verified live.** Activation and refresh issue exact-second
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

After Backend verification returned `confirmed`, native Viewer activation used a
fresh nonce and the retained intent credential. Backend created exactly one active
DeviceActivation and exactly one active DeviceLicense:

```text
Device A public key: Y9W1I6ifJsJWzibkr1zDrh7/LxvTWgMHnj84Rw4uoGI=
Device License: lic_b908b32360074d74
issued_at: 2026-09-14T15:25:51Z
offline_valid_until: 2026-09-17T15:25:51Z
```

Viewer accepted the response only after fresh-nonce, Ed25519, archive ID,
fingerprint, Device A, rights, exact time-window and HPKE validation. The returned
ACK remained inside Rust; only the public unlocked snapshot (four files and a
watermark descriptor) crossed IPC. The refresh credential was saved in Windows
secure storage and the completed Payment Intent credential/metadata were cleaned.

## 14. Protected viewers, watermark, cached restart and refresh

The existing Part 04 native synthetic regression remains passing, and real-license
native viewing was also exercised through the installed live NSIS build. PDF
produced a bounded canvas, PNG produced the sanitized internal image, DOCX produced
the read-only document model, and XLSX produced a grid with two sheets. Every
viewer had the buyer/license/archive watermark. No Save/Export/Open External link
was present; the protected surface prevented context menus and no external HTTP
link existed.

A full process exit followed by Explorer `.slr` double-click reopened all four
files from the cached signed license. Backend was then actually stopped, public
HTTPS readiness returned 502, and a second full process restart still reopened
the same archive as unlocked with four files. This closes both cached-restart
checkpoints inside the valid offline window.

The exact live mandatory-refresh checkpoints are now verified without waiting
72 real hours or changing the Windows host clock. Before time advancement, the
validated Device A application state and Windows credential blobs were copied in
memory into two isolated debug-only namespaces and verified byte-identical. At
logical time `2026-09-17T15:26:51Z`, one minute after the old deadline:

- the online snapshot made the real HTTPS refresh request, Backend rechecked the
  active Payment/Entitlement/DeviceActivation/DeviceLicense authority, unsealed
  real custody, created a fresh HPKE envelope and Ed25519 signature, and returned
  a grant from `2026-09-17T15:26:51Z` through `2026-09-20T15:26:51Z`;
- the measured window remained exactly `259200` seconds, the license ID and all
  bindings remained stable, and the fresh signature plus HPKE envelope differed
  from the old issuance; Viewer validated/unwrapped it and opened the protected
  PDF with watermark;
- the separate pre-refresh offline snapshot exposed no protected file table and
  remained denied. Its unavailable transient tunnel produced a fail-closed
  invalid-response surface rather than protected access.

`development-fixtures` was absent from this native build. The release negative
compile check rejected `live-e2e-clock`, so production/release binaries cannot
accept this clock source. Both public evidence refresh booleans are now true.

## 15. Device B and negative live cases

**Verified live on an independent Windows VM.** Device B used its own clean
application state and secure-store identity and generated a fresh canonical
X25519 public key distinct from Device A:

```text
Device A: Y9W1I6ifJsJWzibkr1zDrh7/LxvTWgMHnj84Rw4uoGI=
Device B: ALzIOw8z9UQNnJuYC17HEUiWQoiH5+Pj8curIrvZqyE=
```

The exact same authenticated `.slr` opened on Device B as Locked. No Device A
private key, cached license, refresh credential, ACK or application state was
copied to the VM. Device B generated its own Payment Intent and remained unable
to access the protected file table/content.

A separate legitimate Devnet security-test purchase was then created bound to
Device A solely to exercise the authenticated activation/recovery negatives.
After the real test-USDC transaction verified as `confirmed`, Device A activation
succeeded and produced security-test license `lic_22d778abf2f241e8`.

Reusing the consumed Device A activation nonce returned HTTP 409
`REQUEST_NONCE_REPLAY`. Presenting the independent Device B public key to the
same authenticated confirmed PaymentIntent returned HTTP 409
`DEVICE_BINDING_MISMATCH`. Database inspection immediately afterwards returned
zero Device B activation rows and zero Device B license rows. No Device B license,
ACK or protected access was produced, and reopening the archive on the VM
remained Locked.

The complete practical live negative matrix now includes:

```text
wrong intent credential        -> HTTP 401 INVALID_INTENT_CREDENTIAL
wrong refresh credential       -> HTTP 401 INVALID_REFRESH_CREDENTIAL
unknown archive                -> HTTP 404 ARCHIVE_NOT_AVAILABLE
not-finalized activation       -> HTTP 403 PAYMENT_NOT_CONFIRMED
nonce replay                   -> HTTP 409 REQUEST_NONCE_REPLAY
wrong Device binding / Device B-> HTTP 409 DEVICE_BINDING_MISMATCH
cross-archive binding attempt  -> HTTP 409 DEVICE_BINDING_MISMATCH
revoked license authority      -> HTTP 403 LICENSE_REVOKED
expired entitlement authority  -> HTTP 410 ENTITLEMENT_EXPIRED
```

Every negative remained fail-closed and produced no protected output. The final
public checkpoint therefore sets `negative_cases_verified=true`,
`device_b_independent_secure_store=true`,
`device_b_protected_content_denied=true`,
`device_b_license_issued=false` and `device_b_ack_received=false`.

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

Running preflight against the real public inputs passed:

```text
cluster: devnet
archive: 60ad6fed-6d73-4a20-af54-71f901da2460
fingerprint: 885f7dc489d6f5042ba9cd287a5ff13109585a485d0067fd9365d249aa89b3e6
files: 4
price: 1.000000 USDC
creator share: 950000 micro-USDC
platform share: 50000 micro-USDC
```

The release CLI authenticated the exact local bytes, Backend health/readiness and
security-critical metadata matched, and the official RPC/mint checks passed.

The final bounded checkpoint was updated only with actually observed public
results from the native Windows/Devnet run. The primary evidence remains the
original successful purchase and Device A entitlement/license; the later
security-test purchase is used only as supporting authenticated negative-matrix
evidence.

`viewer:devnet:evidence` was rerun with the finalized public payment signature,
payment reference, creator-ATA creation signature and the completed bounded
manual/native checkpoint. The harness independently accepted the finalized
on-chain payment and ATA transaction, exact test-USDC owner deltas, buyer signer,
public reference, SolArch fee payer, archive/fingerprint inputs, mandatory
refresh checkpoints, independent Device B denial and completed live negative
matrix.

Final result:

```text
rtk pnpm viewer:devnet:evidence
EXIT_CODE=0
```

The accepted Device B evidence records distinct Device A/B public keys, HTTP 409
`DEVICE_BINDING_MISMATCH`, no Device B license, no ACK, an independent secure
store and denied protected content. `negative_cases_verified=true`.
This closes the Part 05 functional/E2E evidence gate.

## 17. Security review

- No private/mnemonic/fee-payer/signing key or live credential was added.
- Live configuration embeds only public anchors and a public HTTPS origin.
- Archive and license roles remain distinct; malformed/same-key/unknown-role
  inputs fail closed.
- `live-devnet` disables fixture Backend selection. The final build command does
  not request `development-fixtures`.
- The deterministic clock is isolated behind a debug-only Cargo feature and an
  explicit test-mode live-Devnet Backend conjunction. Native release compilation
  with that feature was rejected as designed; ordinary live/release behavior has
  no clock override. Signed windows remain exactly 259200 seconds.
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

Live integration checkpoints on 2026-09-14–16:

| Command/check | Result |
| --- | --- |
| disposable PostgreSQL 16 `prisma migrate deploy` | PASS; all four migrations applied in order |
| production `@solarch/api start:prod` | PASS after correcting the compiled entrypoint and direct Express runtime dependency |
| HTTPS `/v1/health` + `/v1/health/ready` | PASS; database and official Devnet RPC ready |
| real creator auth/create/upload/finalize/download/publish | PASS; four-format 6815-byte authenticated archive |
| release `solarch verify` on downloaded bytes | PASS; `AUTHENTICATED_CONTAINER`, exact fingerprint |
| finalized creator ATA on-chain inspection | PASS; new official-mint ATA, SolArch fee payer, slot `497936089` |
| `node scripts/viewer-live-devnet-e2e.mjs preflight` with real public inputs | PASS; Backend/Core metadata, official RPC/mint and exact 95/5 arithmetic |
| native Windows `live-devnet` Tauri/NSIS build | PASS; x64 executable and installer built with real public anchors/origin |
| `rtk pnpm install --frozen-lockfile --force` + Prisma regeneration | PASS; restored generated dependencies after the isolated Windows package-manager attempt |
| `rtk pnpm --filter @solarch/api lint` | PASS |
| `rtk pnpm --filter @solarch/api test` | PASS, 12 suites / 115 tests, including deterministic-clock and Multer 2.3 parsing/boundary coverage |
| `rtk pnpm --filter @solarch/api test:e2e` | PASS, 1 suite / 23 tests |
| `rtk pnpm --filter @solarch/api build` | PASS |
| finalized-block metadata regression | PASS; unit regression proves metadata-only block request permits v1 while both exact target transaction calls remain capped at v0 |
| same-intent/same-tx live verification retry | PASS; HTTP 200, intent confirmed, issuance consumed, Payment and Entitlement persisted; no new intent or transaction created |
| `rtk pnpm --filter @solarch/viewer lint` | PASS |
| `rtk pnpm --filter @solarch/viewer test` | PASS, 3 files / 34 tests |
| `rtk pnpm --filter @solarch/viewer build` | PASS, 1,873 modules and local PDF worker |
| `rtk cargo fmt --check` | PASS |
| `rtk cargo clippy --workspace --all-targets --all-features -- -D warnings` | PASS, no issues |
| `rtk cargo test --workspace` | PASS, 128 tests across seven suites |
| `node --test scripts/create-clean-archive.test.mjs` | PASS, 12/12 |
| `node --test scripts/viewer-live-devnet-e2e.test.mjs` | PASS, 5/5 |
| deterministic `.slr` vectors | PASS; 1166/7655 bytes and both frozen fingerprints unchanged |
| `rtk git diff --check` | PASS |
| `rtk pnpm audit --audit-level high` | **FAIL / residual recorded**: 14 advisories (3 low, 10 moderate, 1 high); sole high is unpatched `bigint-buffer` |
| `rtk pnpm audit` | **FAIL / residual recorded**: same 14 advisories and sole unpatched high; ordinary audit was run and is not represented as PASS |
| `rtk pnpm audit --prod --audit-level high` | **FAIL / residual recorded**: 11 advisories (1 low, 9 moderate, 1 high); sole high is the same unpatched `bigint-buffer` production path |
| native Windows `cargo.exe test --workspace` | PASS; 10 CLI + 60 Core + 60 Viewer tests |
| native Windows Viewer `cargo.exe check --all-features` | PASS |
| native Windows installer/file-association smoke | PASS; RU/EN selector/persistence, single-instance association, hostile argv fail-closed and uninstall cleanup |
| live checklist/template commands after Device B schema update | PASS; template requires HTTP 409, documented code, no license and no ACK |
| official Devnet buyer account recheck | PASS before payment: official mint, canonical ATA, `decimals=6`, balance `20.000000`; post-payment balance `19.000000` |
| installed live NSIS + Explorer `.slr` open | PASS; real archive reached verified Locked on Device A |
| real Payment Intent + Solana Pay QR | PASS; one Device-A-bound intent, no protected access before finality |
| real external-wallet Devnet payment | PASS; finalized slot `498304223`, exact 950000/50000 split, buyer signer, SolArch fee payer |
| Backend Payment -> Entitlement | PASS; distinct confirmed/active authoritative records |
| Device A signed license + HPKE | PASS; one active activation/license, Viewer fresh-response validation and local unwrap |
| live PDF/PNG/DOCX/XLSX + watermark/no export | PASS in installed native Viewer |
| full restart + cached reopen | PASS online and again while public Backend readiness returned HTTP 502 |
| native Windows debug `live-devnet,live-e2e-clock` build | PASS; real HTTPS Backend/public anchors, no `development-fixtures` |
| release build with `live-e2e-clock` | EXPECTED FAIL/PASS security assertion; compile-time rejection observed |
| live mandatory refresh online | PASS; fresh Backend signature + HPKE, same license ID, exact new 259200-second window, protected PDF/watermark opened |
| pre-refresh snapshot at same logical deadline with Backend unavailable | PASS; no protected table/content, fail closed |
| authenticated live negative matrix | PASS; wrong intent 401 `INVALID_INTENT_CREDENTIAL`, wrong refresh 401 `INVALID_REFRESH_CREDENTIAL`, unknown archive 404 `ARCHIVE_NOT_AVAILABLE`, not-finalized activation 403 `PAYMENT_NOT_CONFIRMED`, nonce replay 409 `REQUEST_NONCE_REPLAY`, cross-archive binding denial, revoked authority denial and expired authority denial; all fail closed |
| `rtk pnpm viewer:devnet:evidence` | **PASS**; final bounded public checkpoint accepted, on-chain payment/ATA proof accepted, independent Device B and complete live negative matrix accepted; `EXIT_CODE=0` |
| independent Device B/clean VM | **PASS**; separate Windows VM/secure store, distinct X25519 key `ALzIOw8z9UQNnJuYC17HEUiWQoiH5+Pj8curIrvZqyE=`, same exact `.slr`, authenticated activation attempt returned HTTP 409 `DEVICE_BINDING_MISMATCH`, zero Device B activations/licenses, no ACK/protected access, Viewer remained Locked |
| disposable Device-A security-test purchase | PASS; real Devnet PaymentIntent `9510e226-b5a7-4b94-b31a-d3e86450fefd` verified `confirmed`, Payment `4b36375c-fe9d-4955-b690-a1a871288165`, Entitlement `e2e3d613-4474-4585-9f98-ec8f966e8926`, license `lic_22d778abf2f241e8`; used only for authenticated negative testing |
| paid Device B binding rejection | PASS; same authenticated confirmed PaymentIntent presented with independent Device B key returned HTTP 409 `DEVICE_BINDING_MISMATCH`; no Device B activation/license persisted |
| nonce replay live rejection | PASS; consumed Device A nonce returned HTTP 409 `REQUEST_NONCE_REPLAY` |

The previously reported 12 production highs and 15 total-graph highs were
triaged. All fixable high findings were removed by the minimal pins/overrides
above; `bigint-buffer` is the one no-patch residual and keeps both audit commands
nonzero. The independent Device B HTTP 409, zero-license/activation checks, protected
content denial, authenticated live negative matrix and final evidence harness are
now complete. Part 05 therefore passes its hackathon/MVP functional/E2E gate.
The dependency-audit findings below remain explicit production residuals and are
not represented as PASS.

For the 2026-09-16 focused regression, API lint, 12-suite/115-test unit run and
build passed. The first literal E2E invocation inherited the ignored operational
live `.env`, so its fixture TOKEN32 HMAC did not match the live HMAC secret and
three credential-dependent cases returned the expected stable 401. Re-running
the same E2E suite with only its documented non-live fixture HMAC explicitly
scoped in the process passed all 23/23 tests. No source or production behavior
was changed to accommodate the local operational env file.

One complete Viewer run in this continuation produced an isolated i18n timing
failure after the RU text and persisted locale assertions had already succeeded:
another test cleanup cleared `document.documentElement.lang`. The isolated i18n
file passed 4/4 immediately, and the complete Viewer suite then passed 34/34
without source changes. The passing rerun is the final result; the transient run
is retained here rather than hidden.

One intermediate Backend unit run was stopped after a native-Windows pnpm
attempt had left the shared generated Prisma client incomplete. The live Backend
was stopped, dependencies were restored from the frozen lockfile, Prisma was
regenerated, and the complete final lint/unit/e2e/build sequence above then
passed. No database or migration was reset.

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
| historical `rtk pnpm audit --audit-level high` | PASS at that earlier checkpoint; superseded by the current live-checkpoint FAIL above as the advisory database changed |
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
  including Windows Credential Manager and the public-anchor regression.
- `cargo.exe test -p solarch-viewer --all-features` — PASS: 63 Viewer tests,
  including canonical bounded live-E2E credential-scope validation.
- `cargo.exe check --workspace --all-targets --all-features` — PASS.
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

For the live checkpoint, the production frontend was rebuilt first and native
Windows then compiled `desktop-runtime,custom-protocol,live-devnet` with the real
HTTPS origin and public role anchors. Tauri completed the release executable and
NSIS bundle:

```text
target/release/solarch-viewer.exe
target/release/bundle/nsis/SolArch Viewer_0.1.0_x64-setup.exe
```

The native invocation used the exact pinned `@tauri-apps/cli@2.11.4` through an
isolated `pnpm dlx`. Its one-time config skipped only duplicate
`beforeBuildCommand` after the same source frontend build had already passed;
this is required because WSL-created POSIX `.bin` shims are not executable by
Windows Node in the shared checkout. The installer was installed, Explorer
association opened the exact archive, and the installed native Viewer completed
Locked, QR, activation, protected rendering and two cached process restarts. One
restart ran while the Backend was intentionally stopped. The final native Windows
`cargo.exe test --workspace` and Viewer `cargo.exe check --all-features` were also
rerun after the live fix and passed.

## 22. Functional/E2E closure and demo handoff

The Part 05 hackathon/MVP functional/E2E handoff is complete.

The final accepted path now covers:

1. Backend/Core generation and authentication of the exact self-contained `.slr`;
2. real public archive metadata and live trust anchors;
3. sponsored creator ATA creation;
4. real external-wallet Devnet test-USDC payment with exact 95/5 split;
5. finalized Backend verification and distinct Payment/Entitlement records;
6. Device A activation with signed device-bound license and HPKE-wrapped ACK;
7. internal PDF/PNG/DOCX/XLSX rendering with watermark and no protected export;
8. cached process restart online and while Backend is unavailable;
9. mandatory online refresh and fail-closed offline-expired snapshot;
10. independent Windows VM / Device B with a distinct secure store and key;
11. authenticated HTTP 409 Device B rejection with no license, ACK or protected
    access;
12. complete practical live negative matrix;
13. final `viewer:devnet:evidence` PASS with exit code 0.

No additional Part 05 functional/E2E blocker remains.

For a repeatable public demo, a transient Quick Tunnel should be replaced by a
stable HTTPS deployment. If the Backend origin changes before a demo, the
Viewer's compile-time `SOLARCH_BACKEND_ORIGIN` must be changed to the exact same
origin and the native live Viewer/installer rebuilt.

The small expired-payment UX issue observed on Device B is non-authoritative:
after a Payment Intent expires the Viewer may show a terminal-looking
"close archive" action before a reopen returns to the normal Locked screen.
Protected content remains denied. This can be polished separately without
changing the payment/license/security contract.

## 23. Known limitations and post-hackathon residuals

- The HTTPS origin used for live evidence is a transient Cloudflare Quick Tunnel,
  not a durable deployment with an operational SLA.
- Mandatory refresh was verified with the isolated debug-only `live-e2e-clock`
  path using the real Backend signing/custody/HPKE flow and two pre-refresh state
  snapshots. Release compilation rejects that clock feature; this is deterministic
  hackathon evidence, not a production clock override.
- Current dependency audits remain nonzero: 11 production advisories
  (1 low, 9 moderate, 1 high) and 14 full-graph advisories
  (3 low, 10 moderate, 1 high). The sole high is the recorded unpatched
  `bigint-buffer` native-binding path; no dependency-audit PASS is claimed.
- The general six-decimal 95/5 rounding rule remains unresolved shared-contract
  work. The demonstrated archive uses the exactly divisible `1.000000 USDC`
  price and does not redefine that contract.
- The expired-PaymentIntent Viewer UX can be improved so the terminal error action
  returns directly to the Locked/new-payment state instead of requiring the user
  to close and reopen the archive. This is a UX polish item; the observed behavior
  remained fail-closed.
- Mainnet, production RPC/SLA, durable HTTPS deployment, KMS/HSM-backed signing,
  Windows code signing, updater and operational monitoring remain outside this
  Part.
- DRM remains practical/best-effort. No claim of absolute screenshot prevention,
  hostile-host resistance or enterprise-grade DRM is made.

These items do not reopen the completed Part 05 hackathon/MVP functional/E2E
Definition of Done. Status is `COMPLETE — FUNCTIONAL/E2E PASS`, while the
production/security residuals above remain explicitly documented.

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
`node_modules`, `dist`, screenshots, credentials, secrets, prior archives and
every `storage_data` runtime tree (including plaintext upload/source ZIPs).
