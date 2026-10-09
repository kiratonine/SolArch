# PART 02 Report

**Status:** COMPLETE

**Branch:** `feat/archive-core-viewer`  
**Validated:** 2026-09-09

## 1. Scope delivered

Part 02 adds the Windows Tauri + React + strict TypeScript Viewer shell, trusted
`.slr` verification into the Locked state, RU/EN runtime localization, Device A
X25519 identity backed by Windows Credential Manager, exact P/W/SIG Device
License validation, RFC 9180 HPKE ACK unwrap, local signed-license storage, and
72-hour/rollback primitives.

The external-review remediation separates fresh-response nonce validation from
cached offline restore, makes local persistence accept only a typed
fresh-validated grant, handles a fresh install before consulting rollback state,
and moves archive verification onto Tauri's blocking worker pool.

Part 03 Backend/payment/activation/refresh calls, protected renderers,
watermarking, Windows file association, and installer work were not implemented.
No frozen shared `.slr`, crypto, license, or wire contract was changed.

## 2. Implementation inventory

- Workspace/config: `Cargo.toml`, `Cargo.lock`, `package.json`,
  `pnpm-workspace.yaml`, `pnpm-lock.yaml`, and `README.md`.
- Core: `crates/solarch-core/Cargo.toml`; `src/lib.rs`, `src/error.rs`,
  `src/canonical.rs`, `src/format.rs`, `src/archive.rs`,
  `src/production_crypto.rs`, plus new `src/device.rs` and `src/license.rs`.
- Viewer frontend: `apps/viewer/package.json`, `index.html`, `app-icon.svg`,
  `tsconfig.json`, `tsconfig.app.json`, `tsconfig.node.json`,
  `vite.config.ts`, and all files under `src/`.
- Viewer Rust/Tauri: `apps/viewer/src-tauri/Cargo.toml`, `build.rs`,
  `.gitignore`, `tauri.conf.json`, `capabilities/default.json`, all files
  under `src/`, and the Tauri-generated icon set under `icons/`.
- Test/smoke data: `tests/fixtures/license_v1_vector.json`,
  `tests/fixtures/license_v1_test_secrets.json`, and
  `scripts/viewer-windows-native-smoke.ps1`.
- This is the only Part 02 report.

Generated schemas, `dist`, `node_modules`, Cargo `target`, screenshots, and
other build products are ignored or excluded from review source.

## 3. Architecture and trusted archive open

The frontend exposes only three commands: get the public Device A key, open an
archive, and close the current archive. File selection is restricted to `.slr`;
the IPC path is nonempty, NUL-free, and capped at 4096 UTF-8 bytes. Commands
return stable sanitized error codes and localization keys, never error internals.

Archive parsing and trust decisions remain in Rust. Core reads the untrusted
SIG1 key ID only to select a pretrusted archive-role key. It then verifies the
complete finalized file, strict Ed25519 signature, exact key ID, full-file
SHA-256 fingerprint, stable file identity, and authenticated Public Header on
the same file handle before returning metadata. Any failed new open clears the
prior session. A valid archive becomes `Locked`; malformed, tampered,
unsupported, or unknown-key input fails closed.

The Tauri `open_archive` command is asynchronous and moves bounded structural
inspection plus full archive verification into `spawn_blocking`. Managed state
is shared through `Arc<AppState>` and its mutable session/clock components remain
mutex-protected; task-join failure maps to the existing sanitized `INTERNAL`
command error.

Archive-role and license-role maps are distinct immutable types. Synthetic keys
exist only behind tests or the explicit `development-fixtures` feature.
Production trust stores are empty in this Part, so a production release rejects
even the synthetic valid archive until trusted keys are provisioned.

## 4. Viewer and i18n

The React shell implements empty, loading, Locked, and recoverable error states.
Only verified creator title, wallet, USDC price, archive ID, policy, and final
fingerprint are rendered. It has no payment, Save As, Open External, Extract, or
protected-content controls.

RU and EN use one typed key set with compile/test parity. Switching is immediate,
persists under `solarch.viewer.locale`, updates the document language, and
leaves creator metadata unchanged. The initializer accepts a future installer
locale between stored preference and system locale without affecting security
or crypto decisions.

The UI has visible keyboard focus, minimum 44 px interactive targets, semantic
states, reduced-motion handling, responsive layouts, and a restrained local
palette. Native desktop EN/RU/Locked/error states were visually inspected.
Responsive idle layouts were reviewed at 375, 768, and 1280 px; Firefox was used
for 375 px because headless Edge enforces a wider minimum CSS viewport.

## 5. Device A and Windows secure storage

Core uses pinned `hpke` X25519 key types and OS `getrandom` entropy. The
public wire value is exactly the raw 32-byte RFC 7748 little-endian u-coordinate
encoded as canonical padded RFC 4648 Base64 (44 characters). Secret-bearing
types are non-Clone/non-Serialize, zeroizing, and Debug-redacted.

The production adapter uses `keyring` backed by
`windows-native-keyring-store` and Windows Credential Manager. Stable entries:

- `app.solarch.viewer.device.v1` / `device-a-x25519-private-key`;
- `app.solarch.viewer.clock.v1` / `validated-utc-high-water`.

On first use it generates, writes, rereads, and compares the 32-byte private key.
An unreadable, malformed, or changed stored value fails closed and is not
regenerated. There is no machine fingerprint or plaintext-file fallback. The
memory store exists only under `cfg(test)`.

The native Windows test creates a credential under an isolated test service,
constructs a second application state, proves the identical public key, proves
the app-data license directory contains no private-key file, and deletes the
test credential afterward.

## 6. Device License, signature, and HPKE

Transport is capped at 16384 bytes and depth 8. The shared strict JSON utility
rejects invalid UTF-8, duplicate keys, null, floats, trailing data, and depth
violations without requiring transport property order or whitespace to be JCS.
Serde closed schemas reject unknown/missing fields. Field validation enforces
all frozen IDs, key IDs, wallet, lowercase fingerprint, strict UTC timestamp,
canonical padded Base64, literals, rights, versions, and suite IDs.

Validation order:

1. strict bounded closed parse;
2. `L = JCS(P)` and `Q = JCS({"payload":P,"wrapped_content_key":W})`;
3. strict pure Ed25519 over `D("SolArch/license-signature/v1") || Q` using only
   the license-role trust map;
4. exact archive ID, verified fingerprint, Device A public key, status, rights,
   version, and time bindings;
5. RFC 9180 Base-mode `SetupBaseR`, sequence 0, with KEM 32, KDF 1, AEAD 2,
   exact frozen info/AAD, and an exactly 32-byte plaintext ACK.

Fresh activation/refresh responses use a distinct typed context and additionally
require the signed `P.request_nonce` to equal the exact outstanding request
nonce. Cached P/SIG/W restore has no outstanding-nonce input: the issuance nonce
remains strict signed historical metadata and remains authenticated by both the
signature and HPKE context. All other cryptographic, binding, rights, and time
checks are repeated after every process restart.

The pinned `hpke = 0.14.1` crate supplies DHKEM/HKDF/AES-GCM; no custom crypto
or suite fallback exists. Tests cover forged signature, unsigned P/W changes,
unknown/wrong-role keys, every local binding, wrong device private key,
noncanonical/all-zero KEM input, ciphertext and tag modification, and all
closed-schema constraints. The frozen vector reproduces exact JCS(P), JCS(Q),
signature, recipient public key, and ACK bytes `a0..bf`.

The synthetic device private vector lives only in
`tests/fixtures/license_v1_test_secrets.json`, explicitly marked SYNTHETIC
TEST ONLY. Development public anchors cannot enter production configuration
without the explicit development feature.

## 7. Offline time, rollback, session, and local storage

License time is exact: `offline_valid_until = issued_at + 259200` seconds and
local validity is `issued_at <= now < offline_valid_until`. Exact deadline and
pre-issue use fail. The rollback guard combines a greatest validated UTC
high-water value, per-process monotonic elapsed time, and the frozen 300-second
tolerance; excessive rollback returns `RefreshRequired` without claiming a
trusted clock.

Clock high-water data uses a separate secure-store entry. A missing high-water
state cannot bootstrap itself from an untrusted local clock and requires future
online refresh; malformed state fails closed. The Part 03 boundary can
initialize it only after authoritative refresh.

The Rust session contains verified archive identity, validated nonsecret license
metadata, a zeroizing ACK, and offline deadline. ACK is never serialized,
returned over Tauri IPC, or persisted; Debug redacts it. Session replacement,
close, validation error, or deadline transition drops it.

Local storage contains only canonical P/W/SIG under a SHA-256-derived safe
filename. Writes are bounded and atomic. Reads reject symlinks/non-files,
oversize/change, malformed JSON, and archive mismatch, then always repeat trust,
signature, binding, time, and HPKE validation before installing ACK in memory.
The public repository write boundary accepts only `ValidatedFreshLicenseGrant`,
which can be constructed only by the full fresh-response validator including
the outstanding nonce check. A missing local grant returns `Ok(false)` before
rollback/high-water processing; an existing grant still requires rollback and
full cryptographic validation.

## 8. Dependencies

Rust additions are narrowly pinned: `hpke 0.14.1` with only
alloc/X25519/AES, `getrandom 0.3.4`, `atomic-write-file 0.3.1`,
`keyring 4.2.0`, `windows-native-keyring-store 1.1.0`, `tauri 2.11.5`,
`tauri-build 2.6.3`, and `tauri-plugin-dialog 2.7.3`. Tauri and keyring are
Windows-target-gated so Linux Core checks do not require GTK or a non-Windows
secret backend. The Windows `tauri-build` build dependency and `build.rs` entry
are additionally gated by `desktop-runtime`, so the default-feature native
workspace test does not invoke an inactive Tauri runtime.

Frontend pins React/React DOM 19.2.8, Tauri API 2.11.1/CLI 2.11.4, dialog 2.7.3,
Vite 8.2.2, Vitest 5.0.0, TypeScript 7.0.2, jsdom 26.1.0, Testing Library, and
Lucide React 1.43.0. pnpm is the sole package manager. `rtk pnpm audit
--audit-level high` reported no known vulnerability. `cargo-audit` was not
installed and is not represented as run.

## 9. Validation evidence

Required and project checks, all passing:

| Command | Result |
| --- | --- |
| `rtk pnpm install --frozen-lockfile` | pass, lockfile unchanged |
| `rtk cargo fmt --check` | pass |
| `rtk cargo clippy --workspace --all-targets --all-features -- -D warnings` | pass, no issues |
| `rtk cargo test --workspace` | pass, 86 tests in 7 suites |
| `rtk cargo test --manifest-path apps/viewer/src-tauri/Cargo.toml --all-features` | pass, 17 tests in 3 suites |
| `rtk pnpm lint` | pass, strict TypeScript |
| `rtk pnpm test` | pass, 7 tests in 2 files |
| `rtk pnpm build` | pass, production frontend bundle |
| `rtk node --test scripts/create-clean-archive.test.mjs` | pass, 11 tests |
| `rtk pnpm audit --audit-level high` | pass, no known vulnerabilities |
| `rtk git diff --check` | pass |

The exact Core archive vector test passed and still proves 1166 bytes plus
fingerprint
`57ce84068fdd9b23f8860afa27834151f4fefb038d812c2ac77e8a861b1eecdb`.
The exact license vector test independently passed and reproduced JCS,
Ed25519, HPKE, and ACK.

Frontend tests cover empty/loading/Locked/error, absence of export controls,
creator title preservation, RU/EN parity, and runtime persistence. Rust tests
cover all Part 02 malformed transport, trust, binding, signature, HPKE, time,
rollback, secure-store, local repository, IPC secrecy, and session cases.
The remediation regressions additionally prove exact outstanding-nonce rejection
on the fresh path, cached reopen after a simulated process restart with no
outstanding nonce, fresh install with neither grant nor high-water returning
`Ok(false)`, typed validated-only persistence, and `AppState: Send + Sync` for
blocking archive work.

## 10. Windows-native evidence

These commands ran through native `cargo.exe`/PowerShell on Windows, not a WSL
target:

- `cargo.exe test --workspace`: passed with 10 CLI, 58 Core, and 18 Viewer
  tests; this natively repeats the frozen archive/license vectors and hostile
  license/HPKE cases under the default workspace feature profile.
- `cargo.exe test --manifest-path apps/viewer/src-tauri/Cargo.toml --features
  desktop-runtime,development-fixtures --lib`: 18/18 passed, including real
  Windows Credential Manager restart and valid archive to Locked.
- `cargo.exe build --release --manifest-path apps/viewer/src-tauri/Cargo.toml
  --features desktop-runtime,development-fixtures,custom-protocol`: passed;
  the embedded development shell compiled and started.
- `scripts/viewer-windows-native-smoke.ps1` against that build returned
  `WINDOWS_NATIVE_UI_SMOKE_PASS`; assertions and the native file dialog proved
  EN to RU, RU after restart, and valid test `.slr` to Locked.
- `cargo.exe build --release --manifest-path apps/viewer/src-tauri/Cargo.toml
  --features desktop-runtime,custom-protocol`: passed on final production
  source without fixture trust.
- The same native smoke with `-ExpectUntrusted` returned
  `WINDOWS_NATIVE_PRODUCTION_FAIL_CLOSED_PASS`; production started with
  embedded assets and rejected the synthetic archive as untrusted.

The standard `custom-protocol` feature is explicit in the manifest. This was
found during native review after a plain debug Cargo launch correctly attempted
`devUrl`; release builds now embed `frontendDist`. The smoke-only WebView2
debug port is dynamically assigned through the test process environment and is
not enabled by Viewer application or release configuration.

## 11. Security review and integration impact

- No production private key, ACK, credential, decrypted content, or real secret
  is in IPC, logs, localStorage, ordinary files, fixtures, or production trust
  config. The only private material in review source is the documented synthetic
  interoperability value in the explicitly test-only fixture.
- Tauri has a restrictive local CSP and only core/default plus file-open dialog
  capability. Shell, external opener, broad filesystem, and remote navigation
  permissions are absent.
- Archive/license trust roles cannot substitute for each other; no TOFU or
  response-provided trust is accepted.
- Fresh response acceptance cannot bypass the exact outstanding request nonce;
  cached restore cannot accidentally depend on ephemeral request state.
- Part 03 cannot use the local repository to persist a raw unauthenticated grant;
  it must first obtain the validator-produced typed fresh grant.
- The frontend cannot display archive metadata before trusted Rust verification.
- Stale session identity is cleared before every open attempt.
- Error DTOs reveal only stable code/localization key pairs.
- DRM remains practical/best-effort; Viewer is not claimed as an absolute
  security boundary.

Part 03 can reuse the canonical public Device A key, verified archive
ID/fingerprint, role-separated trust stores, secure-store abstraction, exact
fresh/cached license validators, validated-only local P/W/SIG repository,
fresh-response request-nonce context, rollback reset boundary, and Rust-only ACK
session. No network call or buyer wallet/login authorization was added here.

## 12. Known limitations and remaining work

- Production archive/license public keys are not supplied by Part 02. Production
  intentionally fails closed until final integration provisions immutable trust
  anchors.
- Initial activation, device refresh credential lifecycle, authoritative clock
  refresh, payment UI/QR, and Backend networking remain Part 03 work.
- A fresh installation with no local grant reports no local license without
  requiring rollback high-water state. If a cached grant exists but high-water
  state is missing or invalid, restore still fails closed and requires refresh.
- Protected PDF/image/DOCX/XLSX renderers, watermark overlay, file association,
  installer locale wiring, and bundling are outside this Part.
  `bundle.active` remains false.
- Credential Manager and rollback checks are best-effort platform controls, not
  hardware binding or a trusted-clock guarantee.
- External review remains user-operated and is not claimed as already passed.

No mandatory Part 02 acceptance item remains unimplemented.

## 13. Clean review archive

The clean archive is generated only after this report is saved. Its exact path
and tar-content validation are recorded in the final delivery message to avoid
a self-referential report/archive filename cycle. It must contain current
source, tests, docs, Part instruction, this report, and deterministic fixtures
while excluding `.git`, `.codex`, `target`, `node_modules`, `dist`,
screenshots, credentials, secrets, and prior archives.
