# Supabase PostgreSQL Migration Report

Дата: 2026-10-09. Ветка: `main`.

Статус: **SUCCESS — PostgreSQL migration и security gate завершены.** Backup/import, данные, FK, SQL permissions и Prisma проверены. Внешние Data API проверки anon и authenticated: PASS, по 15/15 таблиц. Temporary Auth user удалён, cleanup подтверждён. Filesystem transfer/VPS deployment остаются отдельными незавершёнными этапами.

## Подключения и версии

- SOURCE: локальная PostgreSQL database `solarch`, `127.0.0.1:55432`. При повторной проверке для deployment источник независимо установлен по сохранённой конфигурации контейнера `solarch-part05-live-postgres`, а не по имени переменной `DATABASE_URL`. Сейчас `DATABASE_URL` также указывает на эту локальную БД.
- DESTINATION: новая Supabase PostgreSQL database `postgres`; подключение из `SUPABASE_URL_POOLER`, Session Pooler порт 5432, SSL required.
- Все три переменные заданы; URL/password синтаксически корректны, placeholders не обнаружены. Аутентификация SOURCE и Session Pooler успешна. Полные URL, usernames и credentials не включены в отчёт.
- Supabase Direct: NETWORK_UNREACHABLE из текущей среды. Пароль Direct независимо не подтверждён: соединение не достигло сервера. Transaction Pooler 6543 не использовался.
- SOURCE PostgreSQL 16.14; DESTINATION PostgreSQL 17.11.
- `psql`, `pg_dump`, `pg_restore`: 17.10. Подходят для dump PostgreSQL 16 и restore в PostgreSQL 17; patch version 17.10/17.11 не является major-version конфликтом.

## Read-only inspection и строки

SOURCE содержит только user schema `public`. DESTINATION содержит штатные Supabase schemas: `auth`, `extensions`, `graphql`, `graphql_public`, `public`, `realtime`, `storage`, `vault`. Перед backup и повторно перед импортом destination `public` не содержал relations/functions/types. После импорта там 15 application tables. Системные Supabase tables не изменялись и не включались в перенос приложения.

| SOURCE public table | SOURCE до переноса | DESTINATION сейчас |
| --- | ---: | --- |
| _prisma_migrations | 4 | 4 |
| archive_listings | 8 | 8 |
| archive_public_files | 15 | 15 |
| archives | 8 | 8 |
| device_activations | 6 | 6 |
| device_licenses | 6 | 6 |
| entitlements | 7 | 7 |
| marketplace_events | 34 | 34 |
| payment_intents | 31 | 31 |
| payment_transaction_issuances | 9 | 9 |
| payments | 7 | 7 |
| request_nonce_records | 19 | 19 |
| uploads | 8 | 8 |
| users | 4 | 4 |
| wallets | 4 | 4 |
| Всего | **15 таблиц, 170 строк** | **15 таблиц, 170 строк** |

Counts после импорта совпадают с frozen SOURCE snapshot. Дополнительно сравнен MD5 агрегата всех полных `row_to_json` строк каждой таблицы, отсортированных с COLLATE "C"; совпали все 15 таблиц. SOURCE повторно сравнен с pre-backup snapshot и не изменился. Эти digest не публикуются; SHA-256 самого backup отдельно сохранён приватно.

### Исторический deployment preflight до подтверждения write freeze — 2026-10-09

Read-only проверки повторены перед запрошенным VPS deployment. SOURCE: те же 15 таблиц / 170 строк; 4 завершённые migrations, незавершённых нет; все 16 FK validated. Это повторная проверка метаданных FK, не повторное выполнение ранее описанных anti-joins. Supabase Session Pooler доступен; в `public` 0 relations (включая tables/views/sequences), 0 functions и 0 types. Direct по-прежнему недоступен из этой среды (`NETWORK_UNREACHABLE`). SOURCE/DESTINATION не изменялись, backup/import не выполнялись.

**Security gate:** Supabase schema-scoped default privileges для объектов, создаваемых ролью `postgres`, предоставляют `anon`/`authenticated` права на новые tables, sequences и functions. `--no-acl` сам по себе не устраняет эти defaults. Перед commit восстановления необходимо закрыть доступ этих ролей к импортированным application objects в той же транзакции; отдельно проверить PUBLIC privileges, function execution, RLS и фактическую Data API exposure. Без этого migration SUCCESS и запуск Backend запрещены. Системные Supabase объекты не менять. Внешний PostgREST-test пока не выполнен.

**Write freeze подтверждён пользователем:** локальный NestJS, jobs и все известные writers остановлены, контейнер PostgreSQL оставлен работающим для backup. Подтверждение использовано для последующего импорта. SOURCE должен оставаться без записей до завершения privacy gate/cutover. Реальный `.env` не изменялся.

## Целостность и Prisma

- Все 16 SOURCE public foreign keys имеют `convalidated=true`. Read-only anti-join проверки каждого FK: orphan rows = 0.
- Entitlement ↔ Payment archive/device/buyer mismatch = 0.
- DeviceLicense ↔ DeviceActivation entitlement/device mismatch = 0.
- Payment ↔ PaymentIntent device mismatch = 0.
- PaymentIntent snapshot ↔ Archive fingerprint mismatch = 0.
- Prisma validate: PASS, exit 0.
- Prisma migrate status SOURCE: PASS, exit 0; 4 migrations, database up to date.
- Prisma validate DESTINATION: PASS, exit 0. Prisma migrate status DESTINATION после импорта: PASS, exit 0, database up to date; все 4 migration records перенесены без изменения.
- DESTINATION: повторены все 16 FK anti-joins, orphan rows = 0; все FK validated. Definitions constraints/indexes/4 functions/4 non-internal triggers совпадают с SOURCE.
- Entitlement ↔ Payment archive/device/buyer; License ↔ Activation entitlement/device; License ↔ Entitlement archive/device; Payment ↔ Intent archive/device/confirmed buyer; Intent ↔ Archive fingerprint: все mismatch counts = 0.
- Creator + platform shares равны expected price для всех intents. Confirmed payments = 7; сумма соответствующих expected prices = 8.00 USDC, совпадает SOURCE/DESTINATION. Это проверка переноса DB данных, не новая on-chain verification.
- Application sequences отсутствуют в обеих БД (0); sequence state переносить не требовалось.
- Все 4 SOURCE migration records завершены, rolled-back records отсутствуют. Raw checksum локальных migration files отличается от записанного checksum из-за CRLF. После read-only нормализации CRLF→LF в памяти все 4 checksum совпадают. Migration files и history не изменялись.
- Команды Prisma выполнялись через pnpm exec в дочернем процессе с нужным `DATABASE_URL` только в его environment; raw stdout/stderr не публиковались, поскольку Prisma выводит connection metadata. Реальный `apps/api/.env` не изменялся.

## Выполненный backup и restore

Backup сохранён вне Git: `/home/denis/.local/share/solarch/supabase-migration-20261009-saNhVM/source-public.dump`, 67093 bytes, каталог 0700, dump 0600. Custom-format `pg_dump --format=custom --schema=public --no-owner --no-acl` выполнен после подтверждения write freeze. SHA-256 — в приватном `backup.sha256`, содержимое/checksum не включены в отчёт. Backup, TOC, restore SQL и verification metadata сохранены; они содержат чувствительные данные и не должны публиковаться или попадать в Git.

TOC проверен: excluded CREATE SCHEMA public и COMMENT ON SCHEMA public; owner/ACL не восстанавливались, roles и системные schemas не переносились. `pg_restore --no-owner --no-acl --exit-on-error --use-list=... --file=-` сгенерировал приватный restore SQL. **Осознанный transactional вариант:** вместо standalone `pg_restore --single-transaction` SQL выполнен через `psql -X --single-transaction -v ON_ERROR_STOP=1 --file=...`, чтобы restore и последующий security block были одной транзакцией. В начале этой же транзакции повторно проверена пустота target. `--clean`, DROP, reset, db push и destructive retry не применялись.

До commit отозваны ALL privileges у PUBLIC/anon/authenticated на всех imported public tables/sequences/functions. Отключены schema-specific automatic grants роли postgres для anon/authenticated; для future functions этой роли убран global default PUBLIC EXECUTE. На всех 15 application tables включён RLS без browser policies (владелец postgres для Backend сохраняет доступ). Существующие системные Supabase objects/permissions и defaults роли supabase_admin не переписывались. Выполнен NOTIFY pgrst reload schema.

Внутри транзакции и после commit `has_table_privilege`, `has_sequence_privilege`, `has_function_privilege` для anon/authenticated: 0 разрешённых объектов; tables без RLS: 0. SQL impersonation `SET LOCAL ROLE anon/authenticated; SELECT 1 FROM public.device_licenses LIMIT 1` в read-only транзакциях: обе роли получают permission denied. Это SQL privacy PASS, не внешний Data API PASS.

Историческая проверка сразу после импорта: внешний HTTPS GET `/rest/v1/device_licenses?select=id&limit=1` вернул HTTP 401 без API key. Это не проверяло object grants; на тот момент public key отсутствовал и deployment был остановлен. Последующее устранение anon blocker описано ниже. SOURCE и backup не удалялись.

### Последующая реальная anon Data API проверка — PASS

Пользователь добавил `SUPABASE_PROJECT_URL` и `SUPABASE_PUBLISHABLE_KEY` локально. URL проверен как HTTPS root origin без credentials/path/query/fragment; project identity совпадает с Session Pooler configuration. Значения ключа и connection credentials не публиковались.

- Positive control: `GET /auth/v1/settings` с корректным publishable key → HTTP 200, ожидаемая структура settings. Ключ действительно принят этим проектом.
- Negative controls: `GET /rest/v1/device_licenses?select=id&limit=1` без ключа и с явно неверным test key → HTTP 401 от gateway, без SQLSTATE 42501 / permission-denied признака.
- С корректным ключом, без Authorization/user JWT: GET `?select=id&limit=1` для **всех 15 импортированных таблиц**, перечисленных в counts table → **HTTP 401 + SQLSTATE 42501 + permission denied**, 15/15 PASS. Таким образом anonymous REST access блокируется database privileges, а не некорректным key/URL. Ни один запрос не вернул строки.
- Операции read-only: данные, schema, grants и real env не изменялись; test users не создавались. Ответы settings/данные/keys не записывались в логи и отчёт.
- Authenticated внешняя проверка: NOT RUN. До создания temporary Supabase Auth test user требуется отдельное подтверждение владельца. SQL-role authenticated denial из предыдущего этапа остаётся PASS, но не подменяет external JWT test.

Справка по интерпретации SQLSTATE 42501: [Supabase Database API permission errors](https://supabase.com/docs/guides/troubleshooting/database-api-42501-errors). Это не ошибка принятия publishable key; механизм ключей описан в [официальной документации](https://supabase.com/docs/guides/getting-started/api-keys).

### Authenticated checkpoint — создание разрешено, credential blocker

Владелец явно разрешил одного временного Supabase Auth пользователя с unique email/random password, без application records/extra grants, с последующим удалением пользователя и завершением сессий. Read-only `GET /auth/v1/settings` с public key повторно вернул HTTP 200: email auth enabled, signup enabled, email autoconfirm disabled. В локальном `.env` отсутствуют `SUPABASE_SECRET_KEY` и `SUPABASE_SERVICE_ROLE_KEY`.

До предоставления admin credential пользователь **не создаётся**: обычный signup потребовал бы email confirmation и не обеспечивает supported admin deletion. Прямые изменения `auth.users`, подделка JWT, отключение email confirmation или ослабление grants не используются. Нужен project secret API key либо legacy service_role key локально; значение не отправлять в чат и не включать в VPS env/Git/reports. Admin credential используется только для create/cleanup; таблицы проверяются public key + real ordinary authenticated JWT, никогда admin key. [Supabase Admin createUser](https://supabase.com/docs/reference/javascript/auth-admin-createuser), [user management/deletion](https://supabase.com/docs/guides/auth/managing-user-data).

Temporary user/session/password/JWT ещё не создавались. SOURCE/DESTINATION/VPS не изменены в этом checkpoint. Migration overall остаётся PARTIAL; authenticated external PASS не заявляется.

## Файлы, которые PostgreSQL transfer НЕ переносит

Current storage root: `/home/denis/.local/share/solarch/backend-storage`.

Доступные файлы текущего root:

- `slr/bf14ba07-15a6-4a3b-aabc-36d20e74cb37.slr`
- `slr/690ac87c-1af1-444f-b2a4-8e6a74d5f2f4.slr`
- `custody/bf14ba07-15a6-4a3b-aabc-36d20e74cb37.ack.enc`
- `custody/690ac87c-1af1-444f-b2a4-8e6a74d5f2f4.ack.enc`
- `covers/64e17804-9a5c-492a-82ac-4936fa5cf2ea.png`

Шесть SOURCE archive rows содержат старый root `/tmp/solarch-part05-live-20260914/storage/slr/`, который сейчас отсутствует. Недоступные `.slr` references:

- `3d764ed0-e1ae-4b37-93da-4be67b36b3fa.slr`
- `a39fdcfb-0626-4dd2-8171-538c03233435.slr`
- `60ad6fed-6d73-4a20-af54-71f901da2460.slr`
- `1e4598da-8a63-4692-8897-949da12b68f1.slr`
- `1496a603-5b9f-42d7-b96c-5fedbb44b0e6.slr`
- `08b035ed-8002-4dad-b625-85b8bfce6f28.slr`

Для этих шести archive IDs custody files `<id>.ack.enc` отсутствуют в текущем root; старый temporary storage целиком недоступен. Внутренние `content_key_ref` не являются содержимым ACK и не заменяют custody files. ACK/KEK в отчёт не выводились.

Uploads используют relative DB paths `storage_data/uploads/…`. При cwd `apps/api` все 8 доступны в `/mnt/d/install/projects/solarch/apps/api/storage_data/uploads/`:

- `c4a1db36-382c-45de-b137-0d0e43755c49-1789338612940.zip`
- `d2316fd4-71f7-42c0-838f-f381db64de2c-1789641620532.zip`
- `a2a24479-4457-4389-8770-01fe6ae58a1b-1789669267973.zip`
- `2437c38d-1b47-4acd-8a36-fddef34fbeaf-1789717618445.zip`
- `355845b8-afa8-4d3a-b97b-e111278d3ec9-1790070330603.zip`
- `12e96a92-e8c8-465e-acd6-e21b5e6da708-1790075124955.zip`
- `bc0ead49-328e-49fa-8936-16db991d7427-1790530281710.zip`
- `dd53b68d-3535-4db3-b793-adecff0d0afd-1790861346155.zip`

Три cover filenames записаны в БД; `bc27421b-3457-4579-a922-81ec08121cf5.png` и `61dbaec2-1824-463a-8812-590452703599.png` отсутствуют в current covers directory, третий указан выше. Current staging пуст. Наличие копий в других backup locations не проверено.

Эти директории/файлы потребуется отдельно скопировать на VPS с корректными permissions. Старые absolute/relative DB filesystem references потребуют отдельного согласованного remapping; этой задачей данные не переписываются. Для существующих encrypted custody нужен исходный KEK, передаваемый отдельно безопасным способом; Supabase database dump его не заменяет. Недоступные protected archives/custody нельзя безопасно пересоздать под существующими immutable identities.

## Ограничения и рекомендация DATABASE_URL

В SOURCE записей/DDL не выполнялось. В DESTINATION импортированы application schema/data и применены privacy grants/RLS/defaults, описанные выше. Код приложения, Prisma schema и реальные `.env` не изменены; frozen contracts не менялись. Обновлены только migration/deployment reports в репозитории. Никакого commit/push.

Сейчас оставить `DATABASE_URL` без изменений. После SUCCESS и отдельного переноса файлов использовать existing `SUPABASE_URL_DIRECT`, если VPS имеет доступ к Direct; иначе existing `SUPABASE_URL_POOLER` Session :5432 с SSL. Transaction :6543 для этого переноса не использовать. Значение credentials не копируется в отчёт.

Следующий checkpoint: продолжить VPS deployment/storage transfer по плану. Write freeze SOURCE остаётся в силе, старые writers не запускать. **Повторный restore не нужен и запрещён как автоматический retry:** данные уже импортированы. Missing filesystem files остаются отдельным ограничением функциональной работоспособности даже после успешного privacy gate.

Исторический VPS blocker: finalized-archive trigger запрещает изменение `generated_slr_storage_key`, включая path-only remap. Владелец затем подтвердил стратегию №1: сохранить immutable DB values через ограниченные filesystem mappings. Она выполнена без отключения triggers; актуальный результат ниже и в VPS report.

## Финальный authenticated Data API checkpoint — PASS

Владелец предоставил temporary local `SUPABASE_SECRET_KEY` и разрешил создание/cleanup одного пользователя. Preflight: на `auth.users` нет user-defined triggers. Admin API создал одного ordinary `authenticated` пользователя с unique random email, CSPRNG random password и `email_confirm: true`, без extra roles/grants/application records.

Обычный password login выдал настоящий access/refresh token. JWT claims sub/role/expiry проверены; GET Auth `/user` с public key + user JWT вернул HTTP 200 и exact test-user identity/role. Внешние GET `?select=id&limit=1` ко всем 15 импортированным tables выполнялись **только с publishable key + user JWT**, без Secret Key; все вернули **HTTP 403 / SQLSTATE 42501 / permission denied**, 15/15 PASS. Network/auth failures не считались PASS.

Cleanup: global signout успешен; Admin API hard delete успешен; subsequent admin GET пользователя HTTP 404. Read-only DB inspection для точного test user: auth.users=0, identities=0, sessions=0, refresh_tokens=0. Попытка use прежнего refresh token HTTP 400, token не обновлён. Counts/full-row digests всех 15 SolArch application tables до/после теста идентичны. Credentials были только в памяти процесса, не сохранялись; процесс завершён. Сохранены только sanitized result flags вне Git. **Temporary Secret Key больше не нужен: владелец должен отозвать его в Dashboard и удалить temporary local env entry.** Он не должен попасть в VPS env.

Ограничение Supabase: выданные stateless access JWT могут оставаться cryptographically valid до exp даже после logout/deletion; мгновенную JWT invalidation не заявляем. Refresh/session/user cleanup проверен, token нигде не сохранялся и authenticated role по-прежнему не имеет доступа к application objects. [Официальная документация signout](https://supabase.com/docs/guides/auth/signout).

## VPS follow-up: approved immutable mappings и storage transfer — PASS

Актуальный checkpoint 2026-10-09 заменяет предыдущие описания «files not transferred» / «mapping blocked», сохранённые выше как история миграции. PostgreSQL migration status остаётся **SUCCESS**; overall VPS deployment **PARTIAL** до reboot/creator/Windows E2E.

На VPS `/var/lib/solarch/storage` перенесены все 13 реально доступных файлов: 2 .slr, 2 matching custody .ack.enc, 1 cover и 8 ZIP. Размеры/SHA-256 каждого файла сравнены с source manifest. SOURCE/storage не удалялись. Шесть отсутствующих исторических archives/custody и два covers не восстановлены искусственно, statuses/publications/records не менялись.

Для архивов bf14ba07-15a6-4a3b-aabc-36d20e74cb37 и 690ac87c-1af1-444f-b2a4-8e6a74d5f2f4 сохранены exact `generated_slr_storage_key` под `/home/denis/.local/share/solarch/backend-storage/slr/`. Каждый old path отображён отдельным enabled systemd per-file bind mount на verified persistent VPS file, flags `ro,nosuid,nodev,noexec`; Backend явно зависит от этих units. Read permissions service user, restart mounts/Backend и guest downloads PASS; actual VPS reboot ещё не выполнен.

DB `archive_fingerprint`, `content_key_ref` и `generated_slr_storage_key` неизменны; full archives digest совпадает, все 4 immutability triggers enabled. SHA-256 обоих .slr совпал с DB fingerprint; native `solarch verify` с existing public trust anchor подтвердил signature/container integrity. Compiled production AckCustodyService unseal обоих matching encrypted ACK с existing KEK успешно; keys не выводились/не сохранялись, buffer zeroized.

Отдельно, только для восьми copied/verified ZIP, атомарно обновлены `uploads.storage_key` на `/var/lib/solarch/storage/uploads/<original filename>`. Original values и applied exact SQL сохранены приватно перед UPDATE; row ID/original path/row_count проверены. Immutable archives не затронуты.

Приватный каталог backup `/home/denis/.local/share/solarch/supabase-migration-20261009-saNhVM` (0700) сохраняет original source-public.dump (67093 bytes), storage-backup.tar (8458240 bytes), destination-after-deployment.dump (70964 bytes), private checksums/manifest и ZIP original values/SQL; files 0600. Offsite encrypted backups/automatic schedule/restore drill ещё не выполнены. KEK/signing keys требуют отдельной защищённой recovery strategy, они не включены в storage bundle.

После реальных двух guest download checks закономерно добавлены два audit rows `marketplace_events` (34→36): всего 172 application rows vs baseline 170, остальные counts неизменны. Это не ошибка restore: baseline full-row equality проверена до запуска API. Новых payments/intents/USDC purchases не создавалось.

Production Backend теперь использует Supabase Session Pooler :5432 SSL через private VPS env; реальный public HTTPS health/ready возвращает 200, DB/RPC готовы. Temporary Supabase Secret Key не передавался на VPS и больше не нужен; отзыв в Dashboard остаётся действием владельца. Local DATABASE_URL не менялся этим этапом. Все runtime/storage/HTTPS/CORS/test результаты и оставшиеся manual checkpoints — в `VPS_DEPLOY_REPORT.md`.
