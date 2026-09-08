# SolArch Archive Core & Viewer — Part 01 Report

**Part:** `PART_01`  
**Status:** `COMPLETE`  
**Updated:** `2026-09-09`  
**Branch verified:** `feat/archive-core-viewer`

## 1. Scope and result

Part 01 is complete against `TODO/PART_01_COMPLETION_AFTER_INTEGRATION_GATE.md`.
The production Rust Core and CLI now create, sign, inspect and verify the frozen
self-contained `.slr v1` format. The deterministic Integration Gate vector is
reproduced byte-for-byte, protected contents can be verified with the ACK, and
all mandatory checks pass.

This work stayed inside Archive Core/CLI. No Part 02, Viewer, Backend, payment,
device identity, license, wrapped-key or Marketplace implementation was started.
Frozen shared documents were read as authority. Only obsolete implementation-
status annotations were updated; no frozen byte/API/crypto contract changed.

The continuation was performed in strict single-agent mode. No helper agents
were used. No commit, push, merge, rebase or PR was performed.

## 2. Changes after Integration Gate 01

- Replaced the earlier 64 MiB in-memory foundation builder and provisional
  crypto/signature/fingerprint modules with the frozen production profile.
- Added a streaming `ArchiveBuilder` that inventories and validates an input
  directory, streams protected files into fixed-size chunks, creates a pending
  archive, accepts only a valid Ed25519 response, and publishes without replacing
  an existing output.
- Added trusted pending-build verification using the authorized source tree,
  metadata and binary ACK; it authenticates/decrypts every protected section and
  checks manifest, index, content lengths and plaintext hashes.
- Added finalized signature/fingerprint verification and an ACK-enabled Core API
  for full protected verification of finalized archives.
- Implemented the exact duplex CLI ACK/signing frames and strict EOF handling.
- Made `inspect` bounded and explicitly public/unverified; it never presents
  structural parsing as authorization.
- Added deterministic source traversal, six-format content probing, Unicode NFC
  normalization, full Unicode case folding, path-prefix collision rejection and
  conservative DOCX/XLSX ZIP validation.
- Added the frozen deterministic fixture and positive/negative end-to-end tests.
- Removed the obsolete modules whose semantics conflicted with the frozen Gate.
- Kept the clean-review archive tool strict and excluded the unrelated local
  `AGENTS_backup.md` file by exact basename, with regression coverage.
- Closed the 2026-09-08 external-review findings: bounded streaming source
  traversal, parsed OOXML content types, exact documented path rejection,
  expanded bounded inspect output, patched `time`, and duplicate validation
  removal. Details and regression evidence are in section 14.
- Closed the remaining 2026-09-09 findings with patched `quick-xml`, bounded
  non-quadratic collision bookkeeping, restored frozen empty-file semantics and
  final stale-status cleanup. Details are in section 15.

## 3. Production contracts implemented

### Container and canonical data

- Exact 96-byte little-endian prelude and five contiguous sections.
- Final size cap 1 GiB; protected plaintext cap 512 MiB; single-file cap
  512 MiB; 10,000 files; 1 MiB chunks; at most 16,384 chunks; bounded header,
  manifest and index sections.
- Exact closed Public Header schema and RFC 8785 JCS byte equality.
- Exact closed protected Manifest schema and RFC 8785 JCS serialization.
- Strict IDs, canonical Solana base58 key, exact USDC units/policy literals and
  calendar-valid ASCII UTC timestamps.
- Exact `IDX1` records and `DAT1` framing, including non-final chunk length rules.

### Cryptography, signature and fingerprint

- HKDF-SHA-256 key schedule and domains frozen by the Gate.
- XChaCha20-Poly1305 manifest/index/chunk encryption with exact nonces and AAD.
- Exact 104-byte `SIG1` section.
- Signing digest is SHA-256 over the pending bytes through the SIG1 prefix;
  Ed25519 verifies the exact NUL-domain-separated signing message.
- Final archive fingerprint is lowercase hex SHA-256 of every finalized byte.
- Signature trust always comes from the caller-provided key ID/public key, never
  from archive-controlled data.

### Source, paths and protected formats

- Deterministic regular-file-only source inventory; symlinks and unsupported
  topology fail closed. `read_dir` is consumed incrementally; all encountered
  entries share a bounded budget derived from 10,000 files × depth 32.
- Relative forward-slash paths; no traversal, absolute/drive/UNC/ADS paths,
  unsafe Windows names, duplicate normalized paths, or file/ancestor conflicts.
- Case collision comparison uses NFC plus Unicode default case folding. The
  pinned normalization tables are Unicode 15.1; Unicode 15.1 introduced no new
  case-fold mappings beyond the pinned folding data.
- Protected formats: PDF, PNG, JPG/JPEG, WebP, DOCX and XLSX. Extension, MIME,
  magic/container structure and OOXML main content type must agree for nonempty
  files. The frozen explicit size-0 exception uses the supported extension/MIME,
  SHA-256 of empty bytes and no chunks. OOXML `[Content_Types].xml` uses bounded
  streaming XML parsing, rejects DTD/entities/duplicate attributes, and requires
  the exact main PartName/approved ContentType pair.
- Plaintext file SHA-256 and size are verified before protected verification
  succeeds.

### Builder and CLI handoff

- Stable `ArchiveBuilder` output includes pending/final paths, signing digest,
  final fingerprint, file count and size.
- `create` reads exactly one 40-byte `ACK1` frame, emits exactly one 40-byte
  `SGN1` request, then accepts exactly 64 signature bytes followed by EOF.
- Short, malformed or extra ACK/signature bytes fail without publishing output.
- The pending file is re-digested and identity-checked before signature append;
  the complete signed file is verified before no-replace publication.
- Output races never overwrite an existing path. Cleanup only removes the same
  filesystem object created by this build.
- `verify --pending-build` requires source, metadata, signing-key ID and ACK and
  returns protected-content verification only after full decryption/integrity.
- Finalized `verify` authenticates SIG1 and reports the full-file fingerprint;
  it does not claim protected plaintext verification without the ACK.
- `inspect` reads only bounded public structure, labels it `UNVERIFIED`, and has
  a separate output bound large enough for every valid 64 KiB Public Header.

## 4. Exact files changed

Modified:

```text
Cargo.toml
Cargo.lock
README.md
crates/solarch-cli/Cargo.toml
crates/solarch-cli/src/command.rs
crates/solarch-cli/tests/cli.rs
crates/solarch-core/Cargo.toml
crates/solarch-core/src/error.rs
crates/solarch-core/src/format.rs
crates/solarch-core/src/format_inspection_tests.rs
crates/solarch-core/src/lib.rs
crates/solarch-core/src/manifest.rs
crates/solarch-core/src/paths.rs
docs/SLR_FORMAT.md
docs/INTEGRATION.md
docs/DECISIONS.md
scripts/create-clean-archive.mjs
scripts/create-clean-archive.test.mjs
docs/archive-core-viewer/reports/PART_01_REPORT.md
```

Added:

```text
crates/solarch-core/src/archive.rs
crates/solarch-core/src/canonical.rs
crates/solarch-core/src/production_crypto.rs
crates/solarch-core/src/source.rs
tests/fixtures/slr_v1_vector.b64
```

Removed as obsolete conflicting foundation code:

```text
crates/solarch-core/src/builder.rs
crates/solarch-core/src/builder_fixture_tests.rs
crates/solarch-core/src/chunks.rs
crates/solarch-core/src/crypto.rs
crates/solarch-core/src/fingerprint.rs
crates/solarch-core/src/signature.rs
```

`AGENTS_backup.md` is an unrelated pre-existing untracked user file. It was not
modified and is excluded from the review archive.

## 5. Dependency changes

- Added `hkdf 0.12.4`, `serde_jcs 0.2.0`, `base64 0.22.1`, `bs58 0.5.1`.
- Added `zip 2.4.2` with only `deflate` enabled and patched `quick-xml 0.42.0` with no
  optional features for bounded OOXML inspection.
- Pinned `unicode-normalization = 0.1.23`, `focaccia = 1.4.0`, and
  patched `time = 0.3.47` to keep behavior reproducible and remediate
  `RUSTSEC-2026-0009` without changing timestamp semantics.
- Removed `rand_core`; the Backend-provided ACK is the production Content Key.
- Removed the unused `zeroize` derive feature; runtime zeroization remains.
- `Cargo.lock` was regenerated by Cargo for this dependency graph.

## 6. Deterministic vector reproduction

The checked-in fixture `tests/fixtures/slr_v1_vector.b64` decodes to exactly
1,166 bytes. The production builder reproduces all bytes exactly, pending
verification succeeds, the Gate signature finalizes successfully, and finalized
verification returns:

```text
57ce84068fdd9b23f8860afa27834151f4fefb038d812c2ac77e8a861b1eecdb
```

The test compares the complete generated container with the decoded fixture,
not only selected fields or its digest.

## 7. CLI smoke/integration results

The ten `solarch-cli` integration tests execute the compiled CLI as child
processes with synthetic files and a real binary stdin/stdout duplex exchange.
They demonstrate:

```text
create -> ACK -> signing request -> sign -> finalized .slr       PASS
inspect finalized archive                                       PASS
verify finalized archive                                        PASS
verify pending build with correct source/metadata/ACK            PASS
verify tampered finalized archive                                FAIL CLOSED
verify pending build with wrong ACK                              FAIL CLOSED
short/wrong/extra ACK                                            FAIL CLOSED
short/bad/wrong-digest/extra signature                           FAIL CLOSED
existing/racing output                                           NOT REPLACED
inspect with heavily JSON-escaped valid title (>4096 bytes)      PASS
```

The actual `solarch --help` command was also run and displays the three exact
command forms without patch artifacts.

## 8. Commands actually run and exact results

Run from the Git repository root through RTK:

```text
cargo fmt --check
  PASS

cargo clippy --workspace --all-targets --all-features -- -D warnings
  PASS, no warnings

cargo test --workspace
  PASS: 60 passed, 0 failed, 0 ignored
  Breakdown: 50 solarch-core tests, 10 solarch-cli integration tests

node --test scripts/create-clean-archive.test.mjs
  PASS: 11 passed, 0 failed, 0 skipped

git diff --check
  PASS

cargo run -p solarch-cli -- --help
  PASS; actual help output inspected

git branch --show-current
  feat/archive-core-viewer

git status --short
git diff --stat
  PASS; Git metadata was available and the working tree was inspected
```

`cargo fmt --all` was also run before the final check.

## 9. Security review findings and fixes

- Closed JCS parsing rejects unknown/missing fields and non-canonical bytes.
- All section arithmetic is checked and exact physical/declaration lengths are
  enforced; truncated, oversized and trailing inputs fail closed.
- Mutations in the header, manifest, index, data, SIG1 prefix or signature are
  covered; wrong trust anchors, wrong ACK, source/metadata mismatch, malformed
  chunk lengths and signature forgery fail closed.
- Source and pending files are checked by open-handle/path identity, size and
  modification metadata before and after critical reads. Publication is
  no-replace and verifies the published hard link before unlinking `.pending`.
- Source directory entries are never collected without a limit. Incremental
  traversal enforces file, depth, topology-entry, single-file and cumulative
  plaintext limits before unbounded source-controlled allocation can occur.
- OOXML validation does not search raw XML substrings. The parser is byte- and
  event-bounded, does not resolve external entities, rejects DTD/entity events,
  and checks exact parsed main-part attributes. Comment/entity/macro spoofs fail.
- Path rejection matches the frozen contract exactly: U+0000–001F/U+007F and
  only its documented Windows device names; compatibility cases remain accepted.
- ACK and signature protocol reads require EOF; partial sensitive input buffers
  are zeroized on success and error. Derived keys and temporary plaintext byte
  buffers use `Zeroizing`/`Zeroize` where practical.
- Production paths contain no `unwrap()`/`expect()` on untrusted input and both
  crates deny unsafe code.
- Errors and CLI failures do not print ACK, Content Key, protected plaintext or
  signature input bytes.
- The clean archive rejects symlinks and unsafe entries and excludes Git data,
  build products, artifacts, env/credential/secret files and prior archives.

The final review found and fixed one presentation defect in CLI help (literal
patch `+` markers) and one cleanup edge case after successful no-replace linking.
Both are covered by checks; the help regression has an explicit test.

## 10. Resolution of the original blockers

The first Part 01 cycle was correctly reported `PARTIAL` because shared contracts
were then undefined. `INTEGRATION_GATE_01` subsequently froze them:

| Original blocker | Current disposition |
| --- | --- |
| Archive fingerprint undefined | Resolved by Gate; full finalized-file SHA-256 lowercase hex implemented |
| Signature schema/message undefined | Resolved by Gate; exact SIG1/digest/domain/Ed25519 implemented |
| ACK handoff undefined | Resolved by Gate; exact 40-byte ACK and signing duplex protocol implemented |
| Device/license/wrapped-key contracts undefined | Resolved in shared docs for later Parts; intentionally not implemented in Part 01 |

This report preserves that historical fact while removing those items as active
Part 01 blockers.

## 11. Windows-native status and remaining limitations

- No Windows-native run was performed. Part 01 introduces portable Rust and
  standard-library filesystem code; all mandatory portable checks pass under
  Linux/WSL. Native Windows Viewer behavior belongs to Part 02 and is not claimed.
- Publication uses a same-filesystem hard link followed by unlink to obtain
  no-replace visibility with standard Rust APIs. Therefore input/output must be
  on a filesystem that supports hard links; the pending file is intentionally
  created beside the output.
- Concurrent malicious same-length mutation with restored metadata cannot be
  made impossible on every platform using portable metadata alone. The code
  verifies stable handles/identity and fails closed for observable replacement;
  the creator workspace is assumed to be access-controlled.
- Decrypted manifest/index/chunk byte buffers and derived keys are zeroized where
  practical. Parsed Rust `String` fields are caller-owned and cannot be promised
  to be scrubbed perfectly after allocator moves/copies.
- Protected-format validation is deliberately conservative structural probing,
  not a full PDF/image/Office renderer or malware scanner.
- DRM remains best-effort. No absolute content-protection claim is made.
- External review of the newly generated clean archive remains a user-operated
  delivery step; it is not represented as already passed.

These limitations do not leave a mandatory Part 01 acceptance item unimplemented.

## 12. Clean external review archive

The clean archive is generated only after this report is saved and then validated
by listing its actual tar contents. Its exact path and validation result are
recorded in the final delivery message to avoid a self-referential archive/report
filename cycle.

Required sources, tests, current docs, `TODO/PART_01.md`,
`TODO/INTEGRATION_GATE_01.md`, this updated report and the deterministic fixture
must be present. `.git`, `.codex`, `target`, `node_modules`, `artifacts`, secrets,
credential/env files, symlinks and previous archives must be absent.

## 13. Historical external review cycle

The 2026-09-07 review of the foundation found four issues: credential-file
archive exclusions, unsafe MVP policy flags, CLI fixture directory collisions,
and unbounded `inspect`. Those fixes remain present and tested. The Integration
Gate continuation supersedes the former production-contract blockers and brings
the implementation status from `PARTIAL` to `COMPLETE`.

## 14. External review fixes — 2026-09-08

All seven findings were fixed in the same Part and all mandatory checks passed:

| Finding | Resolution | Regression evidence |
| --- | --- | --- |
| Unbounded per-directory `read_dir().collect()` | Stream `ReadDir`; cap every file/directory entry with `MAX_SOURCE_FILES × MAX_PATH_DEPTH`; accumulate total bytes during traversal; retain final normalized UTF-8 sort | Low-budget hostile empty topology fails `LimitExceeded`; recursive ordering test remains deterministic |
| Empty protected files accepted | Initially changed to rejection, then superseded by the 2026-09-09 review because the frozen manifest explicitly permits size 0 | Section 15 records the corrected explicit empty-file behavior |
| Raw substring OOXML content-type validation | `quick-xml` streaming parser, 1 MiB/event/depth bounds, DTD/general-entity rejection, exact `/word/document.xml` or `/xl/workbook.xml` plus approved ContentType | Valid DOCX/XLSX flow passes; comments, DTD/entity references and macro-enabled main type fail |
| Path implementation broader than frozen contract | Replaced Unicode-wide `is_control()` with exact U+0000–001F/U+007F; removed undocumented `CONIN$`/`CONOUT$`; use ASCII-insensitive exact device stems | Exhaustive documented control test, reserved-name tests and compatibility acceptance for U+0085/CONIN$/CONOUT$/COM0/LPT10 |
| 4096-byte protocol cap broke valid inspect | Kept 4096 for frozen create/verify JSON, added separate `MAX_HEADER + 1024` inspect bound | Valid 1024-byte title expanding beyond 4096 through JSON escaping inspects successfully |
| Vulnerable direct `time 0.3.44` | Pinned patched `time 0.3.47`; lockfile updated | Full vector and workspace suites unchanged/passing |
| Duplicate manifest record validation | Removed the duplicate call | Clippy and full workspace tests pass |

Implementation-status annotations were updated only in `SLR_FORMAT.md`,
`INTEGRATION.md` and ADR-019/ADR-020 of `DECISIONS.md`. ADR-021 remains explicitly
implementation pending. No frozen contract text was redefined.

## 15. Remaining external review fixes — 2026-09-09

| Finding | Resolution | Regression evidence |
| --- | --- | --- |
| Reachable `RUSTSEC-2026-0194` in `quick-xml 0.38.4` | Pinned patched `quick-xml 0.42.0`; adapted its string-based event/attribute API; duplicate checks are explicitly enabled; DTD and general-reference rejection retained | Valid OOXML passes; duplicate unknown attributes, comments, DTD/entities and macro-enabled spoofing fail closed |
| Topology retained 320,000 full paths with quadratic insertion | Empty directories are validated and streamed but never retained; collision state contains only at most 10,000 protected paths; `PathSet` uses Unicode-casefold-ordered `BTreeSet` for O(log n) insert/lookup | 512 empty directories plus one file retain a one-file inventory; low entry budget fails closed; existing Unicode/prefix collision and deterministic ordering tests pass |
| Empty-file behavior contradicted frozen manifest | Restored explicit size-0 exception for all six protected extensions; nonempty files still require probing | Source table covers all extensions; builder test asserts empty SHA-256, `chunks=[]`, zero IDX records, pending verify and finalized content verify |
| Stale 64 MiB/reconcile wording | Updated only implementation-status text in `SLR_FORMAT.md`; documented the size-0 probing exception without changing schema/bytes | Frozen vector remains byte-identical |

No crypto/wire value, numeric `.slr` limit or ADR-021 implementation status was
changed. `RUSTSEC-2026-0194` is no longer reachable because the affected release
is absent from the resolved dependency graph.
