# SolArch Archive Core and Windows Viewer

Part 01 implements the frozen production `.slr v1` Core and CLI contracts. Part
02 adds the Windows Tauri Viewer shell, trusted archive open-to-Locked flow,
Device A identity, Windows secure storage, and local Device License validation.
See the Part reports under `docs/archive-core-viewer/reports/` for exact evidence
and platform limitations.

## Validation

```sh
cargo fmt --check
cargo clippy --workspace --all-targets --all-features -- -D warnings
cargo test --workspace
cargo run -p solarch-cli -- --help
pnpm install --frozen-lockfile
pnpm lint
pnpm test
pnpm build
node --test scripts/create-clean-archive.test.mjs
node scripts/create-clean-archive.mjs
```

The Viewer workspace requires Node 20+ and pnpm. On native Windows, use
`pnpm --filter @solarch/viewer tauri:dev:windows` for the development-fixture
shell and `pnpm --filter @solarch/viewer tauri:build:windows` for a production
build. Production trust stores are intentionally empty in Part 02 and fail
closed until final integration provisions trusted keys.

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
only. The Viewer reuses this Rust verification path; it does not parse archives
in TypeScript. Payment, Backend, protected renderers, watermarking, and Windows
file association remain outside Part 02.
