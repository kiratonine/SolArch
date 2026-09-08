# SolArch Archive Core

Part 01 implements the frozen production `.slr v1` Core and CLI contracts. See
[the Part 01 report](docs/archive-core-viewer/reports/PART_01_REPORT.md) for exact
validation evidence and remaining platform limitations.

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

- `format` / `canonical`: exact 96-byte prelude and closed RFC 8785 JCS Public
  Header parsing. Structural inspection is explicitly **UNVERIFIED**.
- `source` / `paths` / `manifest`: deterministic traversal, protected-content
  probing, Unicode/case collision rejection and exact manifest validation.
- `production_crypto`: frozen HKDF-SHA-256/XChaCha20-Poly1305, IDX1/DAT1, SIG1,
  Ed25519 signed-message and final SHA-256 fingerprint profiles.
- `archive`: streaming pending builder, trusted ACK-enabled pending verification,
  signature acceptance, no-replace publication and finalized signature verify.

`solarch create` uses the binary ACK/signature duplex protocol documented in
`docs/INTEGRATION.md`. `solarch verify --pending-build` performs full protected
verification with the authorized source, metadata and ACK. Finalized `verify`
authenticates the signed container and reports its full-file fingerprint without
claiming protected plaintext verification. `inspect` remains bounded and public
only. No Viewer, payment, Backend, licensing, or Windows-specific implementation
is included in Part 01.
