# SolArch archive cover integration report

Status: **PARTIAL — implementation and real Backend/Core flow verified; interactive creator-wallet browser walkthrough remains manual**

Date: 2026-09-22  
Branch: `integrate/marketplace-full-stack`

## Git synchronization

- Local HEAD before fetch: `2afb5f13e0c0527ac2f90dec0b1daaaff3ccacd0`.
- `origin/integrate/marketplace-full-stack` after fetch: `6868f3a3d96a604be7c264b1ca909e25df86fca0`.
- The working tree was clean and the remote was seven commits ahead, so synchronization used `pull --ff-only`.
- Local HEAD after synchronization: `6868f3a3d96a604be7c264b1ca909e25df86fca0`.
- No merge conflict, reset, rebase, stash, or new branch was used. The incoming Marketplace grid/card work and Viewer styling/dev-preview work were preserved.

## Contract gap and additive API impact

Before this change, `cover_url` already existed in catalog/creator responses and `archive_listings.cover_storage_key` existed in the data model, but `docs/API.md` had no binary ingestion or public-byte endpoint. The former metadata PATCH also made it possible for a client to propose a cover URL, which did not establish trusted storage or byte validation.

`docs/API.md` now defines two additive endpoints:

- authenticated owner-only `POST /v1/archives/:archiveId/cover`, multipart field `file`;
- public `GET /v1/marketplace/covers/:coverKey` for Backend-generated opaque current keys.

The MVP profile is PNG/JPEG/WebP, at most 5 MiB, single-frame, dimensions `1..4096` per side and at most 16,777,216 decoded pixels. Backend decodes and re-encodes the whole image, checks real format against the claimed MIME type, strips source metadata/trailing bytes, and rejects SVG/HTML/arbitrary or malformed input. Client-provided `cover_url` and storage keys are no longer accepted through archive metadata PATCH. Existing response field `cover_url` is unchanged and is now always derived by Backend for new uploads.

No `.slr`, price, payment, license, crypto, Viewer trust-anchor, or database schema contract changed. No migration was required because the frozen data model already had `cover_storage_key`.

## Implementation

Backend:

- Added bounded in-memory multipart admission and `sharp@0.34.4` decode/re-encode validation.
- Uses opaque UUID storage names under the existing storage root's dedicated `covers/` directory; no user path component reaches the filesystem.
- Verifies creator ownership without disclosing whether another creator's archive exists.
- Writes the sanitized replacement first, atomically renames it, conditionally switches the DB reference, and only then best-effort removes the old referenced object. A failed write/DB switch leaves the prior cover active.
- Public reads require both a syntactically valid generated key and a current DB reference, are byte-bounded, and return validated media types with `nosniff`, sandbox CSP, and immutable caching.
- Creator and Marketplace DTO mapping now generates safe absolute public URLs rather than exposing a storage key.

Web:

- Added the cover upload API through the existing authenticated/contract-validated network layer.
- Added author preview, choose/replace, explicit upload, loading, error, and success states in EN/RU.
- Client-side type/5 MiB checks provide early feedback; Backend remains authoritative for magic bytes, decoding, dimensions, and ownership.
- Successful replacement updates the creator detail cache and invalidates creator/catalog queries.
- Catalog tiles and public archive detail now recover from broken image URLs with the existing neutral cover placeholder.
- Production Web output still excludes MSW; production Viewer output contains no mock IPC/dev-fixture markers. Viewer payment/license/crypto code was not changed.

## Exact changed files

- `apps/api/package.json`
- `apps/api/src/common/filters/http-exception.filter.ts`
- `apps/api/src/modules/archives/archive-covers.service.ts`
- `apps/api/src/modules/archives/archive-covers.service.spec.ts`
- `apps/api/src/modules/archives/archives.controller.ts`
- `apps/api/src/modules/archives/archives.dto.ts`
- `apps/api/src/modules/archives/archives.module.ts`
- `apps/api/src/modules/archives/archives.service.ts`
- `apps/api/src/modules/archives/archives.spec.ts`
- `apps/api/src/modules/marketplace/marketplace.controller.ts`
- `apps/api/src/modules/marketplace/marketplace.module.ts`
- `apps/api/src/modules/marketplace/marketplace.service.ts`
- `apps/api/src/modules/marketplace/marketplace.spec.ts`
- `apps/api/test/app.e2e-spec.ts`
- `apps/web/src/components/archive/archive-cover.tsx`
- `apps/web/src/components/archive/cover-upload.tsx`
- `apps/web/src/components/archive/tile.tsx`
- `apps/web/src/lib/api/api.test.ts`
- `apps/web/src/lib/api/archives.ts`
- `apps/web/src/lib/api/http.ts`
- `apps/web/src/lib/api/types.ts`
- `apps/web/src/lib/i18n/dict.en.ts`
- `apps/web/src/lib/i18n/dict.ru.ts`
- `apps/web/src/mocks/handlers/archives.ts`
- `apps/web/src/routes/dashboard.$archiveId.tsx`
- `apps/web/src/test/archive-detail.test.tsx`
- `apps/web/src/test/archive-page.test.tsx`
- `docs/API.md`
- `pnpm-lock.yaml`
- `docs/ARCHIVE_COVER_INTEGRATION_REPORT.md`

## Automated verification

- `pnpm install --frozen-lockfile`: PASS.
- Web typecheck: PASS.
- Web lint: PASS, no warnings.
- Web tests: PASS, 31 files / 299 tests.
- Web production build with `VITE_ENABLE_MSW=false`: PASS.
- `node --test scripts/web-production-output.test.mjs`: PASS, and `dist` contains neither `mockServiceWorker.js` nor the dev wallet marker.
- API lint: PASS.
- API unit tests: PASS, 13 suites / 121 tests.
- API build: PASS.
- Cover API E2E checks: PASS for unauthenticated rejection and pre-decode 5 MiB multipart rejection.
- Viewer lint: PASS.
- Viewer tests: PASS, 5 files / 54 tests.
- Viewer production build: PASS; post-build scan found no `mockIPC`, `mockWindows`, `DevPanel`, preview device key, or development-fixture marker.
- `cargo test --workspace`: PASS, 129 tests across 7 suites.
- `git diff --check`: PASS; no competing npm lockfile is present.

The complete API E2E file ran 22/25 tests. Both new cover tests passed. Three pre-existing payment/license cases returned 401 because this local E2E process loaded the live `.env` intent HMAC secret while the historical mock records are hashed with the development fallback pepper. This task did not change credential or payment behavior, and the passing API unit suite covers those production paths. The mismatch remains a test-isolation issue and is not reported as a cover/API success.

## Real HTTPS Backend → Core → Marketplace evidence

A new disposable creator identity and archive were used against the existing real PostgreSQL database and a real HTTPS Backend origin. No mock handler or canonical Part 05 archive was used.

Observed flow:

1. Wallet challenge was signed by the generated creator key and exchanged for a real Backend session.
2. Archive `1496a603-5b9f-42d7-b96c-5fedbb44b0e6` was created with the frozen MVP policy and exact-split `1.00 USDC` price.
3. A real ZIP was initialized, uploaded, completed, and built by the configured `solarch` CLI.
4. A PNG cover was uploaded through the new multipart endpoint and the archive was published as `cover-e2e-muchnm34-lchz`.
5. Public catalog detail returned the same Backend-generated cover URL; its binary endpoint returned HTTP 200 and `image/png`.
6. Guest `.slr` download returned HTTP 200.
7. SHA-256 of the owner download before the cover change and guest download after publish was byte-identical: `d8fa5eeec5605eba9cdf81d410b1ca4bf92fc56a80845b382e076019ccc5b4ea`.
8. `solarch verify` returned `AUTHENTICATED_CONTAINER`, size 3114 bytes, with the same fingerprint.
9. The production Web build, served locally with `VITE_ENABLE_MSW=false`, rendered the real catalog card with its Backend cover URL; the public detail rendered the same title/cover and guest `Download .slr` action in headless Chrome.

This proves that cover replacement is external to `.slr` and does not change Viewer archive identity or unlock inputs.

## Honest limitations

- The creator sequence was exercised through the real HTTPS API with a real cryptographic wallet challenge, but not by manually clicking an installed browser wallet extension in an interactive GUI. Public catalog/detail rendering was verified in the production Web build. Therefore the overall report remains PARTIAL rather than claiming the requested fully manual browser walkthrough.
- The HTTPS origin used for evidence is an ephemeral Cloudflare Quick Tunnel. It is suitable for this disposable integration check, not a deployment SLA.
- Windows Viewer was not manually opened on this new disposable archive. Viewer frontend and Rust regressions passed, production output has no mock IPC, and the authenticated `.slr` fingerprint remained unchanged.
- The local ignored `apps/api/.env` was updated to the ephemeral HTTPS origin for this test; no secret or usable private key is included in this report or Git diff.

No commit, push, rebase, force operation, or merge into `main` was performed.
