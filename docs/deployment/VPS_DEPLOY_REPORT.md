# SolArch VPS Deployment Report

Дата: 2026-10-09. Статус: **PARTIAL — migration/security gate SUCCESS; Backend HTTPS, storage mappings, reboot и guest downloads PASS. Полный Windows/creator E2E и публикация Viewer не завершены.**

## Scope и release

Работа выполнена по `TODO/SOLARCH_VPS_DEPLOYMENT_PLAN_UPDATED.md` и явно подтверждённой стратегии №1: immutable DB paths сохраняются через per-file bind mounts. Прочитаны AGENTS.md, SECURITY.md, INTEGRATION.md и migration report. Исходный `TODO/SOLARCH_VPS_DEPLOYMENT_PLAN.md` отсутствует.

Ветка main, release HEAD `0930e1b85e373e17dd8bc850f81b8a6beb788cca`. Существующий dirty tree сохранён: runtime diff обусловлен CRLF; содержательные изменения этого этапа только в двух deployment reports. На VPS доставлен именно committed HEAD через git archive, не локальные незакоммиченные файлы. Commit/push/fetch/merge/rebase/reset/stash не выполнялись. Код, shared contracts и локальный .env не менялись.

## PostgreSQL migration/security gate — SUCCESS

SOURCE независимо найден через конфигурацию контейнера `solarch-part05-live-postgres`: loopback :55432, database solarch, PostgreSQL 16.14. Пользователь подтвердил остановку writers; SOURCE не изменялся и не удалялся. DESTINATION — Supabase PostgreSQL 17.11 через Session Pooler :5432 с SSL; Direct из WSL недоступен, Transaction Pooler не использован.

Импорт public application schema/data выполнен одной транзакцией вместе с privacy configuration после повторной проверки пустоты. До commit закрыты PUBLIC/anon/authenticated object privileges и опасные default grants, включён RLS на 15 application tables. Supabase system schemas не импортировались/не удалялись. На момент миграции совпали все 15 tables / 170 rows, sorted full-row digests, definitions constraints/indexes/functions/triggers; 16 FK validated и anti-joins без orphan rows. Payment/device/fingerprint bindings без расхождений; 7 confirmed payments, 8.00 USDC суммарно. Prisma validate/status PASS: четыре completed migrations, up to date.

External Data API: valid publishable key control HTTP 200; anon 15/15 denied HTTP 401/42501. Ordinary Auth user с реальным password-login JWT: Auth identity HTTP 200; authenticated 15/15 denied HTTP 403/42501. Secret Key не использован для чтения таблиц. Global logout, admin deletion, GET 404, users/identities/sessions/refresh_tokens = 0; прежний refresh denied. App counts/digests неизменны. Stateless JWT instant revocation не заявляется. Temporary SUPABASE_SECRET_KEY больше не нужен: отозвать в Dashboard и удалить временную local env entry; на VPS не передавался.

## Persistent storage и immutable mappings — PASS

Основной storage `/var/lib/solarch/storage`, system user solarch (nologin); storage directories 0700, files 0600. Переданы и сравнены SHA-256/size всех 13 доступных файлов: два .slr, два custody .ack.enc, один cover и восемь ZIP uploads. Исходные файлы сохранены.

| Archive ID | Bytes | SHA-256 = DB archive_fingerprint |
| --- | ---: | --- |
| bf14ba07-15a6-4a3b-aabc-36d20e74cb37 | 2853209 | 799b497e212beefb368c193df11aebd968742cc9abdc2b87993d566e47f8159c |
| 690ac87c-1af1-444f-b2a4-8e6a74d5f2f4 | 64201 | d1c64fab0808d723ae329963013c306c373c099132d76c23c5c78a7f808265f0 |

Сохранены exact DB paths `/home/denis/.local/share/solarch/backend-storage/slr/<id>.slr`. Для каждого файла создан отдельный systemd .mount с What `/var/lib/solarch/storage/slr/<id>.slr`, Where exact legacy path, options `bind,ro,nosuid,nodev,noexec`. Units enabled для multi-user.target; Backend Requires/After обоих mounts. Legacy parent directories root:solarch 0750. Read-only flags, SHA и чтение сервисным пользователем проверены после restart mounts и Backend; запись в alias запрещена. **Контролируемая полная перезагрузка 2026-10-09 выполнена с разрешения владельца: boot persistence PASS**, см. follow-up ниже.

`generated_slr_storage_key`, `archive_fingerprint`, `content_key_ref` не изменены. Полные archives row digests сохранены, все четыре immutability triggers enabled. Обход guard не применялся. `/tmp` mappings не создавались.

Native production solarch verify для обоих старых DB paths с существующим public signing anchor: AUTHENTICATED_CONTAINER PASS и exact fingerprint. Это проверка signature/container integrity, не доказательство полного renderer fidelity. Production compiled AckCustodyService успешно unseal обоих matching custody с существующим ACK_KEK_SECRET и exact DB identity/reference; 32-byte ACK немедленно zeroized, не выводился и не сохранялся.

Отдельная транзакция remap изменила только восемь `uploads.storage_key` для реально скопированных, size/SHA-verified ZIP: relative `storage_data/uploads/<name>` → absolute `/var/lib/solarch/storage/uploads/<name>`. Original values и exact SQL сохранены приватно; каждый UPDATE требовал exact original ID/path и row_count=1. Archive immutable fields не затронуты.

Шесть исторических .slr/custody отсутствуют: 08b035ed-8002-4dad-b625-85b8bfce6f28, 1496a603-5b9f-42d7-b96c-5fedbb44b0e6, 1e4598da-8a63-4692-8897-949da12b68f1, 3d764ed0-e1ae-4b37-93da-4be67b36b3fa, 60ad6fed-6d73-4a20-af54-71f901da2460, a39fdcfb-0626-4dd2-8171-538c03233435. Два covers также отсутствуют: bc27421b-3457-4579-a922-81ec08121cf5.png и 61dbaec2-1824-463a-8812-590452703599.png. Records/statuses/publications не удалялись и не изменялись; содержимое не выдумывалось. Для восстановления нужны реальные backups либо отдельное решение владельца.

## Backup coverage

Приватный каталог вне Git `/home/denis/.local/share/solarch/supabase-migration-20261009-saNhVM` mode 0700:

- `source-public.dump`: original SOURCE, 67093 bytes, 0600; private SHA-256 сохранён.
- `storage-backup.tar`: все 13 доступных storage files, 8458240 bytes, 0600; manifest/checksum сохранены.
- `uploads-original-values.json` и `uploads-remap.sql`: исходные paths и применённое изменение, 0600.
- `destination-after-deployment.dump`: после remap/download checks, 70964 bytes, 0600; private checksum сохранён.

Backup/SOURCE не удалены. KEK/signing keys не входят в storage bundle; необходим их отдельный безопасный recovery plan. Offsite encrypted backup, автоматическое расписание и disaster restore rehearsal ещё не настроены. Это не заявляется как завершённый production backup SLA.

## VPS runtime / HTTPS — PASS

Ubuntu 24.04.4 x86_64, SSH существующий known-host, time UTC/NTP synchronized. Node 22.23.3 official Linux SHA verified, pnpm 10.32.1, rustc/cargo 1.99.0. Установлены необходимые build packages/Nginx/certbot/UFW. 36 pending OS upgrades не применялись автоматически; swap отсутствует; provider dashboard/firewall отдельно не проверены.

Release `/opt/solarch/releases/0930e1b85e373e17dd8bc850f81b8a6beb788cca`, current symlink; native CLI `/opt/solarch/bin/solarch`. Production Nest entrypoint `apps/api/dist/src/main.js`, запускается обычным Node без ts-node/watch.

Private `/etc/solarch/api.env`, root:solarch 0640, directory 0750: allowlisted existing keys/HMAC/KEK/RPC/fee payer переданы без вывода; DATABASE_URL Session Pooler SSL, NODE_ENV production, PORT 3000, STORAGE_LOCAL_ROOT persistent, SOLARCH_CLI_PATH native absolute, PUBLIC_API_ORIGIN `https://solarch-api.duckdns.org`, WEB_ALLOWED_ORIGINS `https://sol-arch.vercel.app`. Existing trust anchors сохранены. Нет temporary Supabase admin key, debug clock, fixtures или TTL override. Production startup validation PASS.

Systemd `solarch-api.service` enabled/active/restart PASS, user solarch; mount dependencies, NoNewPrivileges, PrivateTmp/Devices, ProtectSystem strict, ProtectHome read-only, writable storage only, empty capabilities, umask 0077. Unit validation PASS. UFW enabled с preserved SSH: only 22/80/443 inbound; внешние :3000/:5432 не доступны. SSH после включения проверен. Nginx TLS1.2/1.3 proxy localhost:3000; HTTP→HTTPS; existing 512 MiB upload policy не менялась, timeout учитывает ArchiveBuilder. Access logs не содержат query/headers/body. Private storage не served как static root.

Let's Encrypt certificate issued для exact domain, expires 2027-01-07; renewal timer и validated Nginx reload hook configured. `certbot renew --dry-run --no-random-sleep-on-renew` PASS. Первый SSH dry-run оборвался: PASS заявлен только для повторного завершённого run с keepalive. Certificate account без email — renewal notifications требуют отдельной настройки.

## Выполненные проверки

Команды запускались через RTK; custom SSH/Node diagnostics — rtk proxy. Secrets/connection metadata в raw reports не публиковались.

| Проверка | Результат |
| --- | --- |
| Native `pnpm install --frozen-lockfile` | PASS |
| Native `pnpm --filter @solarch/api prisma:generate` | PASS, Prisma 5.22 |
| Native `pnpm --filter @solarch/api lint` / `build` | PASS / PASS |
| Native `pnpm --filter @solarch/api test --runInBand` | PASS: 138 tests, 15 suites |
| Native `pnpm --filter @solarch/api test:e2e --runInBand` | PASS: 25 tests; existing test harness, не live payment evidence |
| Initial `test -- --runInBand` invocation | FAIL: argument interpreted as test pattern; corrected command выше PASS |
| Native `cargo build --locked --release -j2 -p solarch-cli` | PASS |
| Native `cargo test --locked -j2 -p solarch-core -p solarch-cli` | PASS: 61 Core + 10 CLI; не Windows Viewer workspace smoke |
| Service-user CLI / production EnvService startup / custody unseal | PASS |
| 13 file transfer checks / two archive signatures+DB hashes | PASS |
| Mount restart + service access/read-only + Backend restart | PASS; actual VPS reboot follow-up PASS |
| Full archives digest and enabled immutable triggers after ZIP remap | PASS |
| HTTPS health / ready before and after restart | 200 / 200; real DB + Devnet RPC ready |
| Vercel CORS preflight, Authorization allowed | 204, exact allow-origin |
| Foreign browser origin | 404, no allow-origin; not claimed as HTTP 403 |
| Native/no-Origin requests | PASS |
| Two real public guest .slr downloads | 200, size/SHA exact |
| Real public cover | 200 PNG |
| Direct public custody / upload ZIP URLs | 404 / 404 |
| Browser actual Vercel catalog | PASS: real DuckDNS API 200 + cover 200, no registered service worker |
| Vercel lazy production chunks | New API origin present, localhost fallback absent; Dashboard not inspected |
| Last 300 Backend journal entries secret scan | No current secret values found; bounded check, not exhaustive audit |
| Let's Encrypt renewal dry run | PASS |

At the initial deployment checkpoint, two guest downloads legitimately added two marketplace_events audit rows (34→36): 172 application rows vs import baseline 170, other counts unchanged. Later reboot/release smoke adds legitimate download audit events and normal license refresh writes; baseline equality is not claimed after service operation. No new PaymentIntent, payment or USDC purchase created. Missing historical covers produce actual browser errors; no fake fallback evidence or silent status changes applied.

## Remaining checkpoints / honest status

1. Maintenance reboot gate now PASS: real boot + enabled mounts/Backend/TLS/guest hashes verified below.
2. Real creator wallet login → new upload/complete/publish/guest download: requires external wallet signing, not performed with forged JWT or mocked login. Current native builder/unit tests are not this E2E.
3. Windows Viewer release candidate now built for current origin with original public anchors; installer/RU/EN/association and real refresh→Unlocked smoke completed. Fresh Locked requires an independent clean Windows profile/VM because both available archives are licensed on this host. Full purchase/renderers/independent Device B matrix not rerun; no payment created. Details in VIEWER_RELEASE_DOWNLOAD_REPORT.md.
4. Resolve missing historical assets with owner; do not rebuild immutable archive IDs or alter statuses without authorization.
5. Provider firewall review, controlled OS updates, backup automation/offsite restore drill, secret recovery plan, certificate contact email. Temporary Supabase Secret Key revoke remains owner action.

Vercel catalog already calls real new origin. If rebuilding Vercel, Production `VITE_API_BASE_URL=https://solarch-api.duckdns.org`, `VITE_ENABLE_MSW=false`, redeploy. Do not publish/update Windows download until an actual reviewed installer exists.

## Changed repository files

- `docs/deployment/SUPABASE_MIGRATION_REPORT.md`
- `docs/deployment/VPS_DEPLOY_REPORT.md`

Initial VPS deployment did not change application code, Prisma schema or frozen contracts. Subsequent Marketplace /download implementation is recorded separately in VIEWER_RELEASE_DOWNLOAD_REPORT.md; Backend/Core/Viewer runtime source remains unchanged. SOURCE and backups retained. Prisma skill used for validation/status guidance only; no schema/version migration. Overall deployment remains PARTIAL pending the explicit checkpoints above.

## 2026-10-09 follow-up — controlled reboot gate PASS

Read `TODO/SOLARCH_VIEWER_RELEASE_AND_DOWNLOAD_PART.md`. Owner authorized one reboot. Preflight: active intent windows 0, processing archives 0, other active DB transactions 0; no builder/pg_dump/pg_restore/certbot process, no staging jobs; Backend and both mount units enabled. Private SOURCE/storage/post-deploy dumps retained (0600). Existing strict-known-host SSH available; provider recovery console not independently inspected.

One `sudo systemctl reboot`, no repeated reboot. Brief SSH timeouts occurred during boot; subsequent strict-known-host SSH returned. Boot ID changed from 764ed3f0-280f-4b80-90d9-e8bb266bd7d8 to 3701df0b-e06e-4605-b4d2-2c13b83dc029. Backend/Nginx active; failed units empty. Both immutable aliases mounted with ro,nosuid,nodev,noexec. Native source hashes and public guest download size/SHA match both DB fingerprints. HTTPS certificate validation and health/ready 200; database/solana_rpc ok. Cover 200, Vercel Authorization preflight 204 exact allow-origin, UFW active 22/80/443 only, external 3000/5432 unreachable. Current-boot Backend journal priority=error empty. No trigger/path workaround or missing-file reconstruction.

Windows release smoke subsequently performed actual POST device-license refresh for both existing Device A licenses (HTTP 200 in safe Nginx access log), and production Viewer reached verified Unlocked/file lists. No tokens/grant contents logged here; no USDC purchase initiated. The diagnostic retry_metadata command intentionally rejected an already-Unlocked session before network because it requires locked_identity; it is not evidence of a Backend failure. Fresh Locked/install publication remain gated as documented in the release report.
