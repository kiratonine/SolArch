# AGENTS.md — SolArch Archive Core & Desktop Viewer

## Scope

Branch: `feat/archive-core-viewer`.

This branch owns `.slr`, `solarch-core`, `solarch-cli` / ArchiveBuilder integration,
the Windows Tauri Viewer, device identity/secure storage, license validation,
wrapped Content Key handling, internal PDF/image/DOCX/XLSX viewing, watermark,
Windows `.slr` integration, and tests for this area.

Do not implement Marketplace Frontend or Marketplace Backend here.

## Source of truth

Shared contracts live in:

- `docs/README.md`
- `docs/SPEC.md`
- `docs/ARCHITECTURE.md`
- `docs/API.md`
- `docs/SLR_FORMAT.md`
- `docs/DATA_MODEL.md`
- `docs/PAYMENTS.md`
- `docs/SECURITY.md`
- `docs/INTEGRATION.md`
- `docs/TESTING.md`
- `docs/DECISIONS.md`
- `docs/roles/01_ARCHIVE_CORE_AND_VIEWER.md`

For Part work, only the assigned `TODO/PART_XX.md` defines execution scope.
Do not read or execute unrelated Part instructions without a concrete need.

Before changing shared API, `.slr` format, crypto/wire contracts, or cross-branch DTOs,
check the current docs. If implementation conflicts with a frozen/shared contract:
stop the dependent change, report the exact conflict, and do not silently redefine it.

Historical `docs/context/SolarArchive_*` files are not current authority.

## Critical MVP invariants

- Product: SolArch. Container: self-contained `.slr v1`. Target OS: Windows.
- Payment asset: USDC only. Price immutable. Platform 5%, creator 95%.
- SolArch pays network fees. `max_devices = 1`.
- `Payment != Entitlement != Device License != Content Key`.
- Device A is bound before payment; no buyer account/login flow.
- Backend derives `buyer_wallet` from authoritative Solana payment data.
- Production payment authorization requires Solana `finalized`; `confirmed` is not enough.
- Signed Device License supports the frozen 72-hour offline window.
- Protected formats: PDF, PNG, JPG/JPEG, WebP, DOCX, XLSX.
- Protected content stays inside Viewer; when export is disabled, no Save As/Open External/Extract.
- Viewer system UI supports Russian and English; protected content/creator metadata is not auto-translated.
- DRM is practical/best-effort; never claim absolute protection.

## Security

Treat archives, source files, Backend responses, and external input as untrusted.

- Fail closed on corruption, signature, integrity, license, or device mismatch.
- Never invent crypto primitives; use the exact frozen profile from current docs.
- Never log or persist plaintext ACK, Content Key, device private key, payment/refresh credentials, or decrypted protected files.
- Reject path traversal, absolute paths, duplicate normalized paths, malformed bounds, and unsupported content.
- Minimize plaintext/key lifetime and zeroize secret buffers where practical.
- No `unwrap()` / `expect()` on untrusted production paths.
- Mock behavior must never be presented as production verification.
- Viewer is not a trusted security boundary.

## Execution mode

Default is strict single-agent mode.

Do not create or use sub-agents/helpers, `wait_agent`, `list_agents`, or agent
coordination unless the user explicitly authorizes multi-agent work for the current task.
The existence of `.codex/agents/*` is not authorization.

Main Agent performs inspection, planning, implementation, tests, debugging, review,
and reporting itself. Do not spawn another model for git/search/file reads/tests/status.

Prefer one fresh Codex session per major Part/Gate. Read only files relevant to the
current task; use targeted search instead of repeatedly rereading the whole repo/docs.

## RTK shell policy

Use RTK for supported shell commands, for example:

```bash
rtk git status
rtk git diff
rtk grep "pattern" .
rtk find "*.rs" .
rtk cargo fmt --check
rtk cargo clippy --workspace --all-targets --all-features -- -D warnings
rtk cargo test --workspace
rtk pnpm test
rtk pnpm build
```

Do not wrap shell built-ins such as `cd` or variable assignment.
If condensed RTK output is insufficient, use `rtk proxy <command>` or RTK raw/tee
output first. Use a raw command only for a concrete technical reason and mention it briefly.

## Dependencies and implementation

- JavaScript/TypeScript package manager: pnpm only; canonical lockfile: `pnpm-lock.yaml`.
- Do not use npm/yarn/bun for project dependency management.
- Check for an existing dependency/helper before adding a new one.
- Be especially conservative with crypto, parsers, Tauri plugins, and secure storage.
- Follow existing architecture; avoid duplicate DTO/crypto/network logic and giant modules.
- TypeScript must remain strict. Rust errors should be typed/structured.
- Do not perform broad refactors or add features outside the current scope.

## Validation

Run checks proportional to the affected area. For Rust/core, normally:

```bash
rtk cargo fmt --check
rtk cargo clippy --workspace --all-targets --all-features -- -D warnings
rtk cargo test --workspace
```

For Viewer, inspect the actual `package.json` and run only existing pnpm scripts.
Windows-specific behavior requires native Windows validation when WSL/Linux is insufficient.
Security/crypto/format changes require relevant negative tests.

Never report `passed` for a command that was not actually run.

## Part workflow

For a Part:

`Inspect → Plan → Implement → Validate → Review → update PART_XX_REPORT.md → clean review archive → external review`

Use exactly one report:
`docs/archive-core-viewer/reports/PART_XX_REPORT.md`.

Do not create extra discovery/review markdown files unless they are genuinely required.
Do not mark a Part COMPLETE until mandatory implementation and checks pass.
After external findings, fix the same Part, rerun relevant checks, and update the same report.
Do not move to the next Part before external PASS.

## Git and secrets

Without explicit user instruction, do not commit, push, merge, rebase, force-push,
create releases, or deploy.

Never commit secrets, `.env`, private keys, decrypted content, `node_modules`,
`target/`, or build artifacts. Do not modify another teammate's area for cosmetic cleanup.

## Completion response

Be concise and factual. State:

- what changed and exact files;
- what was actually verified and results;
- material integration/security impact;
- real remaining issues.

If source-of-truth docs conflict with the requested implementation, report the conflict
before making a breaking contract change.
