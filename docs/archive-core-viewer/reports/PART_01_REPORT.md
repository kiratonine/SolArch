# SolArch Archive Core & Viewer — Part 01 Report

**Part:** `PART_01`
**Status:** `PARTIAL`
**Updated:** `2026-09-07`
**Intended branch:** `feat/archive-core-viewer`; not verifiable because the supplied directory has no `.git`.

## 1. Scope

Executed only `TODO/PART_01.md`: Rust foundation, structural container model,
paths/manifest, authenticated encryption/chunks, signature/hash primitives,
in-memory builder, CLI foundation, synthetic fixtures and clean archive script.
No Part 02, Viewer, payment, backend, license or device implementation was started.

Part is not COMPLETE: production create/verify, external fingerprint and key
handoff require shared contract decisions listed in section 14. Independent
work was completed without choosing those contracts silently.

## 2. Implemented

- Rust workspace with `solarch-core`, `solarch-cli`, dependency lockfile and typed,
  input-redacted errors. No `unsafe` code is permitted in either crate.
- Versioned structural parser/serializer with contiguous section validation,
  checked offsets/lengths, size caps, strict JSON header shape and explicit
  `UnverifiedContainer`. Parsing is not cryptographic verification.
- Seek-based metadata inspection shares structural validation with the slice
  parser, reads only the prelude/header, and enforces the existing 1 GiB limit.
  Public headers must disable export and enable watermarking for MVP.
- Host-independent NFC/separator path normalization; traversal, absolute/drive/
  UNC/ADS paths, Windows reserved names, unsafe characters, depth/length limits
  and case/Unicode duplicate checks. No extraction or filesystem canonicalization
  is used to define internal paths.
- Manifest models and archive/policy/MIME/chunk-reference/size validation.
- Real XChaCha20-Poly1305 with a fresh session-owned random Content Key,
  non-resettable counter nonces, authenticated context and zeroizing key/plaintext
  buffers. Failed calls cannot reset counters. The caller retains keys in memory.
- Deterministic chunk partitioning and selected chunk decryption; in-memory
  builder encrypts manifest, index and chunks and checks reconstructed sizes.
- Raw SHA-256 and strict Ed25519 verification with caller-provided trusted key.
  No raw digest is declared to be the production external archive fingerprint.
- Deterministic `cfg(test)` fixture generator performs encrypted/signed serialized
  round-trip, tampering and truncation checks. Fixture signing coverage, keys and
  ciphertext codec are test-only, not a production `.slr` crypto profile.
- CLI help and bounded structural-only `inspect` returning `UNVERIFIED` JSON,
  without protected manifest/index/chunk output. `create` and `verify` deliberately
  return a nonzero contract-unavailable error before key/source handling.
- Standalone clean archive script, precise exclusions, regular-file staging,
  symlink rejection, source replacement checks, UTC/UUID filenames, shell-free
  tar and failure cleanup, with tests. No root Node package was added.
- `.gitignore` excludes local TODO/Codex settings, artifacts/build outputs and
  secret file patterns. TODO is intentionally included in review archives.

## 3. Files changed

All implementation files below are new; original shared docs and AGENTS were not changed.

```text
.gitignore
Cargo.toml
Cargo.lock
README.md
crates/solarch-core/Cargo.toml
crates/solarch-core/src/lib.rs
crates/solarch-core/src/error.rs
crates/solarch-core/src/format.rs
crates/solarch-core/src/format_inspection_tests.rs
crates/solarch-core/src/paths.rs
crates/solarch-core/src/manifest.rs
crates/solarch-core/src/crypto.rs
crates/solarch-core/src/chunks.rs
crates/solarch-core/src/integrity.rs
crates/solarch-core/src/signature.rs
crates/solarch-core/src/fingerprint.rs
crates/solarch-core/src/builder.rs
crates/solarch-core/src/builder_fixture_tests.rs
crates/solarch-cli/Cargo.toml
crates/solarch-cli/src/main.rs
crates/solarch-cli/src/command.rs
crates/solarch-cli/tests/cli.rs
scripts/create-clean-archive.mjs
scripts/create-clean-archive.test.mjs
docs/archive-core-viewer/reports/PART_01_REPORT.md
```

Generated review archives live only in excluded `artifacts/`; synthetic CLI smoke
inputs live outside the repository under `/tmp/solarch-part01-smoke/`.

## 4. Orchestration

Main read Part 01, root rules, all mandatory current docs, existing directory and
local agent/template configuration before implementation and delegation.

Dependency graph: contract audit → central structural/crypto boundaries → Rust
foundation + paths/manifest → in-memory builder and test fixtures → integration
review → final validation → report and archive. Clean script ran independently.

| Agent | Role / ownership | Result and integration |
| --- | --- | --- |
| `contract_gate` | `contract_reviewer`, read-only shared-contract audit | Confirmed delegated structural widths and reserved crypto integration gaps; incorporated centrally. |
| `clean_archive` | temporary default helper; only the two `scripts/*.mjs` files | Script/tests delivered; Main reviewed and requested precise source-name exclusions and safer cleanup, then fixed timestamp cleanup. |
| `safe_paths` | `rust_core_implementer`; only `paths.rs` and `manifest.rs` | Implemented models and ten tests; Main reviewed integration and ran final workspace suite. |
| `integrated_review` | `test_security_reviewer`, read-only integrated review | No critical/high findings; Main fixed timestamp staging leak and implemented independent unverified inspect. Follow-up static review passed. |

No overlapping writable assignments. At most three helpers were active alongside
Main. No extra persistent profiles or sub-agent reports. Main owned Cargo files,
architecture, remaining Rust/CLI, integration, final tests and this report.

External review cycle 1 delegation: attempted project `test_security_reviewer`
(`credential_exclusions`), but the harness rejected its configured model before
execution (`gpt-5.6` unsupported for this account). No work is attributed to that
failed attempt. Temporary default helper `credential_fix_fallback` owned only
the two archive-script files and passed its focused 11-test Node run. Temporary
default helper `review_fixes` performed read-only integrated review and reported
PASS without running suites. Main reviewed both results, implemented all Rust
fixes and reran all required checks itself. No new persistent agent profiles.

## 5. Architecture / integration decisions

`SLR_FORMAT.md` §§3–4 explicitly delegate encoding/field widths to Core. Core
documents its structural layout in `format.rs`: `SOLARCH\0`, u16 LE major/minor,
reserved u32, five u64 LE offset/length pairs, 96-byte prelude, contiguous sections.
Limits: header 64 KiB; encrypted manifest/index 16 MiB each; signature section
64 KiB; total structural input 1 GiB. Sections after the header remain opaque.

External review cycle 1 adds no wire-layout change: `inspect_structure` uses the
same descriptor validator as `parse_structure`. It obtains length with seek,
reads the 96-byte prelude and at most 64 KiB of public header, and checks length
again after reading. No protected section bytes are loaded. The old CLI-only
64 MiB whole-file ceiling is removed; the existing 1 GiB structural cap remains.
MVP `allow_export=false` and `watermark_enabled=true` now apply through the common
header validator, including builder, serializer and both parser paths.

The approved primitive choice is XChaCha20-Poly1305, SHA-256 and Ed25519. The
in-memory nonce strategy uses a counter under a newly generated, session-owned
key; no key import, session clone, reset or caller nonce API exists. In-memory
builder content is capped at 64 MiB and 65,536 chunks. It does not yet produce a
file or the required external `archive_fingerprint`/`size_bytes` build output.

Selected libraries were checked against their own documentation:
[chacha20poly1305 0.10.1](https://docs.rs/chacha20poly1305/0.10.1/chacha20poly1305/),
[ed25519-dalek 2.2.0](https://docs.rs/ed25519-dalek/2.2.0/ed25519_dalek/),
[sha2 0.10.9](https://docs.rs/sha2/0.10.9/sha2/),
[zeroize](https://docs.rs/zeroize/latest/zeroize/), and
[unicode-normalization](https://docs.rs/unicode-normalization/latest/unicode_normalization/).
Stable compatible versions were selected and resolved in Cargo.lock; this is not
a claim that every resolved transitive dependency received an independent audit.

No shared API/format/DECISIONS document was changed. No backend key sidecar,
environment convention, stdout key, custody service, trust-key lookup or license
encoding was invented. The generic primitives and test codec do not supply those
missing agreements. All test signing secrets are explicitly synthetic, cfg(test).

Root Node tooling did not exist. As required, the archive command is direct
`node scripts/create-clean-archive.mjs`; no package.json or alternate lockfile was
created. No npm/yarn/bun installation or script command was used.

## 6. Docs / contracts checked

```text
docs/README.md
docs/SPEC.md
docs/ARCHITECTURE.md
docs/API.md
docs/SLR_FORMAT.md
docs/DATA_MODEL.md
docs/PAYMENTS.md
docs/SECURITY.md
docs/INTEGRATION.md
docs/TESTING.md
docs/DECISIONS.md
docs/roles/01_ARCHIVE_CORE_AND_VIEWER.md
```

Also read root AGENTS, current Part 01, `.codex/config.toml`, named agent profiles,
and `.codex/PART_REPORT_TEMPLATE.md`. Other Part instructions were not executed or
read for implementation. The archive script copies local TODO review inputs.

## 7. Tests added

33 Core unit tests cover structural round-trip, all prefix truncations, bad
magic/version/reserved fields, offset overflow/overlap/gaps, public metadata,
paths, MIME, policy, manifest references/limits, single/multiple chunks, wrong
key/AAD/tag/ciphertext, counter uniqueness/exhaustion, secret redaction,
SHA-256 known vector, valid/forged/modified/wrong-trust signatures and builder.

Test-only fixture scenarios include minimal-valid, multi-file-valid,
corrupted-header, corrupted-manifest, corrupted-index, corrupted-chunk,
invalid-signature, unsupported-version, all truncations, and freshly re-signed
corrupt ciphertext still failing AEAD. Fixtures are generated in memory, with
deterministic keys, without committing binary archives or plaintext files.

Five CLI tests cover help, blocked commands/non-secret errors,
structural inspect output/corruption, concurrent unique fixtures and a sparse
container with a 256 MiB content section. Eleven Node tests group all mandatory script
inclusion/exclusion cases, tar content inspection, unique UTC names, root
resolution, unsafe entries, symlinks, source mutation, tool failures, staging
cleanup, artifacts replacement and safe diagnostics.

Cycle 1 adds positive MVP policy validation and rejection of every disallowed
export/watermark combination through validation, serialization and both parsers;
seek/slice corruption and truncation parity; a guarded 1 GiB synthetic reader
that rejects any attempt to read beyond metadata; length-change and size-limit
rejection. The sparse CLI test also rejects truncation and checks `UNVERIFIED`.
The new tar regression covers root/nested/case variants of credential-bearing
files while preserving source and example templates. No real credentials used.

## 8. Commands executed

Environment: `rustc --version` → 1.94.0; `cargo --version` → 1.94.0;
`node --version` → v20.20.2; `pnpm --version` → 10.32.1; `tar --version` → GNU 1.35.

Final Main validation commands:

```sh
cargo fmt --check
cargo clippy --workspace --all-targets --all-features -- -D warnings
cargo test --workspace
node --test scripts/create-clean-archive.test.mjs
cargo run -p solarch-cli -- --help
cargo run -p solarch-cli -- create --input-directory /tmp/solarch-part01-smoke/source --metadata-file /tmp/solarch-part01-smoke/metadata.json --output-file /tmp/solarch-part01-smoke/output.slr
cargo run -p solarch-cli -- inspect /tmp/solarch-part01-smoke/structural-only.slr
cargo run -p solarch-cli -- verify /tmp/solarch-part01-smoke/structural-only.slr
git diff --check
```

Development commands: `cargo fmt --all`; `cargo test --workspace` during integration
(27, then 30 passing tests before the last CLI test); worker
`rustfmt --edition 2021 crates/solarch-core/src/paths.rs crates/solarch-core/src/manifest.rs`;
worker `cargo test -p solarch-core --lib` initially failed while Main's builder/
format modules were not yet present. Worker/reviewer Node runs passed 7, then 9
tests before Main's final ten-test run. These are not substituted for final checks.

CLI smoke input was generated by a temporary Python heredoc using `json`,
`struct.pack('<HHI', 1, 0, 0)` and five `struct.pack('<QQ', offset, len(section))`
pairs with synthetic public header and opaque sections. It was not a crypto-
verified fixture. Crypto round-trip is separately exercised in Rust unit tests.

Whitespace fallback executed `git diff --no-index --check /dev/null <file>` for
each of 23 new implementation/README/config files. All returned exit 1 with no
diagnostics (normal no-index difference status). The initial Python wrapper
incorrectly treated exit 1 as failure; the corrected wrapper accepts 0/1 only
with empty stdout/stderr and passed. This does not establish branch diff status.

## 9. Exact results

| Check | Actual result |
| --- | --- |
| cargo fmt --check | PASS, exit 0 |
| Clippy workspace/all targets/all features, warnings denied | PASS, exit 0 |
| cargo test --workspace | PASS after external review cycle 1, exit 0: 33 Core + 5 CLI = 38 tests, 0 failures |
| Node archive-script tests | PASS after external review cycle 1, exit 0: 11 tests, 0 failures |
| CLI --help | PASS, exit 0, limitations displayed |
| CLI inspect structural fixture | PASS, exit 0, UNVERIFIED public JSON only |
| CLI create smoke | BLOCKED, exit 1, explicit contract-unavailable; no output.slr created |
| CLI verify smoke | BLOCKED, exit 1, explicit contract-unavailable |
| git status --short | UNAVAILABLE, exit 128: not a Git repository |
| git diff --check | UNAVAILABLE, exit 129: not a Git repository |
| New-file no-index whitespace fallback | PASS, no whitespace diagnostics on 23 files; wrapper exit 0 |

No test assertion fails in the final suites. Nonzero production CLI statuses are
verified fail-closed behavior, not successful production create/verify acceptance.
Fmt and Clippy were rerun successfully in cycle 1. The standalone CLI smoke and
Git rows retain the original Part validation results; the cycle's CLI subprocess
tests ran inside the workspace suite. Exact cycle commands/results are in section 16.

Original pre-review clean archive validation run: PASS, `node scripts/create-clean-archive.mjs`,
exit 0, produced:

```text
artifacts/solarch-archive-core-viewer-clean-20260907T114639Z-4035ff20-0b53-43ee-8f94-623698f642ef.tar.gz
```

Executed:

```sh
tar -tzf artifacts/solarch-archive-core-viewer-clean-20260907T114639Z-4035ff20-0b53-43ee-8f94-623698f642ef.tar.gz
```

PASS, exit 0, 58 entries. Main additionally checked the tar members using Python
`tarfile`: required source/report/Part instruction present, only regular files
and directories, no absolute/traversal paths, symlinks, `.git`, `.codex`,
`node_modules`, `target`, `artifacts`, secret directories or forbidden env files.
That validation script exited 0. This run preceded this report result update.
The final review snapshot is generated again after saving this report, using the
same command; its unique filename is printed by the script and in the final
delivery message. Earlier snapshots are excluded from every new archive.

## 10. Windows-native checks

Not required for this Part: no Viewer/Tauri or Windows-conditional implementation
was introduced. Rust/CLI and script ran in WSL/Linux. Native Windows builds,
filesystem behavior and installer/file association were NOT VERIFIED.

## 11. Security checks

Main reviewed all helper changes and integration boundaries. Independent reviewer
found no critical/high issues in the inspected foundation. Low timestamp cleanup
issue was fixed with a regression test. Source-key filenames are preserved while
actual secret data patterns are excluded. Cycle 1 additionally excludes exact
credential-bearing local filenames and directories, including package/network
credentials, direnv state and Docker's credential config. Artifacts cleanup avoids following a
detected replaced directory. No shell interpolation is used for tar execution.

Key Debug is redacted; plaintext AEAD buffers zeroize on success/error/drop;
Content Key has no Serialize/Clone/byte-export API. Decrypted manifest objects
remain caller-owned sensitive metadata and are not claimed to be fully zeroized.
No production secrets or protected plaintext files were created in the repo.
Because there is no Git metadata, committed-content verification is unavailable.

## 12. Known limitations

- In-memory builder is not a streaming production file builder. Caller prepares
  chunk map and opaque file hashes; external file-hash encoding is not agreed.
- Structural parser can accept an opaque invalid signature: its result is
  explicitly unverified and cannot authorize opening. Test-only full validation
  is not a production container verifier.
- MIME checks validate extension/metadata, not actual PDF/image/Office payload
  syntax or disguised executable content. Publishing remains unavailable.
- No agreed complete ArchiveBuilder output with production fingerprint exists.
- Clean script filters paths/names, not arbitrary secrets hidden in allowed
  source/docs. A concurrently hostile filesystem is not transactionally snapshotted.
  If artifacts is maliciously relocated during output, a partial can remain in
  the relocated directory; cleanup avoids deleting through a substituted path.
- Inspect now reads only metadata with bounded memory, up to the unchanged
  1 GiB structural size cap. It does not authenticate or read protected sections.
  Before/after length checks detect growth/truncation during metadata reading,
  not same-length concurrent replacement; no transactional snapshot is claimed.

## 13. Not tested / not verified

Production signed `.slr` create/verify, cross-branch fingerprint equality,
backend key handoff/storage, real Backend ArchiveBuilder integration, native
Windows, actual protected format parsing/rendering, payment/license/device flows,
Git branch/commit state and external re-review after cycle 1 are not verified. No production
security or blockchain claim is inferred from the synthetic tests.

## 14. Contract conflicts / blockers

No contradictory fixed product rule was found. These essential decisions remain
missing and are explicitly reserved for agreement:

1. `docs/INTEGRATION.md` §6 reserves archive fingerprint encoding; `SLR_FORMAT`
   does not define digest coverage/canonicalization. Raw SHA-256 is only a primitive.
2. `SLR_FORMAT` §14 requires platform/server signing but does not define signed
   bytes/domain, signature block schema, trust-key identity/distribution/lookup.
   A key embedded by the archive itself must not be treated as platform trust.
3. **Content Key production custody/handoff is NOT fully defined.** `DATA_MODEL`
   has conceptual `content_key_ref`, while `INTEGRATION` §5 gives conceptual CLI
   paths without secret ingress/handoff. No safe production CLI convention was
   imposed. Caller-owned in-memory keys are explicitly permitted by Part 01.
4. Future device public-key encoding, signed license canonical payload/signature
   and wrapped-content-key envelope remain placeholders (`API` §9, `INTEGRATION`
   §6). They were not implemented in Part 01.

Precise structural widths are not a blocker: docs explicitly delegate them to
Core. Production crypto serialization and create/verify are the dependent pieces
held back. Agree their contracts, update docs/fixtures, then finish those pieces
within Part 01 before moving on.

## 15. Remaining issues

Resolve section 14 agreements; implement production builder/CLI serialization,
signature/fingerprint outputs and secure handoff; run successful production CLI
round-trip and compatibility fixtures. Supply a Git checkout for actual branch
diff checks. Obtain external re-review of the cycle 1 fixes; keep further findings
in this same report.

## 16. External review fixes

### Cycle 1 — four user-supplied external findings, 2026-09-07

Status: all four requested fixes implemented and verified. Part remains `PARTIAL`.
Production create/verify/fingerprint/signing/key-handoff remain contract-blocked;
shared crypto/API docs, algorithms and wire contracts were not changed.

| Finding | Fix | Regression evidence |
| --- | --- | --- |
| Credential-bearing local files leaked into clean archive | Exact case-insensitive basename rules for `.npmrc`, `.netrc`, `_netrc`, `.pypirc`, `.git-credentials`, `.gitcookies`, `.envrc`, `.authinfo`, `.authinfo.gpg`, `.vault-token`, `.s3cfg`, `.boto`; prune `.direnv/`; exclude precise `.docker/config.json` at any depth | Actual tar listing asserts absence at root/nested/case variants and preservation of source/templates such as `.npmrc.example`, `.docker/config.json.example`, `.docker/Dockerfile` and `credentials.ts` |
| Public header allowed unsafe MVP policy | Common validator rejects export enabled and watermark disabled | Valid protected policy accepted; all three invalid flag combinations rejected directly and through serialization, slice parsing and seek inspection |
| PID-only CLI fixture directory collision | Per-process atomic counter + PID, atomic `create_dir`, retry on pre-existing directories without reuse/deletion | Sixteen concurrent fixture allocations remain distinct; both file-based CLI tests allocate independent directories |
| inspect loads whole file and rejects over 64 MiB | Core `Read + Seek` inspection with shared descriptor validation; bounded prelude/header reads, actual stream length checks | Real sparse CLI file with 256 MiB content section succeeds, truncation fails; guarded 1 GiB reader proves no opaque-section reads; malformed inputs retain slice-parser error behavior |

Files changed in this review cycle:

```text
scripts/create-clean-archive.mjs
scripts/create-clean-archive.test.mjs
crates/solarch-core/src/format.rs
crates/solarch-core/src/format_inspection_tests.rs (new)
crates/solarch-cli/src/command.rs
crates/solarch-cli/tests/cli.rs
README.md
docs/archive-core-viewer/reports/PART_01_REPORT.md
```

Main executed:

```sh
cargo fmt --all
cargo fmt --check
cargo clippy --workspace --all-targets --all-features -- -D warnings
cargo test --workspace
node --test scripts/create-clean-archive.test.mjs
```

Results: all commands exit 0. `cargo fmt --check` PASS; Clippy PASS with warnings
denied; Rust suite 38 PASS / 0 FAIL / 0 ignored (33 Core, 5 CLI); Node suite
11 PASS / 0 FAIL / 0 skipped. Node tests include actual archive generation and
`tar -tzf` inspection. No dependency or lockfile change was required.

Independent static review (`review_fixes`) reported PASS with no actionable
regressions. Main checked the changed implementation and final runtime results;
helper results did not replace integrated validation. Windows-native checks
remain not required for this portable Part 01 change and were not run. The input
directory still lacks `.git`; the attempted `git status --short` returned exit
128, so branch diff/commit state remains unavailable.

Remaining: external re-review and the pre-existing production integration
contract freeze. No commit, push, merge, rebase or Part 02 work was performed.
