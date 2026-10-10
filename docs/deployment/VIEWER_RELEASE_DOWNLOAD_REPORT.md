# SolArch Windows Viewer Release / Download Report

Обновлено: 2026-10-10. **Release/download publication gate PASS** — reboot, native NSIS, installer languages/association, existing-license HTTPS refresh, owner manual Fresh Locked, GitHub prerelease/tag/public binary and production Vercel /download verified. **Overall PARTIAL**: full creator/new-purchase/independent Device B E2E remains unverified; two missing historical covers remain a separate catalog limitation. Current public build uses the verified installer URL, not the earlier broken link.

## Scope / source

Read completely: TODO/SOLARCH_VIEWER_RELEASE_AND_DOWNLOAD_PART.md, AGENTS.md/RTK policy, VPS_DEPLOY_REPORT.md, INTEGRATION.md, SECURITY.md, TESTING.md. Strict single-agent; main HEAD `0930e1b85e373e17dd8bc850f81b8a6beb788cca`. Existing dirty tree preserved; initial runtime diffs were CRLF, substantive report changes already existed. No commit/push/fetch/merge/rebase/reset/stash. No Backend/Core/Viewer runtime source, .env, API, SLR, payment, license, crypto or TTL changes. No purchase or PaymentIntent created.

Used frontend-design-guidelines and vercel-react-best-practices for existing theme/component reuse, responsive layout, real semantic links/buttons, lazy route and explicit unavailable state. Unrelated telemetry/brand setup not performed. Existing Marketplace stack retained; no new dependency or lockfile change.

## Gate A — VPS reboot PASS

Owner authorized one controlled reboot. Preflight: 0 active intent windows, 0 processing archives, 0 other active DB transactions; no builder/restore/backup/certbot operation; persistent mounts/service enabled and private backups retained. Strict-known-host SSH passed; provider recovery console not independently inspected.

One reboot, changed boot ID, SSH recovered. systemd failed units empty; Backend/Nginx active; both per-file mounts restored with ro,nosuid,nodev,noexec. HTTPS health/ready 200, database/solana_rpc ok; cover 200; Vercel Authorization CORS 204 exact origin; UFW active; external 3000/5432 unreachable. Both real guest downloads matched size/SHA/DB fingerprint. Current-boot Backend error journal empty. See VPS_DEPLOY_REPORT.md for identities/hashes. Immutable DB paths, triggers and missing historical archive statuses untouched.

## Gate B — native Windows artifact PASS; fresh Locked manual smoke PASS

Windows 10 Pro 10.0.19045 x64, native Cargo 1.98.1. Frontend production build performed in WSL because Windows Node 20.17 is below Vite 8 requirements. Native Tauri CLI pinned 2.11.4 invoked via pnpm dlx; temporary beforeBuildCommand-empty config reused existing prebuilt procedure, outside Git, removed afterward. No permanent workaround added.

Native command: `pnpm.cmd dlx @tauri-apps/cli@2.11.4 build --features desktop-runtime,custom-protocol,live-devnet --config <temporary prebuilt config>`, with SOLARCH_LIVE_FRONTEND_PREBUILT=1 and public compile-time values only. Existing custom-protocol feature is required for packaged local frontend; initial build without it was superseded before installation. Cargo binary fingerprint confirms custom-protocol/desktop-runtime/live-devnet; no development-fixtures or live-e2e-clock.

Origin: `https://solarch-api.duckdns.org`. Public trust anchors independently read from running VPS config, archive role `archive-devnet-20260914`, license role `license-devnet-20260914`; distinct public bytes matched. Private config not copied into build. PE scan confirmed new origin and both public anchors; ngrok, arc-test-01/lic-test-01 and both synthetic public anchor strings absent. Additional bounded raw scan of six available local critical secret values matched zero in PE; this is not a formal absence proof. Production frontend excludes the DEV-only mock IPC entry path.

Final candidate:

- Path: `D:\install\projects\solarch\target\release\bundle\nsis\SolArch Viewer_0.1.0_x64-setup.exe`
- WSL path: `/mnt/d/install/projects/solarch/target/release/bundle/nsis/SolArch Viewer_0.1.0_x64-setup.exe`
- Version 0.1.0; bytes **5396940**.
- Timestamp UTC **2026-10-09T16:06:13.3988215Z**.
- SHA-256 **b4040740b9a70a7d3ab56d7a553636868b03a1c77954053fc402afcdeedb6d48**.
- Authenticode **NotSigned**; SmartScreen warning possible. No code-signing/absolute DRM claims.

Native UIAutomation/WebView2 smoke reused existing installer helper functions, not its fixture/uninstall/credential-delete flow. First selector exposed exact Русский/English; install RU→first RU and EN→first EN PASS; switch/restart persisted both directions; .slr association checked installed exe + quoted %1. Actual shell-associated open of both existing real .slr succeeded with verified Unlocked/file tables. Safe VPS access log recorded actual HTTP 200 refresh for both existing Device A licenses; successful production Reader open demonstrates current real signed-grant validation/HPKE unwrap, not a mocked grant. No new USDC payment. Existing device credentials/licenses were preserved, not deleted/reset; ordinary refresh legitimately renewed licenses.

Fresh Locked smoke is **NOT PASS**: both available archives are already licensed for this Windows account, so correct behavior is Unlocked. Separate WebView profiles do not isolate Windows credentials/native license repository. Must use a clean independent Windows profile/VM, not delete existing licenses or fabricate archives. Automated expectations of Locked timed out for this reason. First private CDP helper also leaked VoidTaskResult into JSON output; corrected private diagnostic helpers suppress that output (no project runtime edit). Invoking retry_metadata after Unlocked returned INVALID_LICENSE at its locked_identity precondition before any network request; not a live Backend metadata regression and not bypassed. No renderer fidelity/multi-format/payment Device B E2E claimed in this stage.

Private build/smoke helpers and encrypted archive copies retained outside Git at `D:\install\solarch-viewer-release-20261009`. Test-only WebView debugging environment used for controlled DOM assertions, not shipped config; no credentials/grants captured.

### Follow-up 2026-10-10 — clean-account preflight BLOCKED

Owner accepted the previous reboot, installer and local /download checks. Read-only Windows preflight confirms the current user's profile is loaded, the process is **not elevated**, and Windows Sandbox is unavailable. The other enabled accounts are CodexSandboxOnline/CodexSandboxOffline; these environment-owned accounts are not authorized clean test profiles and were not used or modified. No new account was created, no credentials were requested/extracted, and no Device A storage was read, deleted or reset.

Source inspection confirms production uses Windows Credential Manager via keyring plus Tauri's per-user app_data_dir for local repositories. A genuinely separate Windows user with its own interactive login and untouched per-user storage is suitable for this scoped fresh-Locked smoke; a different WebView directory alone is not. There is currently no accessible, owner-provided clean Windows login/session. Creating and logging into one requires an owner-controlled Windows action; automation must not bypass UAC or borrow sandbox credentials. **Fresh Locked remains NOT RUN**, not PASS. Provide a clean Windows VM, or create a separate standard local test account and log into its desktop before continuing. Preserve the original account and all existing keys/licenses.

Work stops at this checkpoint: no new install/open/payment, Git staging, release publication or Vercel change. The existing artifact/checksum remains the candidate above. Commit whitelist finalization is deferred until fresh Locked PASS; the scoped file inventory below is not authorization to stage the entire dirty tree. Vercel Production variables/direct asset availability and public /download are not newly verified in this follow-up. GitHub publication still requires separate explicit owner approval.

Remaining real E2E gates, **not claimed PASS**: creator wallet login → cover/archive upload → complete/publish → guest download; any new live finalized payment and its purchase/entitlement transition; independent Device B Backend denial without license/ACK/protected access. No new purchase is authorized by this release-preparation task.

### Follow-up — owner-reported Fresh Locked PASS

Owner subsequently completed manual smoke under the separate standard local Windows account **SolArchTest**: NSIS installation, launching Viewer via real .slr association, connection to `https://solarch-api.duckdns.org`, and correct **Locked** state. Protected content remained inaccessible without a license. Owner confirms original Device A keys/licenses were unchanged and no USDC purchase was performed. This resolves the clean-profile availability blocker above. This is **user-performed manual evidence**, not an agent-observed/automated E2E; fresh-profile RU/EN switching was not separately asserted in this message (previous native installer RU/EN checks remain PASS). It does not prove Device B authenticated activation denial or a new payment flow.

## Gate C — owner publication and independent verification PASS

Read-only GitHub API inspection of kiratonine/SolArch releases/tags returned HTTP 200, both empty. No release/tag/asset written. v0.1.0 is a candidate tag only; availability must be rechecked before publication. **Actual release URL / direct .exe URL: unavailable, not fabricated.** Do not promote until clean-profile Locked smoke passes and owner explicitly confirms publication. Release notes should carry exact candidate checksum, version, Devnet/test-USDC scope and unsigned-installer warning. Actual public binary must subsequently be downloaded and size/SHA compared before enabling Web CTA.

2026-10-10 preparation: GitHub REST `releases/tags/v0.1.0` and `git/ref/tags/v0.1.0` both returned **404**. Candidate file rechecked locally: **5396940 bytes**, unchanged timestamp and exact expected SHA-256 above. No release, draft, tag or asset created. Local branch main remains `0930e1b85e373e17dd8bc850f81b8a6beb788cca`; Git index is empty. Neither gh nor vercel CLI is available in this session; authenticated GitHub publication/Vercel Dashboard access is not established. Authorization and publishing access are separate prerequisites.

Prepared publication specification (not published):

- Repository: `kiratonine/SolArch`; tag: `v0.1.0`; title: **SolArch Viewer v0.1.0 — Windows x64 Devnet Preview**; mark as **prerelease** because payments use Devnet/test USDC and full creator/payment/Device B E2E remains pending.
- Target commit: `0930e1b85e373e17dd8bc850f81b8a6beb788cca`, the committed Viewer/Core sources used by the existing installer. Future Marketplace-only /download commits do not silently change this artifact's source provenance.
- Upload exactly `SolArch Viewer_0.1.0_x64-setup.exe` from the verified local NSIS path. Keep build output out of the Git commit.
- **Expected future asset URL, NOT yet valid/verified:** `https://github.com/kiratonine/SolArch/releases/download/v0.1.0/SolArch%20Viewer_0.1.0_x64-setup.exe`.

Prepared release notes:

> Windows 10/11 x64 desktop Viewer, version 0.1.0. Russian/English installer and UI, .slr file association, trusted archive verification, in-app protected viewing and validated license handling. Connects to https://solarch-api.duckdns.org. Devnet preview: test USDC only, not real money. Installer is unsigned; Windows SmartScreen may warn. DRM is practical/best-effort, not absolute. Fresh Locked installation was manually checked in an independent standard Windows account; a new purchase and authenticated Device B denial were not tested in this release smoke.
>
> Installer: SolArch Viewer_0.1.0_x64-setup.exe; 5396940 bytes. SHA-256: b4040740b9a70a7d3ab56d7a553636868b03a1c77954053fc402afcdeedb6d48.

After explicit publication approval, recheck tag availability, publish without overwriting existing assets, download the actual public asset and compare bytes/hash. Only then record a **verified** URL and check the Vercel Production download variable. User reports that variable exists; its actual Dashboard value is not independently verified. Do not infer it from local .env or a planned URL.

### Explicit publication authorization — preflight PASS; access BLOCKED

Owner explicitly authorized publishing the specified **GitHub prerelease v0.1.0**, exact title above, target commit `0930e1b85e373e17dd8bc850f81b8a6beb788cca`, and only the existing verified NSIS binary. This supersedes the earlier pending-approval wording; **no further publication permission is needed for this exact artifact/specification**. Commit/push to main, Vercel changes and payments remain unauthorized.

Immediately before the publication attempt, public GitHub API checks again returned 404 for both `releases/tags/v0.1.0` and `git/ref/tags/v0.1.0`; local SHA-256 again exactly matched `b4040740b9a70a7d3ab56d7a553636868b03a1c77954053fc402afcdeedb6d48`, size **5396940**. Local HEAD still matches the agreed source commit.

Publishing cannot proceed in the current session: neither WSL nor Windows has gh available; no GH_TOKEN/GITHUB_TOKEN exists in either process environment; no Git credential helper is configured, and Windows GitHub CLI configuration is absent. Available GitHub connector tools expose no release creation/asset upload operation. No credentials were extracted from unrelated stores and no authorization bypass attempted. No release/tag/asset was created; public asset download/hash verification is consequently **NOT RUN**, not PASS.

Required owner action: install GitHub CLI in this WSL environment and authenticate using `gh auth login --hostname github.com --web` with an account that can create Releases/upload assets in `kiratonine/SolArch`. Use the browser login, not a token pasted into chat or committed to the repository. Alternatively publish the exact prepared prerelease and binary through GitHub's web UI, then provide its public URL for independent verification. Once authorized access is available, repeat the absence/hash checks before publishing. Do not set the unverified planned URL as proof of an available binary.

### Owner Web UI publication — independently verified

Owner published through GitHub Web UI; CLI/authentication is no longer required. Earlier publication-access notes describe the previous checkpoint, not a remaining blocker. Read-only GitHub API now returns HTTP 200: release ID `408419714`, exact title **SolArch Viewer v0.1.0 — Windows x64 Devnet Preview**, `draft=false`, `prerelease=true`. Release metadata target_commitish is `main`; the authoritative actual lightweight **tag object is type commit with SHA `0930e1b85e373e17dd8bc850f81b8a6beb788cca`**, so source binding is PASS, not inferred from the branch label. Release notes include Devnet/test USDC, Windows x64, unsigned/SmartScreen, best-effort DRM and pending purchase/Device B E2E limitations.

Release: `https://github.com/kiratonine/SolArch/releases/tag/v0.1.0`.

**Verified direct asset URL:** `https://github.com/kiratonine/SolArch/releases/download/v0.1.0/SolArch.Viewer_0.1.0_x64-setup.exe`.

GitHub's published asset name is **SolArch.Viewer_0.1.0_x64-setup.exe** (dot instead of the local filename's space). Independent unauthenticated HTTPS GET of the actual browser_download_url followed the redirect and streamed every byte through SHA-256: HTTP 200, **5396940 bytes**, SHA-256 **b4040740b9a70a7d3ab56d7a553636868b03a1c77954053fc402afcdeedb6d48**, exact match. The result does not rely solely on GitHub's reported size/digest. The public binary matches the accepted local installer; no rebuild, rename of local files or replacement upload was performed.

Vercel read-only check: public /download HTML responded 200; 23 referenced production JS chunks were inspected. They embed the DuckDNS Backend origin and **the old installer URL containing `SolArch%20Viewer`**. Independent HEAD of that old URL returns **404**. This is evidence of the currently deployed build's value, **not** direct inspection of the current Production Dashboard setting. No authenticated Vercel connection/config is available. Owner must check/update the Production setting below and Redeploy; if Dashboard already contains the new dot URL, only a new build/deploy is needed. No Vercel configuration was changed in this session.

```dotenv
VITE_API_BASE_URL=https://solarch-api.duckdns.org
VITE_ENABLE_MSW=false
VITE_VIEWER_DOWNLOAD_URL=https://github.com/kiratonine/SolArch/releases/download/v0.1.0/SolArch.Viewer_0.1.0_x64-setup.exe
```

Public /download RU/EN/UI/download acceptance is still pending the owner's reviewed commit/push and Redeploy. A 200 SPA response alone is not proof the new route/CTA works. No purchase, creator E2E or Device B authenticated denial was performed during these checks.

## Gate D — local and production /download PASS

Added TanStack /download route using existing Container/PageHeader/SectionHeading/StepList and ViewerDownloadButton, full RU/EN, Windows x64/version/name, installation/open instructions, in-Viewer payment explanation, Devnet test-token notice and SmartScreen guidance. No invented size/SHA for an unpublished online asset. Release metadata may be added only after exact published asset verification.

Single shared URL parser accepts only direct HTTPS .exe URLs without credentials/fragment, rejects webpage /download or release-tag HTML URLs. Header/mobile/footer product links, landing CTAs and how-it-works now lead to /download; only installer-mode CTA on that page uses VITE_VIEWER_DOWNLOAD_URL. Empty/invalid URL leaves visibly disabled download with accessible explanation. No auto-download, registration/web-payment/backend API feature. TanStack tree regenerated by standard Vite plugin; initial tsc-before-generation failure was resolved by generating route tree, without hand-editing generated types.

Local **production** preview (not dev/MSW) browser checks: 375/768/1280 px no horizontal overflow, disabled unavailable CTA, EN/RU, direct URL+refresh, footer navigation, keyboard Tab to semantic link PASS; service-worker registrations 0. Screenshot in ignored .playwright-mcp. This is UI evidence only, not wallet/payment E2E. Public `https://sol-arch.vercel.app/download` not deployed or claimed PASS: owner commit/push/redeploy required.

### Final public acceptance after owner push — PASS

Owner pushed the reviewed commit. Independent GitHub REST inspection of `git/ref/heads/main` returns **d1abc30615e775f1ae43dfdf1a4486fe728c7e2e**; compare of that commit to main is **identical**, ahead/behind 0. Local origin/main also reflects this commit after the owner's push. No fetch, new commit or push was performed by this validation session. The release tag remains bound to the earlier agreed Viewer source commit, not retargeted to the Marketplace commit.

Real production browser acceptance at `https://sol-arch.vercel.app/download` (no local preview or MSW):

- Direct open and reload render the actual download page and installation guidance, not merely a 200 SPA fallback.
- EN and RU headings/content/CTA work; RU survives reload, switching back to EN works.
- Header navigation, footer Get the Viewer, landing download CTA, how-it-works CTA, and mobile menu navigation reach /download. Menu closes after its transition; 375×560 and 1366×768 have no horizontal overflow. Keyboard Tab moves focus to a real interactive element.
- The enabled installer link is exactly `https://github.com/kiratonine/SolArch/releases/download/v0.1.0/SolArch.Viewer_0.1.0_x64-setup.exe`. Old `SolArch%20Viewer` URL absent in DOM and 23 inspected referenced production JS chunks.
- Clicking the real production CTA downloads **5396940 bytes**; independent browser download stream SHA-256 is **b4040740b9a70a7d3ab56d7a553636868b03a1c77954053fc402afcdeedb6d48**. Separate unauthenticated Node HTTPS GET/hash agrees. Redirect signed query parameters are not copied into reports; use the stable public GitHub asset URL.
- Actual frontend catalog GET to **https://solarch-api.duckdns.org/v1/marketplace/archives** returned **200**. HTTPS Backend origin is also present in deployed chunks; service-worker registrations **0**. Production Dashboard variables are still not directly inspected, but the deployed build demonstrably uses the correct API/installer URLs and live HTTP requests.

Browser harness diagnostics: first CTA selector was ambiguous between header navigation and the installer link; narrowed to `a[download]`. The harness disallows dynamic Node imports, so checksum used its available Web Crypto on the actual downloaded stream. The corrected checks PASS; neither issue is a product failure. Immediate menu visibility probe ran during its closing transition; awaiting hidden state confirmed closure.

Separate catalog limitation: two historical cover URLs (`61dbaec2-1824-463a-8812-590452703599.png`, `bc27421b-3457-4579-a922-81ec08121cf5.png`) produce browser NotSameOrigin errors; independent HEAD returns **404** with CORP same-origin. Missing cover records/files were already documented during deployment; no file was fabricated, state changed or Backend fix introduced. These resource errors are not installer failures. No payments/intents, creator login/upload or authenticated Device B attempt were performed.

This final verification only updates this report, unstaged. Source/business contracts/device credentials were not changed. Existing unrelated dirty tree remains preserved. Do not claim whole-product E2E COMPLETE based on release/download acceptance.

## Commands and results

| Check | Result |
| --- | --- |
| RTK Git status / HEAD / EOL-insensitive diff | PASS, main and existing work preserved |
| Controlled SSH reboot/systemd/mounts/HTTPS/hash/CORS checks | PASS |
| rtk pnpm --filter @solarch/viewer lint | PASS |
| rtk pnpm --filter @solarch/viewer test | PASS: 54 tests / 5 files |
| rtk pnpm --filter @solarch/viewer build | PASS, production frontend |
| rtk cargo test --locked -p solarch-core -p solarch-cli | PASS: 71 tests |
| Native Windows pnpm dlx Tauri build, prebuilt frontend | PASS, final candidate above |
| Native NSIS selector/install RU+EN/locale persistence/association | PASS |
| Real archives via installed association, HTTPS refresh→verified Unlocked | PASS on original account; credentials preserved |
| Fresh Locked under standard Windows account SolArchTest | MANUAL PASS, owner-reported; not automated E2E, no payment |
| rtk proxy pnpm --filter @solarch/web typecheck | PASS |
| rtk pnpm --filter @solarch/web lint | PASS |
| rtk pnpm --filter @solarch/web test | Final PASS: 316 tests / 35 files |
| rtk pnpm --filter @solarch/web build | PASS; production MSW=false, real API origin |
| rtk proxy node --test scripts/web-production-output.test.mjs | PASS: no MSW worker/dev wallet in production output |
| Local production browser responsive/i18n/refresh/keyboard | PASS; no mock service worker |
| Candidate NSIS size/SHA recheck, GitHub v0.1.0 availability | PASS: expected bytes/hash; release/tag absent (404) |
| GitHub prerelease/tag source verification | PASS: owner publication; exact commit, draft=false/prerelease=true |
| Independent public installer HTTPS download | PASS: 5396940 bytes, exact SHA-256 |
| Current Vercel build installer link | FAIL: old space-encoded URL returns 404; actual asset has dot |
| Current Vercel Production Dashboard setting | NOT VERIFIED: no authenticated Dashboard access; owner correction/redeploy required |
| Vercel Production /download smoke | NOT RUN: owner commit/push/redeploy pending |
| Controlled 18-file staging / staged whitespace check | PASS: exact allowlist, index-only LF preservation; commit/push NOT RUN |

Latest checkpoints supersede the historical pending/FAIL rows above:

| Final public check | Result |
| --- | --- |
| GitHub origin main contains accepted Web commit | PASS: exact d1abc30615e775f1ae43dfdf1a4486fe728c7e2e |
| Owner commit / owner push | DONE by explicitly authorized prior commit and subsequent owner push; no new commit/push in final check |
| Production /download direct load/reload, RU/EN and navigation | PASS in real browser |
| Desktop/mobile overflow and menu closure | PASS: 1366×768 / 375×560 |
| Installer CTA / no old space-encoded link | PASS: actual dot-named asset; DOM and deployed chunk inspection |
| Production CTA download and separate public HTTPS download | PASS: size and both independent SHA-256 checks exact |
| Frontend → HTTPS production Backend | PASS: real catalog GET 200; no service worker |
| Current Vercel Dashboard variable inspection | NOT RUN; deployed effective values verified, not Dashboard access |
| Full creator/purchase/Device B E2E | NOT RUN; remains separate authorization/test scope |

Initial raw `rtk pnpm --filter @solarch/web typecheck` hit RTK unsupported-filter routing (tsc not found), not project diagnostics; proxy command PASS. Initial Web suite 315/316: existing auth test asserted wallet as soon as header appeared, before async session completed. Test now awaits the same wallet/title assertion; no production auth logic changed, final full suite 316/316. Targeted run started before that fix also failed old assertion. Broad diff --check sees pre-existing CRLF and old whitespace in untouched code; targeted check with cr-at-eol policy passed for changed runtime files except existing whitespace in landing index.tsx, not mass-normalized. No blanket clean-worktree claim.

## Exact changed repository files for this task

- apps/web/src/routes/download.tsx (new)
- apps/web/src/routes/index.tsx (anchor comment; shared CTA behavior)
- apps/web/src/routes/how-it-works.tsx
- apps/web/src/routeTree.gen.ts (generated)
- apps/web/src/components/product/viewer-download.tsx
- apps/web/src/components/product/viewer-download.test.tsx (new)
- apps/web/src/components/layout/product-nav.tsx
- apps/web/src/components/layout/site-header.tsx (comment)
- apps/web/src/lib/viewer-download.ts
- apps/web/src/lib/viewer-download.test.ts (new)
- apps/web/src/lib/i18n/dict.en.ts
- apps/web/src/lib/i18n/dict.ru.ts
- apps/web/src/test/download.test.tsx (new)
- apps/web/src/test/landing.test.tsx
- apps/web/src/test/how-it-works.test.tsx
- apps/web/src/test/auth.test.tsx (await async session assertion)
- docs/deployment/VPS_DEPLOY_REPORT.md
- docs/deployment/VIEWER_RELEASE_DOWNLOAD_REPORT.md (new)

SUPABASE_MIGRATION_REPORT.md changes and other CRLF status entries predate this task, preserved. Private helpers/artifacts outside Git are not proposed release code. No Backend/Viewer runtime or contracts changes.

### Exact proposed commit scope after manual smoke

The 18 files in the inventory immediately above are the explicit allowlist for the release/download work (16 Web files and two deployment reports). VPS_DEPLOY_REPORT.md includes accepted previous deployment/reboot documentation. SUPABASE_MIGRATION_REPORT.md is **excluded** from this commit scope: it belongs to earlier migration work. No package/lockfile, Backend, Viewer, Core, shared contract, .env, private helper or installer binary is proposed for staging.

Do not use `git add .`, `git add -A`, or blanket normalization. Owner subsequently authorized preparation of the exact 18-file staged patch, **not commit/push**. Tracked candidates are normalized only in the index to HEAD's original LF convention before staging; working files and unrelated dirty entries remain untouched. All six explicitly listed new files (four Web tests/route, two deployment reports) belong to this allowlist. Existing EOL-only status entries and unrelated migration changes are excluded. The staged diff must be presented for owner confirmation before any commit. Review `git diff --cached --check`, `git diff --cached --stat` and exact path count; any inherited whitespace error in a reviewed candidate must be resolved without mass normalization.

Staging completed after confirming an initially empty index. All 12 tracked files retain HEAD's LF convention in staged blobs; six new files added, total **18 exact allowed paths**. No working file was rewritten by staging. `rtk git diff --cached --check` PASS; staged Web diff reviewed, contains route/navigation/shared CTA/RU-EN/URL parser/tests plus the two reports, no secrets, installer, migration or unrelated EOL changes. Existing accepted test results above were not rerun solely for staging/report updates (no new runtime implementation). Owner confirmation is required before commit and push; neither has occurred.

## Next required owner actions

The earlier publication/deploy action list below is historical; owner publication, commit/push and effective production deployment are now verified above. No further release/download deployment action is required by this check. Remaining actions: separately review/authorize report-only updates, address missing historic files if desired, and authorize/execute full creator/payment/Device B E2E rather than treating it as PASS.

1. Clean-profile Fresh Locked gate is now satisfied by the owner's SolArchTest manual smoke. No additional purchase or credential reset is requested.
2. GitHub publication and public binary verification are complete. Do not replace the verified asset or retarget its tag. Review the prepared staged patch and explicitly authorize commit/push separately.
3. Owner commit/push, Vercel Production variables and Redeploy:

```dotenv
VITE_API_BASE_URL=https://solarch-api.duckdns.org
VITE_ENABLE_MSW=false
VITE_VIEWER_DOWNLOAD_URL=https://github.com/kiratonine/SolArch/releases/download/v0.1.0/SolArch.Viewer_0.1.0_x64-setup.exe
```

The third value is now the actual verified direct binary URL. Check the Production Dashboard matches it, not the earlier space-encoded planned URL, /download, or a release HTML page. Never put backend/private secrets in Vercel. Owner commit/push and Redeploy are still pending; then verify public /download RU/EN, direct refresh, download size and SHA. Full creator/payment/renderer/Device B E2E remains a separate manual gate, with payment requiring owner confirmation.

## Proposed separate SUPABASE_MIGRATION_REPORT docs-only commit — NOT EXECUTED

Scope **one file only**: `docs/deployment/SUPABASE_MIGRATION_REPORT.md`; existing substantive unstaged diff is **+93 / −29** lines excluding EOL. This file was correctly excluded from the 18-file Web commit. No staging or editing of that migration report was performed during final publication validation.

Before separate approval: review its existing security/data/storage evidence, identify historical pre-import/pre-auth checkpoints clearly, and reconcile stale wording that filesystem transfer/reboot are pending with the accepted VPS report (actual reboot passed 2026-10-09). Do not rewrite historical baseline 170 rows as current counts or claim temporary Secret Key revocation without owner evidence. Preserve original backup/source and known missing historical archives. Scan the proposed diff for credentials/private keys/tokens and avoid CRLF-only normalization.

After explicit approval of that scope: stage only the reviewed document in HEAD's LF convention, show `git diff --cached --name-only`, `--stat` and `--check`, and confirm no API/source/migration SQL/.env/artifact is included. Proposed message: `docs(deployment): record verified Supabase migration and privacy gates`. Commit/push requires separate permission; no such operation has been executed. The new final acceptance additions in VIEWER_RELEASE_DOWNLOAD_REPORT.md are a **different** unstaged docs change and must not be silently included in a one-file migration commit; review them separately or explicitly agree on a two-report docs scope.
