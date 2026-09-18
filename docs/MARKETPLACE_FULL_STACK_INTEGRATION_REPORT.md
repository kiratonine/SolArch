# Marketplace Full-Stack Integration Report

**Date:** 2026-09-18
**Status:** PARTIAL — external-review follow-up; environment-dependent Rust tests identified, outstanding checks not yet documented; merge uncommitted
**Integration branch:** `integrate/marketplace-full-stack`
**Base:** `origin/integrate/marketplace-backend` at `ae2b1ba84d0f3f9dd37d6b090ee515207b19ee0c`
**Merge source:** `origin/feat/marketplace-frontend` at `b851e42f3147f3ced21b8b6b97cb20218368f1e6`

## 1. Merge and conflict resolution

The working tree was clean before integration. Remote refs were fetched, the
new branch was created directly from the remote Backend/Viewer base, and the
frontend was merged with `--no-ff --no-commit`. `MERGE_HEAD` remains present;
no commit, push, rebase, or main-branch merge was performed.

There was one merge conflict: both branches contained a `package-lock.json`.
It was resolved by removing the npm lockfile and retaining `pnpm-lock.yaml` as
the only package-manager lock. `apps/web` was added to `pnpm-workspace.yaml`.
Root scripts now expose Web typecheck/lint/test/build and aggregate Web, API,
and Viewer checks.

The source branch did not modify shared contract documents after the common
merge base. Therefore the newer Backend/Viewer versions of `docs/API.md`,
`docs/SLR_FORMAT.md`, `docs/PAYMENTS.md`, `docs/DATA_MODEL.md`,
`docs/SECURITY.md`, `docs/INTEGRATION.md`, and `docs/DECISIONS.md` were retained
unchanged. No frozen API, payment, archive, license, or crypto contract was
redefined during this merge.

## 2. Integrated files and compatibility changes

The complete Marketplace Frontend from the source branch was added under
`apps/web/`, including its React/Vite application, typed API client, RU/EN
i18n, Wallet Standard creator authentication, upload/publish/analytics flows,
MSW development fixtures, and 295 tests. Source-branch supporting files
`.gitignore`, `BACKEND_ISSUES.md`, `CLAUDE.md`, `WORKLOG_FRONTEND.md`, and
`frontback.md` were preserved.

Files changed specifically at the integration boundary:

- `package.json` — pnpm full-stack scripts;
- `pnpm-workspace.yaml` — added `apps/web`;
- `pnpm-lock.yaml` — regenerated canonical three-app dependency graph;
- `package-lock.json` — removed;
- `README.md` — full-stack monorepo and validation instructions;
- `apps/web/README.md` — pnpm commands and real-Backend mode;
- `apps/web/package.json` — direct Wallet Standard imports and Node 20-compatible
  jsdom test runtime;
- `apps/web/src/main.tsx` — current real-Backend wording;
- `apps/web/src/test/setup.ts` — jsdom-only `scrollTo` and Blob
  `arrayBuffer()` compatibility shims;
- `apps/web/vite.config.ts` — bounded four-worker test pool for stable WSL/NTFS
  execution;
- `package.json` — clarified the root Node.js engine requirement to `^20.19.0 || >=22.12.0`;
- `README.md` and `apps/web/README.md` — aligned Node.js requirements;
- `apps/web/vite.config.ts` — added a development-only route for the MSW worker;
- `apps/web/src/mocks/mockServiceWorker.js` — moved the worker out of Vite's    production `public/` directory;
- `apps/web/public/mockServiceWorker.js` — removed;
- `scripts/web-production-output.test.mjs` — added an isolated production-build regression checking for absence of the MSW worker and dev-wallet markers.
- `docs/MARKETPLACE_FULL_STACK_INTEGRATION_REPORT.md` — this report.

Two package-manager defects were found and fixed without product behavior
changes:

1. `@wallet-standard/base` and `@wallet-standard/features` were directly
   imported but only happened to be npm-hoisted. They are now declared direct
   dependencies, as strict pnpm requires.
2. jsdom 30 resolves `undici` 8, whose current release requires Node >=22.19,
   conflicting with the repository's Node 20 requirement. Web tests now use
   the same compatible `jsdom 26.1.0` runtime as Viewer. Production Web code is
   unaffected.

## 3. Shared API comparison

The Web runtime Zod schemas and client routes were compared with the current
Nest controllers/services for catalog, archive detail/files/download, creator
auth, creator archives, uploads, publish/unpublish, and analytics. The current
field names and route shapes match. Extra compatibility aliases returned by
Backend are ignored by Zod and do not weaken required-field validation.

No shared-contract conflict was found. Historical notes in
`BACKEND_ISSUES.md`, `frontback.md`, and older portions of
`WORKLOG_FRONTEND.md` describe pre-fix states and are not contract authority;
the frozen `docs/*` files remain authoritative.

## 4. Real non-mock integration evidence

The production Web bundle was built with:

```text
VITE_ENABLE_MSW=false
VITE_API_BASE_URL=http://127.0.0.1:3000
```

The built assets contain no `mockServiceWorker`, MSW browser, or demo-wallet
markers. Headless Chrome loaded that production bundle against the real local
Backend and rendered the real database catalog and archive page, including
`SolArch Devnet Multi Format`, `SolArch Payment Page Test`, `1.00 USDC`, and
the `.slr` download action.

The real public Marketplace download for
`solarch-devnet-multi-format-yi22` produced 6815 bytes with SHA-256:

```text
885f7dc489d6f5042ba9cd287a5ff13109585a485d0067fd9365d249aa89b3e6
```

Those bytes were byte-identical to the canonical live Viewer archive. Live
preflight authenticated the container with the real archive-role public trust
anchor, checked the real HTTPS Backend metadata, current Devnet genesis, and
official Circle Devnet USDC mint with six decimals.

The existing non-fixture Part 05 public evidence was then revalidated against
the downloaded Marketplace bytes and current on-chain state. It passed with:

- finalized real Devnet payment;
- exact `950000 / 50000` creator/platform micro-USDC split;
- SolArch fee payer and creator ATA creation;
- distinct Payment, Entitlement, and Device License;
- real signed Device A license/HPKE checkpoints;
- independent Device B HTTP 409 `DEVICE_BINDING_MISMATCH`, with no license,
  ACK, or protected access.

The earlier canonical-archive evidence revalidation did not create a new
PaymentIntent, USDC payment, Entitlement, or Device License. During the later
follow-up on a separate test archive, the agent reported creating one new
**unpaid** PaymentIntent to display a real Viewer QR. No new USDC transaction,
payment, Entitlement, or Device License was reported for that follow-up.
According to the agent's execution log, private keys, RPC credentials, intent
credentials, refresh tokens, ACK, and decrypted protected content were not
logged or added to the repository; this was not independently audited here.

The original integration checkpoint established that the Marketplace-downloaded
canonical archive was byte-identical to the archive covered by existing Windows
Device A/B evidence. In the later follow-up, the agent reported opening a
**separate newly built archive** in the installed Windows Viewer and observing
`Locked -> Unlock -> real unpaid PaymentIntent -> QR (144x144)`. The user
subsequently reported that all requested manual checks passed; their per-step
screenshots, new archive ID, and fingerprint were not supplied with this report.
The follow-up does not constitute a second paid E2E.

## 5. Validation results

The following results are the earlier integration checkpoint recorded before
the 2026-09-18 follow-up. They do not establish the outcome of every subsequent
rerun. Latest results, including the environment-dependent Rust failures and
the isolated successful rerun, are recorded in §7.3.

| Check | Result |
|---|---|
| `pnpm install --frozen-lockfile` | PASS |
| Web typecheck | PASS |
| Web lint | PASS |
| Web tests | PASS — 31 files, 295 tests |
| Web production build (`VITE_ENABLE_MSW=false`) | PASS — 2384 modules |
| API lint | PASS |
| API tests | PASS — 12 suites, 115 tests |
| API build | PASS |
| Viewer lint | PASS |
| Viewer tests | PASS — 5 files, 54 tests |
| Viewer build | PASS — 1878 modules |
| `cargo test --workspace` | PASS — 129 tests |
| live Devnet preflight | PASS |
| live Devnet evidence validator | PASS |
| `git diff --check` | PASS |

The API test run retains the previously documented `bigint-buffer` pure-JS
fallback warning; it is not introduced by this merge and no tests failed.

## 6. Remaining review notes

- The integration merge was intentionally left uncommitted at the agent's last
  reported checkpoint. The current `MERGE_HEAD`, working-tree status, and staged
  follow-up changes must be checked locally before commit or push; the clean
  source archive does not contain `.git` metadata.
- `BACKEND_ISSUES.md`, `frontback.md`, and `WORKLOG_FRONTEND.md` are historical
  branch worklogs, not current shared contracts.
- The live HTTPS endpoint is a temporary tunnel and is not durable production
  hosting.
- No Marketplace `/download` page for distributing the Viewer installer was
  added; this was an explicit open frontend item and is outside merge conflict
  resolution.

## 7. External-review follow-up — 2026-09-18

### 7.1. Node.js compatibility and dev-only MSW

The merged workspace's root `package.json` now declares `engines.node` as
`^20.19.0 || >=22.12.0`. The root and Web README requirements were aligned.
`apps/web/package.json` does not separately declare `engines.node`. Vite,
Backend, Viewer, and frozen product contracts were not changed for this fix.

The MSW worker moved from `apps/web/public/mockServiceWorker.js` to
`apps/web/src/mocks/mockServiceWorker.js`. The development-only middleware in
`apps/web/vite.config.ts` serves `/mockServiceWorker.js` to the dev server;
`import.meta.env.DEV` still guards runtime mock initialization. The new
`scripts/web-production-output.test.mjs` builds to an isolated temporary output
and checks for the absence of the worker and dev-wallet markers.

Production-output regression: **NOT REPORTED in the supplied terminal output**;
execute `node --test scripts/web-production-output.test.mjs` and record its
actual result. Development MSW availability: **NOT REPORTED**; verify the
worker responds from the dev server separately. No PASS is inferred solely from
source inspection.

### 7.2. Real non-mock integration continuation

According to the agent's terminal log, a disposable Ed25519 test wallet signed
a real Backend challenge. The Backend created a separate test archive, accepted
its upload, built and authenticated its `.slr`, published it, and served the
archive bytes through a guest download. The canonical Part 05 archive was not
replaced.

The agent reported opening that new archive in the installed Windows Viewer and
observing `Locked -> Unlock -> real unpaid PaymentIntent -> QR (144x144)`.
One new **unpaid** PaymentIntent was created for this checkpoint. No new USDC
payment, blockchain transaction, Entitlement, or Device License was reported.
This is not a second paid E2E. The user reported that all requested manual
checks passed; independently recorded per-step browser evidence and the new
archive's public ID/fingerprint were not supplied with this report.

The earlier §4 statement about no new PaymentIntent pertains only to the
initial canonical-archive revalidation, before this follow-up. The earlier §4
statement about no new native Viewer launch has been superseded by the new
agent-reported Windows checkpoint.

### 7.3. Follow-up verification matrix

Section 5 records an earlier successful checkpoint. This matrix describes the
latest follow-up evidence available at the time of this update. `NOT REPORTED`
means the specific latest result was not supplied, not that the test failed.

| Check | Latest result / evidence |
|---|---|
| Web typecheck | PASS — agent terminal report |
| Web lint | PASS — agent terminal report |
| Web unit tests | PASS — 31 files / 295 tests, agent terminal report |
| Web production build | PASS — 2384 modules, agent terminal report |
| `node --test scripts/web-production-output.test.mjs` | NOT REPORTED — run before final acceptance |
| Development MSW worker served by dev server | NOT REPORTED — verify separately |
| API lint | PASS — agent terminal report |
| API unit tests (latest follow-up) | NOT REPORTED — the agent was still running them; §5 documents an earlier 115-test PASS |
| API build (latest follow-up) | NOT REPORTED — §5 documents an earlier PASS |
| Viewer lint/test/build (latest follow-up) | NOT REPORTED — §5 documents an earlier 54-test PASS |
| `rtk cargo test --workspace` with `SOLARCH_BACKEND_ORIGIN` set, before test isolation | FAIL — CLI 10 PASS, Core 61 PASS, Viewer 56 PASS / 2 FAIL; the two assertions expected `BackendUnavailable` |
| Isolated test: cached license reopen after process restart | PASS — 1 test, 57 filtered; three Backend-related environment variables unset for this command |
| Isolated test: expired cached grant denies when Backend unavailable | PASS — 1 test, 57 filtered; same environment isolation |
| `rtk cargo test --workspace` with three Backend-related variables unset | PASS — 129 tests / 7 suites / 4.00 s, user terminal output |
| `rtk cargo test --workspace` with original live Backend environment after hermetic test fix | NOT RUN / NOT REPORTED — test-source fix not yet confirmed |
| `node --test scripts/create-clean-archive.test.mjs` (latest follow-up) | NOT REPORTED — earlier 12-test PASS is in §5 / agent report |
| `node --test scripts/viewer-live-devnet-e2e.test.mjs` (latest follow-up) | NOT REPORTED — earlier 5-test PASS is in §5 / agent report |
| `rtk git diff --check` and `rtk git diff --cached --check` (latest follow-up) | NOT REPORTED |
| Requested manual checks | PASS — user-reported; detailed per-step evidence not attached |

**Rust failure analysis.** In the failing shell,
`SOLARCH_BACKEND_ORIGIN=SET`; `SOLARCH_DEV_BACKEND_ORIGIN` and
`SOLARCH_DEV_BACKEND_FIXTURE` were unset. The two affected Viewer tests construct
`AppState::new(...)` but assert that `refresh()` returns exactly
`Err(ViewerError::BackendUnavailable)`. `AppState::new()` obtains the Backend from
its configuration, which includes compile-time `SOLARCH_BACKEND_ORIGIN`.
Both targeted tests and the entire 129-test workspace passed after the three
Backend-related variables were removed **for those commands only**. This
controlled comparison confirms an environment-dependent test setup. The actual
error variant produced during the original failing run was not captured; no
license bypass or protected-content exposure is inferred from the assertion
failure. The production Backend, licensing policy, and fail-closed behavior
were not changed.

**Resolution status:** an isolated offline Rust regression run is PASS.
Making the two tests hermetic by explicitly constructing their test-only
`AppState` without a Backend, followed by a full workspace rerun with the
original environment still set, is recommended before unconditional acceptance.
Do not describe that source-code fix or live-environment rerun as completed
until they are actually performed.

### 7.4. Merge and handoff status

The existing `integrate/marketplace-full-stack` merge must not be restarted.
No commit, push, rebase, or merge into `main` was reported in this follow-up.
The source archive has no `.git` metadata; current `MERGE_HEAD`, working-tree
status, and staged changes have not been independently established from the
materials supplied with this update.

**Current status: PARTIAL pending the production-output regression, remaining
latest test evidence, hermetic Rust test verification with the live environment,
and Git index review.** Promote to `READY FOR EXTERNAL REVIEW` only after the
corresponding checks have actually passed and their outcomes have been recorded.
Commit or push requires separate approval.