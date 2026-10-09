# PART 03 Report

**Status:** COMPLETE

**Branch:** `feat/archive-core-viewer`  
**Validated:** 2026-09-11

## 1. Scope delivered

Part 03 implements the Rust Viewer-to-Backend adapter, exact authoritative
archive metadata comparison, device-bound Payment Intent lifecycle, Windows
secure storage for intent and refresh credentials, local Solana Pay QR display,
payment polling/finality states, Device A activation and refresh, cached offline
reopen, mandatory refresh, and a Rust-only protected archive reader with
bounded authenticated range reads.

The implementation continues the reviewed Part 01/02 boundaries. The requested
follow-up adds the Windows NSIS installer, `.slr` shell association,
single-instance file-open routing, installer-locale bridge, and a restrained
desktop UI over the existing Part 03 state machine. It does not implement a
Marketplace Backend, blockchain verification, payment transaction
construction, protected renderers, watermark rendering, export/external-open,
or any Part 04 feature. No frozen shared API, `.slr`, money, crypto, HPKE,
signature, or license contract was changed.

### Targeted lifecycle hotfix

The post-review hotfix makes persisted intents resumable only while their
purpose-separated TOKEN32 credential is present and valid in secure storage.
A missing, malformed, non-UTF-8, or corrupt credential is treated as an
orphan: the unusable credential and active-intent metadata are cleared, the
old QR is not resumed, and a new intent can be created after cleanup. No secret
is reconstructed from public intent or payment data.

The final activation-recovery hotfix preserves the confirmed intent credential
through Backend success, fresh P/W/SIG validation, verified refresh-token
storage, validated-grant persistence, rollback-state update, and protected
reader installation. Failures or process restart before that durable
replacement therefore retain the serialized fresh-nonce activation retry from
`docs/API.md` §9.3. Only then is the old intent deleted best-effort. Cleanup
failure never removes the purchased license/refresh token or relocks content;
the intent is hidden as completed and cleanup is retried after a valid cached
reopen, which also prevents a stale QR or duplicate purchase.

## 2. Exact implementation inventory

- Workspace dependencies: `Cargo.toml`, `Cargo.lock`,
  `apps/viewer/package.json`, `apps/viewer/src-tauri/Cargo.toml`, and
  `pnpm-lock.yaml`.
- Backend boundary: new `apps/viewer/src-tauri/src/backend/{mod.rs,config.rs,
  error.rs,dto.rs,client.rs,dev_fixture.rs}`.
- Viewer Rust lifecycle: new `clock.rs`, `payment_repository.rs`,
  `payment_service.rs`, and `launch.rs`; updated `lib.rs`, `archive_service.rs`,
  `session.rs`, `secure_store.rs`, `license_repository.rs`, and `error.rs`.
- Core protected access: updated `crates/solarch-core/src/archive.rs`,
  `canonical.rs`, `format.rs`, `license.rs`, and `lib.rs`.
- Frontend: updated `apps/viewer/src/{App.tsx,App.test.tsx,ipc.ts,i18n.tsx,
  styles.css}` and added focused `app/`, `components/`, and `features/`
  modules for archive, payment, and file states.
- Windows packaging: updated `apps/viewer/src-tauri/tauri.conf.json` for NSIS
  and `SolArch Archive`; added `scripts/viewer-windows-installer-smoke.ps1` and
  updated `scripts/viewer-windows-native-smoke.ps1` for the new production DOM.
- This is the only Part 03 report.

Generated `target`, `dist`, screenshots, temporary native app data, credentials,
and dependency directories are excluded from source and from the clean review
archive.

## 3. Network and configuration architecture

`HttpBackendClient` implements exactly the five Viewer operations from
`docs/API.md`: public archive metadata, create intent, verify intent,
activate-device, and refresh license. The blocking client runs only behind
Tauri `spawn_blocking` commands. It uses pinned `reqwest 0.13.4` with Rustls,
fixed connect/request timeouts, no redirects, exact request paths and auth
schemes, a 4096-byte request cap, a 16384-byte response cap, strict JSON depth
8, duplicate-key rejection, closed serde DTOs, and sanitized typed errors.
Credential-bearing headers and Backend messages never cross IPC or enter
log-facing errors.

Production origin is immutable build-time configuration through
`SOLARCH_BACKEND_ORIGIN`. It must be an HTTPS root origin with no credentials,
query, fragment, path, or loopback host. Missing/invalid production input keeps
the Viewer fail-closed. Loopback HTTP and the deterministic synthetic Backend
exist only with the explicit `development-fixtures` feature. Production never
falls back to either mechanism. Archive-role and license-role trust anchors
remain immutable build configuration and role-separated.

The real local HTTP parser tests exercise request serialization, headers,
closed responses, duplicate fields, oversize bodies, timeout, redirects,
429/503 retryability, status/code agreement, and secret-free errors. The
feature-gated in-process Backend exists only to drive native UI integration; it
is explicitly synthetic and performs no Solana or real-USDC verification.

## 4. Metadata and Payment Intent validation

Before a new payment, Rust compares Backend metadata to the already trusted
local Public Header and finalized fingerprint: archive ID, fingerprint, creator
wallet, integer-parsed USDC price, currency, 500 bps platform fee,
`max_devices = 1`, export policy, watermark policy, and published state. The
Backend `title` is editable marketplace presentation and is deliberately not a
security-critical equality field, as required by `docs/SLR_FORMAT.md` §3; the
Viewer continues to display the signed local title. A critical-field mismatch
returns `METADATA_MISMATCH`; no intent or QR is created.

Intent validation binds the returned opaque ID, archive, fingerprint, exact
Device A key, integer micro-USDC total and exact 95/5 shares, currency,
canonical 32-byte Base58 reference, canonical TOKEN32 secret, created status,
strict timestamps with `expires_at = created_at + 1800s`, and exact
`solana:<absolute HTTPS expected-origin transaction path>` without encoding,
query, fragment, credentials, or secret/device/economics data.

The external-review metadata fix removed only the invalid Backend-title versus
signed-title equality. A regression accepts a different presentation title
while all trusted fields match, and a companion mutation table still rejects
archive ID, fingerprint, creator wallet, base-unit price, currency, fee,
device/export/watermark policy, and published-state mismatches.

The one-time client secret is written and reread from the purpose-separated
Windows Credential Manager entry before nonsecret intent state is atomically
stored and before QR data is returned. A write/reread failure exposes no QR.
Only hashed-name, bounded, canonical, nonsecret active-intent metadata is stored
in app data. Restart resume repeats archive/fingerprint/device/money/time/URL
validation and requires the secure secret. Lost secret fails closed and a
matching nonterminal intent prevents duplicate creation. Missing, non-UTF-8,
or invalid-TOKEN32 credentials instead identify an orphaned intent: verified
cleanup removes its unusable local state before Rust permits a replacement
intent and QR.

## 5. Payment state machine and QR

The frontend receives only amount, currency, expiry, public status, opaque
intent ID, and the exact Rust-validated Solana Pay URL. `qrcode.react` renders
the QR locally; no wallet address, secret, refresh token, ACK, key, transaction
builder, or paid boolean exists in frontend state or IPC.

Rust serializes payment operations and uses `try_lock` for at most one verify
request in flight. Exact responses map to Locked `pending`, Locked
`awaiting_finality`, or `confirmed`; only confirmed advances to activation.
Frontend polling has one timer and a bounded two-retry exponential backoff for
retryable Backend failures before the explicit retry UI. Transient failures
preserve the active intent. Terminal expired/failed/invalid-credential states
stop polling and delete verified intent storage. Archive switch/close clears
runtime polling state without discarding a durable resumable intent.

RU and EN cover all required Part 03 states, including preparing, pending,
awaiting finality, activating, unlocked catalog, Backend unavailable, expired,
failed, device limit, revoked, refresh required/refreshing, blocked, and generic
error. Creator metadata is never translated. The UI contains no Save As,
Extract, Open External, or renderer controls.

## 6. Activation, refresh, and cached reopen

Every activation or refresh attempt uses a fresh 32-byte OS CSPRNG nonce encoded
as canonical padded Base64. The response passes the existing typed Part 02
fresh-response validator: bounded P/W/SIG parse, exact outstanding nonce,
Ed25519 role trust, archive/fingerprint/device/rights/time binding, RFC 9180
HPKE Open, and exact 32-byte ACK. Failed validation stores no token, grant, or
ACK. A lost-response retry uses a different nonce.

Activation finalization order is: validate TOKEN32 and the entire fresh signed
issuance; securely write/reread the purpose-separated refresh token; save only
`ValidatedFreshLicenseGrant` P/W/SIG; reset authenticated rollback high-water;
construct the protected reader from the still-identical archive; then hide and
best-effort delete the completed intent secret and metadata. Before reader
installation, any local failure leaves the old intent credential available for
a serialized retry with a fresh nonce. A changed `.slr` remains denied while
the issued grant and refresh credential remain available for reopening the
original bytes. After installation, cleanup failure does not revoke or relock
the purchased access. Every successful cached reopen or refresh retries cleanup
of a matching stale confirmed intent before returning the Unlocked snapshot.

Refresh first fully revalidates cached signature, archive/fingerprint/device,
rights, HPKE, and signed identity even when the old 72-hour window has expired.
It never treats the historical signed request nonce as an outstanding nonce.
The Backend request then uses the secure refresh token and a new nonce; the
fresh response validator remains exact. Success stores the new signed grant,
resets rollback state, replaces the protected reader/ACK, and establishes the
new exact 72-hour window. The v1 refresh token does not rotate. Terminal
revocation/expiry/device failures relock and delete the refresh credential;
Backend unavailability at/after deadline cannot expose content.

A valid cached grant before its deadline reopens offline after process restart
without metadata or Backend access and without retaining an outstanding nonce.
Every reopen repeats signature, binding, time, HPKE, rollback, archive identity,
and fingerprint checks.

## 7. Protected reader and range access

`ProtectedArchiveReader` owns a stable opened archive handle, the verified path
identity, full finalized signature/fingerprint binding, derived zeroizing keys,
authenticated decrypted Manifest and IDX1, and validated DAT1 layout. It is
created only after a valid ACK and re-verifies the Locked archive before state
upgrade. Path replacement or identity/fingerprint change fails closed.

The internal Rust API lists authenticated Manifest files and reads by
authenticated `file_id`. Each call is capped at 4 MiB, uses checked ranges,
derives only intersecting Manifest chunk IDs, seeks only to authenticated index
offsets, reads/decrypts only required DAT1 ciphertext, authenticates every
XChaCha20-Poly1305 chunk, and returns a zeroizing plaintext buffer. Temporary
chunk plaintext and derived keys are zeroized; no protected plaintext file is
written. Unknown IDs, overflow/out-of-range, wrong ACK, tamper/truncation, and
archive replacement fail closed. There is deliberately no generic plaintext
range Tauri IPC; Part 04 renderers will consume this Rust boundary.

Rust checks `now >= offline_valid_until` before file catalog or range access.
The transition replaces `Unwrapped` with `Locked`, dropping the reader,
decrypted Manifest, ACK-derived keys, and license metadata, and returns
`RefreshRequired`.

## 8. Dependencies

- Rust: pinned `reqwest 0.13.4` with blocking/Rustls only, `url 2.5.8`,
  Windows-only `tauri-plugin-single-instance 2.4.4`, and `winreg 0.56.0` for
  the NSIS locale bridge.
- Frontend: pinned `qrcode.react 4.2.0` (local SVG generation, no network QR
  service) and `lucide-react 1.43.0` for restrained functional icons.
- The existing pinned `ed25519-dalek` and `hpke` crates are optional Viewer
  dependencies only for the explicit synthetic `development-fixtures` issuer;
  production does not compile that module.

`rtk pnpm audit --audit-level high` reported no known vulnerabilities.
`cargo-audit` is not installed (`cargo audit` returned “no such command”) and is
not represented as having run. Dependency trees and feature boundaries were
reviewed; no new parser or custom cryptographic primitive was introduced.

## 9. Validation evidence

Required checks on the final source state all passed:

| Command | Result |
| --- | --- |
| `rtk cargo fmt --check` | pass |
| `rtk cargo clippy --workspace --all-targets -- -D warnings` | pass |
| `rtk cargo clippy --workspace --all-targets --all-features -- -D warnings` | pass, no issues |
| `rtk cargo test --workspace` | pass, 114 tests in 7 suites |
| `rtk pnpm install --frozen-lockfile` | pass, lockfile unchanged |
| `rtk pnpm lint` | pass, strict TypeScript |
| `rtk pnpm test` | pass, 22 tests in 2 files |
| `rtk pnpm build` | pass, production frontend bundle |
| `node --test scripts/create-clean-archive.test.mjs` | pass, 11 tests |
| `rtk pnpm audit --audit-level high` | pass, no known vulnerabilities |
| `rtk git diff --check` | pass |

The Core frozen vector remains byte-identical: decoded length 1166 bytes and
SHA-256 fingerprint
`57ce84068fdd9b23f8860afa27834151f4fefb038d812c2ac77e8a861b1eecdb`.
The existing vector test also repeats exact signing digest, finalized bytes,
signature, archive fingerprint, license JCS, Ed25519, HPKE, and ACK checks.

New regression coverage includes strict API DTOs/network errors, authoritative
metadata before intent, secure-write-before-QR, missing/non-UTF-8/invalid-secret
restart recovery into a new intent, no duplicate valid intent, single-flight
polling, pending/finality gates, retryable vs terminal cleanup, injected
secret-delete and metadata-delete cleanup failures with preserved cached access
and later cleanup, fresh activation nonces, lost-response retry, validated-only
license persistence, refresh-token/license write failures followed by
process-restart activation recovery without a second intent, durable grant/token
retention after rollback-state failure, original-byte recovery after changed
archive blocks reader installation, cached offline restart,
expired/offline Backend denial, valid new 72-hour refresh, terminal revocation,
deadline relock, protected catalog, first/last/single/cross-chunk ranges,
unknown/overflow/oversize ranges, wrong ACK, and archive replacement.

Follow-up coverage adds exact startup-argument cardinality, Unicode `.slr`
paths, missing/wrong-extension/directory/relative/oversize inputs, the NSIS
string/DWORD language-value bridge, startup reopen without the file picker,
same-instance external archive switching, compact locale persistence, honest
payment/finality presentation, secret-free DOM assertions, and the unlocked
file-table contract. The final metadata regression accepts a different Backend
presentation title while a ten-case mutation matrix still rejects every
security-critical archive/fingerprint/creator/money/fee/policy/status mismatch.

## 10. Windows-native validation

The following ran through native Windows `cargo.exe`/PowerShell, not as WSL-only
checks:

- `cargo.exe test --workspace`: pass; 10 CLI + 60 Core + 46 Viewer tests. The
  Viewer set includes real Windows Credential Manager device restart and keyed
  intent/refresh purpose separation, durable reread, delete, isolation, Unicode
  startup paths, bounded argv validation, and exact installer-locale mapping.
- `cargo.exe test --manifest-path apps/viewer/src-tauri/Cargo.toml
  --all-features --lib`: 46/46 pass.
- The production frontend and Windows Rust binary were bundled by the pinned
  Tauri CLI into a real 3.1 MiB NSIS executable under the expected ignored
  `target/release/bundle/nsis/` path. This used the standard Tauri v2 NSIS
  template, not a mock installer or registry test double.
- `viewer-windows-installer-smoke.ps1` returned
  `WINDOWS_NSIS_LANGUAGE_SELECTOR_PASS`,
  `WINDOWS_INSTALLER_RU_AND_VIEWER_SWITCH_PERSIST_PASS`,
  `WINDOWS_INSTALLER_EN_FIRST_LAUNCH_PASS`,
  `WINDOWS_FILE_ASSOCIATION_SINGLE_INSTANCE_PASS`,
  `WINDOWS_UNTRUSTED_ARGV_FAIL_CLOSED_PASS`, and
  `WINDOWS_UNINSTALL_ASSOCIATION_CLEANUP_PASS`.
- A native development integration build with
  `desktop-runtime,custom-protocol,development-fixtures` passed, and
  `viewer-windows-native-smoke.ps1 -Part03DevIntegration` returned
  `WINDOWS_NATIVE_PART03_DEV_INTEGRATION_PASS`.

The installer smoke exercised the visible pre-install selector and found only
the exact native labels `Русский` and `English`; it installed each language
from a clean state and observed the corresponding first Viewer locale. It then
switched RU to EN inside the Viewer, restarted, and observed the persisted EN
preference independent of the installer setting. Registry inspection confirmed
`.slr` points to the quoted installed executable as `SolArch Archive`.

Explorer-style launch of the valid Unicode-named 1166-byte `.slr` started one
Viewer and reached the Rust verifier. The production build correctly stopped
at `UNTRUSTED_ARCHIVE` because production trust anchors are not yet supplied.
A second `.slr` reached the same running process, focused its window, replaced
the displayed result, and did not create a second Viewer. Wrong-extension and
extra argv launches remained at Empty. Uninstall restored the pre-test active
association and did not leave `SolArch Archive` active. The harness restored
the pre-test installer-locale value and removed only credentials it created.

The development smoke proved manual Open still uses the native picker and the
same trusted Rust flow: matching metadata to Locked; secret-first exact QR;
pending and awaiting-finality while Locked; confirmed activation with synthetic
signed P/W/SIG and HPKE ACK; Unlocked catalog; cached reopen; mandatory refresh;
and online refresh to a new 72-hour window. It is a development integration,
not a real blockchain/USDC payment. Screenshots of Empty, Locked, payment,
awaiting-finality, Unlocked, cached reopen, and refresh states were inspected;
screenshots and temporary data remain under ignored/excluded `target/` only.

## 11. UI / Windows UX follow-up

The production shell is now a restrained Windows desktop utility rather than a
dashboard. It uses the specified flat dark palette, Segoe UI Variable, a 4/8 px
spacing rhythm, 1 px borders, small radii, one weak elevated-surface shadow,
and accent only for focus, selection, and the primary unlock action. A source
and built-CSS scan found no gradient, glow, glass/backdrop filter, purple/cyan
theme, fake window controls, marketing hero, or decorative feature claims. The
white QR surface is the sole functional color exception.

`App.tsx` now composes a controller with focused chrome, archive, payment, and
file components. The global chrome contains only SolArch, current archive,
manual Open, quiet device status, and the accessible persisted `RU | EN`
switch. The device public key is not rendered. Empty is a compact open surface;
verification reports only one truthful loading state; Locked emphasizes price
and verified status; payment keeps archive context and clearly distinguishes
pending from awaiting finality; Unlocked is a `Name | Type | Size` table with no
renderer, preview, export, extraction, or external-open control.

NSIS is active for Windows with only Russian and English and its native
pre-install selector. Tauri's standard installer persists `Installer Language`;
Rust reads the exact NSIS registry value as either its real string form or a
DWORD compatibility form, maps only 1049/1033, and supplies the initial locale
only when no Viewer preference exists. There is no `data-installer-locale`
placeholder. Subsequent in-app changes persist independently.

Tauri's supported `bundle.fileAssociations` registers `.slr` as
`SolArch Archive`. The supported single-instance plugin is the first registered
plugin. Cold startup obtains untrusted arguments through `args_os` into
`PathBuf`; both cold and already-running paths require exactly one absolute,
existing, regular, bounded `.slr` and enter the same serialized
`open_archive_flow`. The second instance focuses the existing window. Validated
archive switching resets the prior payment/session reader before verification,
so an old ACK or protected reader cannot survive a switch.

## 12. Security review and integration impact

- Credentials, Device A private key, ACK, derived keys, authorization headers,
  and plaintext protected bytes do not cross IPC and are not serialized to app
  data, localStorage, DOM, logs, or ordinary errors.
- Production configuration cannot use runtime user input, localhost, HTTP,
  downloaded trust, synthetic grants, or mock fallback.
- Every local grant used for offline open or refresh routing is cryptographically
  revalidated. Only a fresh validator-produced typed grant reaches persistence.
- `awaiting_finality` never means paid; only exact Backend `confirmed` can enter
  activation, and Unlocked occurs only after durable security state succeeds.
- Archive switch and failed open cannot retain a prior protected reader/ACK.
- Viewer remains a best-effort DRM client, not an absolute trusted boundary.

No unresolved local Part 03 security finding remains.

## 13. Integration blockers and remaining work

- Final production Backend HTTPS origin and production archive-role/license-role
  public trust anchors were not supplied. Production intentionally remains
  fail-closed until those immutable build inputs are provisioned.
- No live teammate Backend was available, so no live API or real-USDC smoke is
  claimed. The exact Viewer handoff is the five documented endpoints, exact
  closed DTOs/status literals, Device A canonical padded Base64, TOKEN32 auth,
  fresh padded-B64 request nonce, and exact signed P/W/SIG plus HPKE W.
- Cross-branch Backend/Solana-finalized/real-USDC integration remains a later
  integration obligation; Viewer does not emulate it in production.
- Fee rounding is an explicit shared-contract blocker for Backend integration.
  `docs/SLR_FORMAT.md` §3 permits every positive six-decimal USDC base-unit
  price, while `docs/PAYMENTS.md` §5 requires deterministic integer rounding
  and recommends `creator = total - platform` without specifying whether the
  5% `platform_units` calculation uses floor, ceiling, nearest, or another
  exact rule. `docs/API.md`, `docs/DATA_MODEL.md`, `docs/INTEGRATION.md`, and
  the current role documents add no rounding rule or price-divisibility
  validation, and this repository contains no Marketplace implementation that
  narrows the accepted prices. The Viewer therefore retains its existing
  fail-closed semantics: it accepts an intent split only when
  `total_units * 95` is exactly divisible by 100 (equivalently, total micro-USDC
  is divisible by 20), with creator at exactly 95% and platform as the exact
  remainder. Non-divisible but SLR-valid prices cannot integrate until the team
  freezes one rounding rule and aligns Backend, Viewer, tests, and shared docs;
  no floor/ceiling policy was invented in this Part.
- Part 04 still owns internal PDF/image/DOCX/XLSX renderers, visible watermark,
  and protected-content viewing implementation. This follow-up did not start
  that work.

No mandatory Part 03 implementation item remains open.

## 14. Clean review archive

The clean archive is generated only after this report is saved. Its exact path
and tar-content validation are recorded in the delivery message to avoid a
self-referential report/archive filename cycle. It contains current source,
tests, docs, Part instruction, this report, and deterministic public fixtures,
while excluding `.git`, `.codex`, `target`, `node_modules`, `dist`, screenshots,
credentials, secrets, and prior archives.
