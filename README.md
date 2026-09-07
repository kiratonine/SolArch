# SolArch Archive Core foundation

Part 01 is **PARTIAL**: the reusable Rust foundation and clean review archive
tool are implemented. Production `.slr` create/verify remain blocked on shared
signature coverage/trust, fingerprint encoding, and CLI key-handoff decisions.
See [the Part 01 report](docs/archive-core-viewer/reports/PART_01_REPORT.md).

## Validation

```sh
cargo fmt --check
cargo clippy --workspace --all-targets --all-features -- -D warnings
cargo test --workspace
cargo run -p solarch-cli -- --help
node --test scripts/create-clean-archive.test.mjs
node scripts/create-clean-archive.mjs
```

The repository has no root Node package. The standalone script requires Node 20+
and `tar`; no JavaScript dependencies or package installation are needed. If
JavaScript tooling is added later, use pnpm exclusively.

The clean archive is written under `artifacts/` with a UTC timestamp and unique
suffix. It includes source, tests, docs, and local `TODO/` review instructions;
it excludes `.codex/`, `.git/`, secrets, build outputs, symlinks and artifacts.
This is a precise filename/path filter, not a scanner able to identify arbitrary
secrets hidden in ordinary source or documentation. Do not keep real secrets in
reviewable source files. Source mutation detection is best effort, not a
transactional snapshot of a concurrently hostile filesystem.

## Core boundaries

- `format`: documented, bounded v1 structural serialization and parsing. Its
  result is explicitly **unverified**, even when parsing succeeds.
- `paths` / `manifest`: logical path, MIME metadata, policy and chunk-reference
  validation; no filesystem extraction or content-format parser.
- `crypto` / `chunks`: real XChaCha20-Poly1305, fresh session-owned Content Key,
  non-resettable nonce counter, selected chunk decryption and zeroizing buffers.
- `builder`: prepared manifest and borrowed chunks to an encrypted in-memory
  archive. The caller retains the session/key. Maximum content is 64 MiB for
  this foundation API; a streaming file builder is still pending integration.
- `signature` / `fingerprint`: strict Ed25519 verification with an explicit
  caller trust anchor and a raw SHA-256 primitive, without claiming an external
  archive fingerprint contract.

`cargo run -p solarch-cli -- inspect <file>` returns bounded public/structural
metadata marked `UNVERIFIED`; it does not authenticate the container, reveal
the manifest, or authorize decryption. It seeks to determine the actual file
length and reads only the 96-byte prelude and public header (at most 64 KiB).
The shared structural limit remains 1 GiB; encrypted sections are not read.
`create` and `verify` fail with a contract-unavailable error and do not read keys.

Synthetic encrypted/signed fixtures are generated reproducibly only inside
`cfg(test)` in `builder_fixture_tests.rs`. They are not production platform
signatures or cross-branch wire fixtures. No Viewer, payment, licensing, or
Windows-specific implementation is included in Part 01.
