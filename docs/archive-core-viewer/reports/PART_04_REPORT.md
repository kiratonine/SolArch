# PART 04 Report — Protected Internal Viewers

**Status:** COMPLETE  
**Branch:** `feat/archive-core-viewer`  
**Completed:** 2026-09-12  
**Execution:** strict single-agent

## Scope delivered

Part 04 extends the reviewed Part 03 authenticated session with internal,
read-only viewers for exactly PDF, PNG/JPEG/WebP, DOCX, and XLSX. All protected
content comes from the current `ProtectedArchiveReader`; there is no external
open, extraction, export, printing, or plaintext temporary-file path. A common
RU/EN viewer shell, visible license-derived watermark, typed renderer failures,
bounded parsing, renderer cleanup, and Rust-authoritative offline expiry are in
place.

No Backend endpoint, shared DTO, `.slr`, payment, Device License, HPKE, signature,
or other frozen wire/crypto contract changed. Part 05 was not started.

## External-review hardening follow-up

The production Windows WebView2 boundary now applies
`AreDefaultContextMenusEnabled=false`, `AreBrowserAcceleratorKeysEnabled=false`,
and `AreDevToolsEnabled=false` through the Tauri-owned controller before any
protected renderer request is accepted. Failure to apply that native boundary
keeps renderer open fail-closed and terminates startup. The common protected
surface also cancels `contextmenu`, Ctrl+P, Ctrl+S, F12, and browser DevTools
shortcuts as defense-in-depth while leaving Tab, arrow-key navigation, and normal
control activation intact. No shell, opener, print, download, or save capability
was added.

Renderer opening is now a two-phase Rust protocol. `renderer_begin_open` creates
a session-bound, monotonically generated request token and supersedes the prior
request/current renderer. A format-specific open may publish a handle only if
that exact token is still current after authenticated reads and parsing finish.
Close, file switch, retry, relock, and expiry cancel pending tokens; a stale
completion drops its local plaintext state and receives `RENDERER_CLOSED` without
mutating the latest renderer. A late frontend Promise also immediately closes any
returned stale handle.

PDF canvas assignment now has an explicit 16,777,216-pixel and 16,384-pixel-per-
dimension budget after zoom/device scaling and before setting `canvas.width` or
`canvas.height`. Invalid or pathological viewports close the Rust renderer and
PDF loading task with the typed renderer-limit message. `pdfjs-dist 6.3.289` does
not expose `enableScripting` in `getDocument(DocumentInitParameters)`, so no
ignored unsupported property is passed. This Viewer never constructs PDF.js's
scripting manager or annotation/action layer; XFA remains explicitly disabled.

## Files changed

- Workspace dependencies: `Cargo.toml`, `Cargo.lock`, `pnpm-lock.yaml`.
- Viewer dependency/config: `apps/viewer/package.json`,
  `apps/viewer/src-tauri/Cargo.toml`, `apps/viewer/src-tauri/tauri.conf.json`.
- Rust renderer/session boundary: `apps/viewer/src-tauri/src/renderer.rs`,
  `archive_service.rs`, `session.rs`, `error.rs`, and `lib.rs`.
- Synthetic development integration only:
  `apps/viewer/src-tauri/src/backend/dev_fixture.rs`.
- Internal Core helper: `crates/solarch-core/src/archive.rs`.
- React integration: `apps/viewer/src/App.tsx`, `App.test.tsx`,
  `app/useViewerController.ts`, `ipc.ts`, `i18n.tsx`, `styles.css`,
  `features/files/FileTable.tsx`, and `features/files/UnlockedWorkspace.tsx`.
- New viewer components/tests: `features/viewers/ProtectedViewer.tsx`,
  `ViewerSurface.tsx`, `WatermarkOverlay.tsx`, `PdfViewer.tsx`,
  `ImageViewer.tsx`, `DocxViewer.tsx`, `XlsxViewer.tsx`, and
  `ProtectedViewer.test.tsx`.
- Deterministic synthetic archive:
  `tests/fixtures/slr_v1_multiformat.b64` and
  `tests/fixtures/slr_v1_multiformat.fingerprint`.
- Native smoke coverage: `scripts/viewer-windows-native-smoke.ps1`.
- This report: `docs/archive-core-viewer/reports/PART_04_REPORT.md`.

## Renderer architecture and plaintext bridge

`ArchiveService` owns one opaque renderer registry inside the active Unwrapped
session. Handles contain only a session serial and monotonic handle number; they
are nonsecret, bound to the current session, and only one file renderer may be
current. File switch replaces and drops the previous renderer. License reinstall,
archive switch, close, relock, exact deadline, or process exit drops the registry
and invalidates all old handles.

The authenticated Manifest MIME chooses the renderer. Each open/read operation
rechecks the offline deadline and current session, and archive identity is
revalidated by Core during protected reads. The new
`ProtectedArchiveReader::read_complete_file_bounded` is an internal Rust API only:
it reassembles bounded format-specific input through authenticated chunk reads
and then verifies the complete Manifest SHA-256. It is not exposed as a generic
IPC plaintext API.

The Tauri IPC surface is format-specific:

- PDF: open plus bounded range read;
- image: open/decode plus sanitized PNG presentation bytes;
- DOCX: open plus a bounded semantic document model;
- XLSX: open/sheet inventory plus bounded cell windows;
- common opaque renderer close and protected-session status.

All heavy archive, parser, decoder, and spreadsheet work runs behind
`spawn_blocking`. Frontend code receives no ACK, derived key, refresh token,
intent secret, encrypted offsets, or unrestricted raw-file primitive.

## PDF viewer

PDF.js `6.3.289` and its worker are bundled locally. Rust verifies the PDF marker
and terminal EOF marker, then serves at most 256 KiB per authenticated range.
PDF.js streaming and eager auto-fetch are disabled. The React viewer renders to a
canvas and provides previous/next page, page count, 25–400% zoom, fit page, fit
width, and close controls.

Annotations, XFA, annotation/link/action layers, automatic navigation, download,
save, and print controls are absent. Malformed/truncated input and invalid ranges
produce typed failures rather than an external-viewer fallback.

## Image viewer

Rust accepts only the authenticated PNG/JPEG/WebP MIME, independently detects the
encoded format, checks dimensions before full decode, and re-encodes decoded
pixels to a sanitized PNG. React presents only that bounded PNG through a local
Blob URL, with fit, 25–400% zoom, reset, and close. Blob URLs are revoked and the
Rust buffer/handle is dropped on close, switch, relock, or expiry.

## DOCX viewer

The Rust OOXML preflight rejects unsafe ZIP topology, encrypted entries, macro
payload/content types, DTD/processing-instruction content, unsafe entities,
duplicate attributes, excessive nesting, and oversized expansion. The exact
DOCX main content-type override is required. External relationships are parsed as
untrusted XML but are never fetched or surfaced as active links.

`word/document.xml` becomes a typed semantic model containing paragraphs,
headings, list paragraphs, bold/italic/underline runs, line breaks, tabs, and
basic tables. React creates text nodes and semantic elements; archive-controlled
text is never inserted as HTML. The viewer is read-only and has no Word launch.

## XLSX viewer

The same bounded OOXML preflight additionally rejects external links,
connections, and `TargetMode=External` workbook relationships. Calamine opens the
bounded in-memory workbook read-only. Formulas are never recalculated or executed;
only cached/display values are returned.

The frontend exposes accessible sheet tabs and a grid. Rust returns at most a
100-row by 50-column window; the current UI requests 40 by 12 and pages rows and
columns. It never materializes an entire large workbook in the DOM. There is no
Excel launch, editing, or workbook export.

## Watermark and no-export enforcement

Rust derives a nonsecret descriptor from the current validated signed license and
verified archive: first six characters, ellipsis, and last four characters for
long buyer wallet/license/archive identifiers. The repeated diagonal overlay is
shared by all four viewer families, remains above content and below controls, and
uses `pointer-events: none`. Tests verify descriptor replacement after a new
validated license, old-handle invalidation, and removal on expiry.

There is no `Save As`, `Export`, `Extract`, `Open External`, protected download,
or print control. No shell/opener capability or command was added. The only CSP
change is local `blob:` image support for the sanitized PNG Object URL; scripts,
styles, PDF worker, and renderer assets remain local. This is visible,
best-effort watermarking and does not claim to prevent screenshots, recording,
memory inspection, or a modified Viewer.

## Expiry and cleanup

Every protected call enforces `now < offline_valid_until`. On Unlocked snapshots,
Rust arms a token containing the exact session serial and deadline. At
`now >= offline_valid_until`, the matching Rust session relocks, drops the reader,
ACK-derived state and renderer registry, and emits
`viewer://protected-session-expired`. Stale timer tokens cannot relock a newer
session.

React immediately removes files, watermark, canvas/DOM/grid content, revokes Blob
URLs during unmount, and enters `RefreshRequired`. It also asks Rust to recheck on
focus, visibility change, and every 15 seconds to cover resume/sleep. A bounded,
feature-gated development-only delay made the native deadline smoke deterministic;
production always uses the signed deadline.

## Resource limits

- PDF IPC range: 256 KiB; open probe: 8-byte prefix and 1 KiB tail.
- PDF canvas: 16,777,216 pixels total and 16,384 pixels per dimension after
  device-pixel scaling, checked before browser canvas allocation.
- Image encoded source: 32 MiB; decoded pixels: 16,777,216; RGBA/output budget:
  64 MiB; dimensions checked before full decode.
- DOCX/XLSX encoded source: 32 MiB; ZIP entries: 2,048; one expanded entry:
  16 MiB; total expanded package: 64 MiB; XML depth: 128.
- DOCX: 1 MiB text, 10,000 blocks, 100,000 runs, 20,000 table cells.
- XLSX: 64 sheets, 200,000 declared cells per worksheet, 1,000,000-cell range
  area, 4 KiB display value, and 100x50 maximum IPC window.
- File IDs, handles, arithmetic, entry names, duplicate paths/attributes, macro
  payloads, and MIME/renderer matches are validated fail-closed.

## Tests added or extended

Rust covers PDF probe/truncation, bounded range and archive tamper, all three
image formats and MIME mismatch, malformed image and decoded-pixel bomb, DOCX
formatting/table/inert script text, DTD/entity/duplicate-attribute/macro/depth
attacks, XLSX sheets/cached formula/window bounds, external relationship and huge
range rejection, session-bound handle replacement, exact deadline and stale
timer behavior, watermark replacement, and a real encrypted six-format `.slr`
through ArchiveBuilder, signature verification, ACK install, and renderer reads.

The deterministic multi-format archive is 7,655 bytes with fingerprint
`410964651c82df094a4e2e653e9340816b0c5f0b1908343ab55b493a0c0692c4`.
It includes a two-page PDF, PNG/JPEG/WebP, semantic DOCX content/table, and a
two-sheet XLSX with a cached formula value. The test regenerates the archive and
requires byte-identical fixture output.

The original frozen interoperability archive also remains byte-identical at
1,166 bytes with fingerprint
`57ce84068fdd9b23f8860afa27834151f4fefb038d812c2ac77e8a861b1eecdb`.
Both sizes were re-read from native smoke inputs, and both fingerprints remain
asserted by the passing deterministic Rust tests.

Frontend tests cover all renderer families, PDF first/last navigation and bounded
ranges, zoom limits/fit, pathological viewport rejection before canvas
allocation, image Blob cleanup, DOCX inert text and table, bounded XLSX sheet
switching, common watermark/no-escape UI, native-command defense events, typed
retry, late-open cleanup, A-to-B reverse completion ordering, and immediate
content/watermark removal on the Rust expiry event. Rust registry tests separately
cover cancel-before-complete, retry supersession, reverse completion, and stale
handle close without displacement of the current renderer.

Existing Part 01/02/03 archive, frozen 1,166-byte vector, crypto/license, payment,
activation recovery, cached reopen, Windows identity/storage, locale, and
single-instance tests remain passing.

## Dependency review and audit

- `pdfjs-dist = 6.3.289`, Apache-2.0: maintained Mozilla PDF renderer; worker is
  local and lazy-loaded.
- `image = 0.25.10`, MIT OR Apache-2.0, default features disabled with only
  PNG/JPEG/WebP: maintained image-rs decoder/encoder with explicit limits.
- `calamine = 0.36.1`, MIT, default features disabled: maintained read-only
  spreadsheet parser. The direct hardened XML parser remains pinned at
  `quick-xml = 0.42.0`; Cargo also resolves Calamine's compatible
  `quick-xml 0.41.0`. Existing ZIP handling remains pinned/reviewed.
- `webview2-com = 0.38.2` and matching `windows-core = 0.61.2` are pinned direct
  Windows dependencies for the narrow supported WebView2 settings boundary;
  both versions were already present transitively through Tauri/wry.

`rtk pnpm audit --audit-level high` completed with “No known vulnerabilities
found”. Upstream license/maintenance metadata and relevant advisory status for
the added pinned dependencies were reviewed. `cargo-audit` is not installed in
this environment (`cargo audit` returned “no such command”), so no automated
Rust audit is claimed.

## Validation results

- `rtk cargo fmt --check` — PASS.
- `rtk cargo clippy --workspace --all-targets --all-features -- -D warnings` —
  PASS, no warnings.
- `rtk cargo test --workspace` — PASS, 127 tests across seven suites.
- `rtk pnpm install --frozen-lockfile` — PASS.
- `rtk pnpm lint` — PASS.
- `rtk pnpm test` — PASS, 34 tests in three files.
- `rtk pnpm build` — PASS; 1,873 modules transformed and the PDF worker emitted
  as a local production asset.
- `rtk pnpm audit --audit-level high` — PASS, no known vulnerabilities.
- `node --test scripts/create-clean-archive.test.mjs` — PASS, 11/11.
- `rtk git diff --check` — PASS before report/archive finalization and rerun after
  them.

## Windows-native validation

These checks ran with native Windows `cargo.exe`, PowerShell, WebView2, and NSIS;
they are not inferred from WSL:

- `cargo.exe test --workspace` — PASS: 10 CLI + 60 Core + 59 Viewer tests,
  including real Windows Credential Manager coverage.
- `cargo.exe check --manifest-path apps/viewer/src-tauri/Cargo.toml
  --all-features` — PASS, including the native WebView2 COM settings boundary.
- A native release build with
  `desktop-runtime,custom-protocol,development-fixtures` — PASS.
- The pinned Tauri v2 CLI built the final 4.1 MiB x64 NSIS installer at the
  ignored `target/release/bundle/nsis/` path — PASS.
- `viewer-windows-installer-smoke.ps1` returned
  `WINDOWS_NSIS_LANGUAGE_SELECTOR_PASS`,
  `WINDOWS_INSTALLER_RU_AND_VIEWER_SWITCH_PERSIST_PASS`,
  `WINDOWS_INSTALLER_EN_FIRST_LAUNCH_PASS`,
  `WINDOWS_FILE_ASSOCIATION_SINGLE_INSTANCE_PASS`,
  `WINDOWS_UNTRUSTED_ARGV_FAIL_CLOSED_PASS`, and
  `WINDOWS_UNINSTALL_ASSOCIATION_CLEANUP_PASS`.
- `viewer-windows-native-smoke.ps1 -Part04DevIntegration` returned
  `WINDOWS_WEBVIEW2_NO_EXPORT_PASS`,
  `WINDOWS_PROTECTED_KEYBOARD_NAVIGATION_PASS`, and
  `WINDOWS_NATIVE_PART04_DEV_INTEGRATION_PASS`.

The multi-format smoke opened the trusted synthetic archive through the real
Rust flow, completed the synthetic Part 03 activation, saw all six files, rendered
PDF page 2, each image type, DOCX heading/table, and both XLSX sheets internally,
and observed the watermark throughout. It switched directly among renderers,
found no escape action, dispatched a right-click through the native WebView2 input
path without a Save Image/Save As menu, verified native Ctrl+P/Ctrl+S did not expose print/save UI,
and switched XLSX sheets with the physical Right Arrow key. It reopened from the
cached Device A grant, forced exact
deadline relock with content removal, denied mandatory refresh while Backend was
unavailable, and found no protected plaintext or secret in its isolated app-data
directory. Screenshots were inspected and remain only under ignored `target/`.
The synthetic fixture is not represented as a real USDC purchase.

## Security review

- Authenticated Manifest MIME and the active Rust license/session remain
  authoritative; frontend input cannot select a mismatched parser or watermark.
- Every protected byte originates in AEAD-authenticated Core reads; whole-file
  image/OOXML paths additionally verify the complete Manifest hash.
- Renderer handles and pending request tokens become useless after
  switch/retry/relock and expose no secret. The latest Rust-issued token, rather
  than Promise completion timing, is authoritative; cancellation and stale
  completion cannot retain or replace protected renderer state.
- OOXML has bounded ZIP expansion and hardened XML/relationship/macro checks;
  DOCX text is never executable markup and XLSX formulas/external data do not run.
- Image decompression dimensions and allocation are bounded before presentation.
- Default WebView2 context menus, browser accelerators, and DevTools are disabled
  at the native controller, with protected-surface event cancellation layered on
  top; normal keyboard navigation remains tested.
- CSP remains local-only except the narrow sanitized-image `blob:` source; no
  external opener, filesystem broadening, CDN, renderer telemetry, or plaintext
  persistence was introduced.

## Known fidelity limitations

- PDF is canvas-only: annotations, forms, XFA, links/actions, selectable text,
  search, and printing are intentionally absent.
- DOCX is a safe semantic subset rather than Word-compatible layout. Embedded
  images, styles beyond basic headings/runs/lists/tables, headers/footers,
  pagination, and complex drawings are not rendered.
- XLSX displays bounded cached cell values and basic sheets/grid only. It does not
  recalculate formulas or implement Excel styling, charts, merged-cell fidelity,
  external data, or editing.
- Images are decoded and re-encoded as PNG, so presentation is safe and bounded
  rather than a byte-preserving export path.
- Best-effort DRM cannot prevent screenshots, screen recording, memory inspection,
  or a modified client.

## Backend/API impact and Part 05 boundary

Production Backend/API impact is **none**. The added `part04-payment` development
fixture mode is feature-gated, synthetic, and requires the exact test archive
fingerprint; it does not alter production endpoints or validation. Production
still fails closed without configured Backend origin and production trust anchors.

Part 05 still owns live Marketplace Backend/HTTPS and production trust-anchor
integration, the unresolved shared fee-rounding rule, real finalized USDC payment,
authoritative entitlement/activation E2E, Device B rejection for
`max_devices = 1`, and the final cross-component security/E2E pass. No fee policy
was selected or changed here.

## Clean review archive

The clean archive is generated only after this report is saved. Its exact path
and tar-content validation are recorded in the delivery message to avoid a
self-referential report/archive filename cycle. It contains current source,
tests, docs, Part instruction, this report, and deterministic public fixtures,
while excluding `.git`, `.codex`, `target`, `node_modules`, `dist`, screenshots,
credentials, secrets, and prior archives.
