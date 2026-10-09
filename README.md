# SolArch

SolArch is a full-stack platform for creating, publishing, downloading, paying
for, and viewing protected `.slr` archives.

```text
Marketplace → Backend-built .slr → Windows Viewer → USDC payment
→ Entitlement → device-bound license → protected internal rendering
```

The frozen cross-component contracts live in [`docs/`](docs/); start with
[`docs/README.md`](docs/README.md). Historical files under `docs/context/` are
not authoritative.

## Monorepo

```text
apps/web        React + Vite Marketplace Frontend
apps/api        NestJS Marketplace Backend
apps/viewer     React + Tauri Windows Viewer
crates/         solarch-core and solarch-cli
```

Node.js 20.19+ or 22.12+ and pnpm 10.32.1 are required (matching Vite 8's
supported Node.js ranges). `pnpm-lock.yaml` is the only package-manager
lockfile.

```sh
pnpm install --frozen-lockfile

pnpm --filter @solarch/web typecheck
pnpm --filter @solarch/web lint
pnpm --filter @solarch/web test
pnpm --filter @solarch/web build

pnpm --filter @solarch/api lint
pnpm --filter @solarch/api test
pnpm --filter @solarch/api build

pnpm --filter @solarch/viewer lint
pnpm --filter @solarch/viewer test
pnpm --filter @solarch/viewer build

cargo test --workspace
```

Run Marketplace development against the real Backend with
`VITE_ENABLE_MSW=false` and an explicit `VITE_API_BASE_URL`. MSW is development
and unit-test support only; production builds never enable it.

See [`apps/web/README.md`](apps/web/README.md),
[`apps/api/README.md`](apps/api/README.md), and the Part reports under
[`docs/archive-core-viewer/reports/`](docs/archive-core-viewer/reports/) for
component-specific setup and validation evidence. Never commit `.env` files,
private keys, payment credentials, plaintext protected content, or generated
runtime storage.
