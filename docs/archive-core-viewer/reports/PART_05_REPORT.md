# SolArch Archive Core & Viewer — Part 05 Report

**Part:** `PART_05`  
**Branch:** `feat/archive-core-viewer`  
**Status:** `PARTIAL`  
**Updated:** `2026-09-12`  
**Execution:** strict single-agent

## 1. Scope and outcome

Part 05 requires a real Windows/Devnet integration through a deployed teammate
Backend, a Backend/Core-generated `.slr`, external-wallet test-USDC payment,
finalized verification, Entitlement, real Device License/HPKE, cached Device A
reopen and live Backend rejection on an independent Device B.

The Viewer-side live build/configuration boundary, strict preflight, public
on-chain evidence verifier and deterministic presenter checklist are implemented.
All existing Rust/frontend/security/Windows regressions pass. The Part is
correctly **PARTIAL**, not COMPLETE: no live Backend origin, public production/demo
anchors, Backend-generated archive, demo wallets or independent Device B were
provided, and read-only inspection of the current teammate Backend branch found
multiple frozen-contract incompatibilities that prevent the real flow.

No Marketplace Backend code was copied or implemented here. Parts 01–04 crypto,
payment, license and renderer boundaries were not rewritten. No commit, push,
merge, rebase or PR was performed.

### Shared-document conflicts and updates

No frozen shared document was changed. The Viewer-side implementation conforms
to the current `.slr`, API, payment, license and crypto contracts. The unresolved
general 95/5 integer-rounding policy remains an explicit integration blocker;
Part 05 uses only an exactly divisible demo price and does not redefine that
contract. The concrete Backend deviations found during read-only inspection are
listed in sections 9–13.

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

```text
apps/viewer/src-tauri/Cargo.toml
apps/viewer/src-tauri/build.rs
apps/viewer/src-tauri/src/lib.rs
apps/viewer/src-tauri/src/trust.rs
package.json
scripts/viewer-live-devnet-e2e.mjs
scripts/viewer-live-devnet-e2e.test.mjs
docs/archive-core-viewer/reports/PART_05_REPORT.md
```

`Cargo.lock` and `pnpm-lock.yaml` did not change. Making the already-resolved
`ed25519-dalek` dependency direct/non-optional lets production live configuration
reject malformed public anchors before use; no new package was introduced.

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

The current Backend branch stores prices and returned shares to two decimal
places and uses floating-point/`Math.round`. That happens to agree for the
suggested exact demo value but does not resolve the general shared-contract
blocker.

## 9. Real archive builder integration

**Not verified; current Backend is incompatible.** Read-only inspection used
remote commit `84c681318b014641981440ef8f573dab50a7f1f3`.

Its `ArchiveBuilderAdapter.build()` does not invoke the frozen Rust
`ArchiveBuilder`/CLI duplex protocol. It writes a custom big-endian
`SOLARCH\0` layout, declares `AES-256-GCM`, inserts random mock payload bytes,
and appends no frozen SIG1 signature. Such output cannot pass Core `.slr v1`
verification and cannot contain the required protected formats/renderers.

This must be fixed on the Backend branch by invoking the reviewed builder and
pending verifier/signing flow. No Viewer compatibility bypass was added.

## 10. Real Payment Intent and Backend API compatibility

**Not run.** Static comparison found these blocking wire mismatches:

- `GET /v1/viewer/archives/:id` omits frozen `platform_fee_bps`; the Viewer
  correctly rejects the closed response.
- `POST /v1/payment-intents` omits `archive_fingerprint`,
  `device_public_key`, `payment_reference`, `created_at` and `status`; it cannot
  pass the existing strict intent validator.
- confirmed verification responses omit frozen `status`, `archive_id`,
  `archive_fingerprint` and `device_public_key`; some idempotent paths also omit
  `entitlement_id`.
- the Backend exception filter emits generic codes such as `BAD_REQUEST`,
  `UNAUTHORIZED` and `FORBIDDEN`, which are outside the frozen Viewer error enum.
  In particular `DEVICE_LIMIT_REACHED` is returned with HTTP 403 while the
  frozen API/Viewer mapping requires HTTP 409.

These are Backend bugs/cross-branch contract mismatches, not reasons to loosen
the Viewer closed schemas.

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

**Not verified live.** The current Backend verifier calls `getParsedTransaction`
at `confirmed` and attempts to read `confirmationStatus` from that transaction
object instead of establishing finalized status via a status/finalized query.
Its non-production simulation path is forbidden by Part 05. The real demo must
remove that ambiguity and must never confirm at weaker commitment.

The Backend source does create Payment and Entitlement rows in one database
transaction, so the intended separation is visible statically. No deployed
Payment ID or distinct Entitlement ID was observed, and activation was not run.

## 13. Device A activation, real P/W/SIG and HPKE

**Not run.** No real confirmed intent, license trust anchor or deployed issuer
was available. Static Backend inspection found another blocking encoding issue:
license `issued_at`/`offline_valid_until` use JavaScript `toISOString()` with
fractional milliseconds, while the frozen wire timestamps require exact
second-form `YYYY-MM-DDTHH:mm:ssZ`; the Viewer correctly rejects these values.

The existing Viewer still performs strict fresh-nonce, Ed25519, archive,
fingerprint, device, rights, time and HPKE validation before installing ACK.
No fixture issuer or fixture private key was used as live authority.

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
`DEVICE_LIMIT_REACHED` result is claimed. The current 403/409 mismatch would in
any case be rejected by the Viewer until the Backend conforms to the frozen API.

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

The current Backend branch itself still has deterministic signing/fee-payer
fallbacks when live secrets are absent. A real deployment must require explicit
secret configuration and must not use those fallback authorities. This is a
Backend blocker and was not copied into Viewer.

## 18. Tests added

- Rust: valid live role-separated public anchors; missing anchor, invalid key
  ID, malformed Base64/public key and same key pair fail closed.
- Node harness: explicit valid configuration; fixture selector, Mainnet, wrong
  mint, non-exact split, HTTP loopback origin and same role key fail closed;
  integer USDC parsing; evidence-mode public input requirements.
- Live commands expose the complete manual checkpoint template without storing
  or requesting secret credentials.

## 19. Commands and results

Final source-state checks:

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

## 20. Windows-native results

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
- Pinned Tauri 2.11.4 built the x64 NSIS bundle — PASS. Frontend production build
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

## 21. Cross-branch handoff required

Backend teammate/deployment must provide and verify, without Viewer workarounds:

1. real Rust ArchiveBuilder/pending verifier/SIG1 integration;
2. exact closed metadata, intent, verify and error DTOs/status codes;
3. strict second-form license timestamps;
4. authoritative finalized querying before Payment/Entitlement commit;
5. explicit live secret configuration with no synthetic fallback;
6. deployed HTTPS root origin, public archive/license anchors and sanitized
   Devnet RPC/mint/platform/fee-payer/creator public configuration;
7. one exact-split multi-format archive and public creator-ATA transaction proof;
8. an independent Device B path returning HTTP 409 `DEVICE_LIMIT_REACHED`.

Once those inputs exist, the implemented harness can run the non-wallet checks;
external wallet approval and the two-machine UI checkpoints remain explicit
manual steps as allowed by the Part instruction.

## 22. Known limitations and not verified

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

## 23. Clean review archive

The clean archive is generated after this report is saved and final checks pass.
Its path and validated content result are recorded in the delivery response to
avoid a self-referential report/archive filename. It includes current source,
tests, TODO and reports while excluding `.git`, `.codex`, `target`,
`node_modules`, `dist`, screenshots, credentials, secrets and prior archives.
