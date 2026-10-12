# Local Quick Start and Environment Review

Date: 2026-10-11. Branch: `main`. HEAD: `d29697d3abcf1bbaa789d5b0a4ceef509a9476ac`.

Status: **PASS for local API/Web startup; PARTIAL for the additional full test runs**.
No live payment, production migration or native Windows installation was performed.

## Changes and root causes

Only three existing files were edited, plus this report:

| File | Task-only diff against the initial working tree |
| --- | --- |
| `README.md` | 25 additions / 6 deletions; only Quick Start |
| `apps/api/.env.example` | 78 additions / 26 deletions, ignoring EOL differences |
| `apps/web/.env.example` | 12 additions / 7 deletions |

- The old Backend example selected Devnet but left mandatory live keys/origin empty
  and used relative storage. `EnvService` treats Devnet as live even in development;
  `SOLANA_LIVE_DEVNET=false` is not a bypass. The new default explicitly uses
  non-live `localnet` with its local RPC address. This does not start a validator,
  deploy a USDC mint, enable mock payment transitions or provide payment authority.
- English comments cover all 27 application ENV variables: 25 active assignments
  and two documented, intentionally UNSET test-clock variables. CLI-inherited OS
  variables are also explained. Live secrets remain blank; generation, encodings,
  requiredness, key-role separation and matching Viewer anchors are documented.
- Web defaults to the real localhost API, not MSW. Its three public variables are
  explained; the installer points to the published GitHub prerelease.
- Quick Start now covers clone/install, non-overwriting ENV copies, Docker,
  Prisma generation and checked-in migrations on a NEW local DB, Linux/WSL CLI
  compilation and its absolute path, API build/start, Web and Windows PowerShell
  installer commands. It explicitly separates local development from real Devnet.

The sample DB credentials are the existing **public, throwaway Docker Compose
defaults**, not credentials from any working or deployed database. The local
profile uses existing development fallbacks and must not be exposed publicly or
used for purchases or sensitive content. Live configuration is not pre-provisioned.

The official Devnet mint and public RPC were checked against
[Circle's contract addresses](https://developers.circle.com/stablecoins/usdc-contract-addresses)
and [Solana's cluster documentation](https://solana.com/docs/references/clusters).
The Devnet RPC is documented as an alternative, not mixed into the localnet default.

## Actual verification

Environment: WSL/Linux, Node.js 20.20.2, pnpm 10.32.1, PostgreSQL 16 container.

| Command / check | Result |
| --- | --- |
| `rtk pnpm install --frozen-lockfile` | PASS; lockfile unchanged |
| Prisma `validate`, with an explicit disposable/local URL overriding `DATABASE_URL` | PASS |
| `prisma:generate`, with that same explicit override | PASS; Prisma Client 5.22.0 |
| `rtk pnpm --filter @solarch/api build` | PASS |
| `rtk cargo build --locked --release -p solarch-cli` | PASS; Linux `target/release/solarch` |
| `rtk pnpm --filter @solarch/api test --runInBand` | PASS: 15 suites, 138 tests |
| `rtk pnpm --filter @solarch/web build` | PASS, including TypeScript compilation |
| `rtk proxy node --test scripts/web-production-output.test.mjs` | PASS: 1 test, no production MSW worker/demo wallet |
| `rtk pnpm --filter @solarch/web test` | Initial run: 314 passed, 2 timed out, 35 files |
| Web retry of `archive-detail.test.tsx` and `create-archive.test.tsx`, `--maxWorkers=1` | PASS: both files, 33 tests; no assertions/timeouts changed |
| `rtk pnpm --filter @solarch/api test:e2e --runInBand` | FAIL: existing local live ENV caused storage startup rejection, 25 tests affected |
| Same API E2E suite in an isolated copy with template ENV, `NODE_ENV=test`, `SOLANA_LIVE_DEVNET=false` | 24 passed, 1 readiness timeout; teardown also timed out without a local RPC validator |
| Backend ENV coverage, empty secret fields and UNSET clock overrides | PASS |
| README outside Quick Start, compared byte-for-byte with initial contents | PASS |
| Scoped default `git diff --check` | Exit 2: CRLF recognized as trailing whitespace |
| Scoped `git -c core.whitespace=cr-at-eol diff --check` | PASS, exit 0 |

The Prisma commands load `.env` automatically, but `DATABASE_URL` was explicitly
overridden; validation/generation do not perform migrations. No private ENV value
was printed. The isolated runtime smoke did not load the working Backend `.env`.

An independent disposable container, `solarch-devex-20261011`, was created without
host data volumes. All four checked-in migrations were applied there with
`prisma migrate deploy`: 15 public tables including migration history, and zero
PaymentIntent/Payment/DeviceLicense rows. Existing PostgreSQL containers and
databases were not migrated, reset or stopped. Only the new test container was
stopped and removed after verification; its disposable test data is not retained.

Real `pnpm start:prod` ran the compiled `dist/src/main.js` in an isolated API copy:
health, Swagger and catalog returned HTTP 200; catalog was empty and localhost CORS
was correct. Database readiness was `ok`; RPC readiness was honestly `degraded`
without a validator. Real `pnpm web` served Vite HTML/modules with `MSW=false` and
the test API URL. These were HTTP/runtime checks, not browser wallet/payment E2E.
Two preliminary isolated `start:dev` attempts timed out during cold watch/startup;
the documented build + `start:prod` path was successfully verified instead.

The installer URL followed GitHub's public redirect to HTTP 200 with
`Content-Type: application/octet-stream`, length 5,396,940 bytes. PowerShell
commands and native installation were not executed in this documentation task.
The published Viewer targets the deployed Backend and its embedded public anchors,
not local development signing keys. No new installer or trust configuration was made.

## Preservation and limitations

A SHA-256 comparison of all 451 tracked files against the task-start snapshot
found changes only in the three allowed existing files. Prepared documentation
translations, code, Prisma, lockfiles, Tauri and unrelated dirty-tree files remain
unchanged. README remains LF; example files retain their predominant CRLF convention.
No real secret was added to the diff, no working `.env` was edited, and nothing
was staged, committed or pushed.

Additional E2E tests use their existing Prisma/payment/custody mocks; they are not
live Devnet evidence. Their remaining readiness/teardown timeout was not hidden or
fixed by modifying code, assertions, timeouts or production configuration. Real
Devnet still requires HTTPS, persistent storage, independently provisioned secrets,
role-separated signing keys, wallets/test funding and a matching Viewer build.
The fresh local catalog has no seeded archives. Awaiting review and commit authorization.
