# Supabase PostgreSQL Migration Report

Дата: 2026-10-09. Ветка: `main`.

Статус: **PARTIAL** — read-only preflight завершён. Backup и import ещё не выполнены: требуется подтверждение остановки записей в SOURCE на время финального dump/restore/verification. Отсутствие активных sessions при одной проверке не доказывает остановку будущих записей.

## Подключения и версии

- SOURCE: локальная PostgreSQL database `solarch`, порт 55432; подключение из `DATABASE_URL`.
- DESTINATION: новая Supabase PostgreSQL database `postgres`; подключение из `SUPABASE_URL_POOLER`, Session Pooler порт 5432, SSL required.
- Все три переменные заданы; URL/password синтаксически корректны, placeholders не обнаружены. Аутентификация SOURCE и Session Pooler успешна. Полные URL, usernames и credentials не включены в отчёт.
- Supabase Direct: NETWORK_UNREACHABLE из текущей среды. Пароль Direct независимо не подтверждён: соединение не достигло сервера. Transaction Pooler 6543 не использовался.
- SOURCE PostgreSQL 16.14; DESTINATION PostgreSQL 17.11.
- `psql`, `pg_dump`, `pg_restore`: 17.10. Подходят для dump PostgreSQL 16 и restore в PostgreSQL 17; patch version 17.10/17.11 не является major-version конфликтом.

## Read-only inspection и строки

SOURCE содержит только user schema `public`. DESTINATION содержит штатные Supabase schemas: `auth`, `extensions`, `graphql`, `graphql_public`, `public`, `realtime`, `storage`, `vault`. В destination `public` нет таблиц; конфликтующих пользовательских таблиц при проверке не обнаружено. Системные Supabase tables не изменялись и не включаются в перенос приложения.

| SOURCE public table | SOURCE до переноса | DESTINATION сейчас |
| --- | ---: | --- |
| _prisma_migrations | 4 | отсутствует |
| archive_listings | 8 | отсутствует |
| archive_public_files | 15 | отсутствует |
| archives | 8 | отсутствует |
| device_activations | 6 | отсутствует |
| device_licenses | 6 | отсутствует |
| entitlements | 7 | отсутствует |
| marketplace_events | 34 | отсутствует |
| payment_intents | 31 | отсутствует |
| payment_transaction_issuances | 9 | отсутствует |
| payments | 7 | отсутствует |
| request_nonce_records | 19 | отсутствует |
| uploads | 8 | отсутствует |
| users | 4 | отсутствует |
| wallets | 4 | отсутствует |
| Всего | **15 таблиц, 170 строк** | **0 public tables, 0 application rows** |

Это предварительные counts, не финальный согласованный migration snapshot. После подтверждения write freeze нужно повторно проверить target conflicts и counts. After-import counts пока отсутствуют, потому что import не выполнялся.

## Целостность и Prisma

- Все 16 SOURCE public foreign keys имеют `convalidated=true`. Read-only anti-join проверки каждого FK: orphan rows = 0.
- Entitlement ↔ Payment archive/device/buyer mismatch = 0.
- DeviceLicense ↔ DeviceActivation entitlement/device mismatch = 0.
- Payment ↔ PaymentIntent device mismatch = 0.
- PaymentIntent snapshot ↔ Archive fingerprint mismatch = 0.
- Prisma validate: PASS, exit 0.
- Prisma migrate status SOURCE: PASS, exit 0; 4 migrations, database up to date.
- Prisma migrate status DESTINATION: exit 1, все 4 migrations pending, ожидаемо для пустой application schema. `_prisma_migrations` отсутствует.
- Все 4 SOURCE migration records завершены, rolled-back records отсутствуют. Raw checksum локальных migration files отличается от записанного checksum из-за CRLF. После read-only нормализации CRLF→LF в памяти все 4 checksum совпадают. Migration files и history не изменялись.
- Команды Prisma выполнялись через pnpm exec в дочернем процессе с нужным `DATABASE_URL` только в его environment; raw stdout/stderr не публиковались, поскольку Prisma выводит connection metadata. Реальный `apps/api/.env` не изменялся.

## Backup и стратегия после write freeze

Backup пока не создан — финальный backup должен последовать после подтверждения остановки записей. План: приватный custom-format pg_dump SOURCE public schema со всеми данными, sequences, functions/triggers, constraints и `_prisma_migrations`, вне Git, в отдельном каталоге с mode 0700 и dump mode 0600. Backup содержит чувствительные данные приложения и не должен попадать в report/Git/обычные logs. Backup не удаляется после restore.

Перед restore повторно проверить пустой destination и application object conflicts. Restore выполняется только для SOURCE application objects, с `--no-owner --no-acl --single-transaction --exit-on-error`, без `--clean`/DROP и без импорта системных schemas. Existing destination schema `public` сохраняется; CREATE SCHEMA public/его ownership/ACL entry исключается из restore TOC. PostgreSQL roles не переносятся.

Дополнительно проверить Supabase default privileges: payments, license/credential tables не должны становиться доступны через anon/authenticated PostgREST. При восстановлении в public необходимо контролировать права imported objects и не предоставлять browser roles доступ к чувствительным данным. Нельзя считать Supabase default grants безопасной заменой Backend authorization. Системные Supabase schemas/permissions не переписываются.

После restore: сравнение таблиц/counts/data fingerprints, FK и device/payment relationships, migration history, Prisma status. При ошибке transactional restore откатывается; SOURCE остаётся неизменной. `DATABASE_URL` остаётся SOURCE до успешного завершения всех проверок.

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

Записей/DDL в SOURCE или DESTINATION не выполнялось. Код приложения, Prisma schema, реальные `.env` и данные не изменены. Единственный новый repo file — этот report. Никакого commit/push.

Сейчас оставить `DATABASE_URL` без изменений. После SUCCESS и отдельного переноса файлов использовать existing `SUPABASE_URL_DIRECT`, если VPS имеет доступ к Direct; иначе existing `SUPABASE_URL_POOLER` Session :5432 с SSL. Transaction :6543 для этого переноса не использовать. Значение credentials не копируется в отчёт.

Следующий необходимый checkpoint: пользователь останавливает Backend и остальные writers SOURCE и подтверждает write freeze. После этого можно создать final private backup и выполнить migration. Missing filesystem files остаются отдельным ограничением функциональной работоспособности даже при успешном PostgreSQL transfer.
