# VPS Backend Preparation Report

Дата: 2026-10-09. Ветка: `integrate/marketplace-full-stack`, HEAD: `bc74356`.

## Scope и исходное состояние

Выполнена локальная подготовка NestJS Backend к Linux VPS. Working tree до работы содержал многочисленные незакоммиченные изменения и CRLF во многих файлах. Эти изменения сохранены. Deployment, Docker, Nginx, SSL, изменения реальных `.env`, ключей, PostgreSQL и существующих архивов не выполнялись. Commit/push не выполнялись.

## Проблемы и исправления

1. Raw и multipart upload использовали `./storage_data/uploads` независимо от `STORAGE_LOCAL_ROOT`. Добавлен единый `EnvService.uploadsDirectory`. Raw upload и Multer diskStorage используют его; Multer получает EnvService через `registerAsync`. Директория создаётся автоматически, путь сохраняемого файла абсолютный. Формат HTTP upload, лимит multipart 512 MiB и ownership flow сохранены.
2. Live startup принимал относительное/временное хранилище и не проверял запись. В существующем live-режиме `STORAGE_LOCAL_ROOT` теперь обязателен и должен быть абсолютным. Отвергаются OS temp directory, `/tmp`, `/var/tmp`, `/dev/shm`, `/run` и их потомки; после создания root проверяется `realpath`, включая symlinks. Запись проверяется новым случайным файлом с exclusive-create и правами 0600. Удаляется только этот probe; существующие protected files не открываются и не удаляются. Ошибки конфигурации останавливают startup. В non-live development/test сохраняется default `./storage_data` и возможность относительной конфигурации, разрешаемой в абсолютный путь от cwd. Существующая классификация live (включая Devnet) не менялась.
3. CORS отражал любой browser Origin. Новый allowlist разрешает только явно перечисленные HTTPS origins. В development дополнительно разрешён `http://localhost:5173`. Отсутствие Origin допускается для native Viewer и серверных клиентов. Неизвестным origins CORS-разрешение не выдаётся. Bearer Authorization и credentials сохранены; реальный Nest preflight проверен тестом.
4. `PORT` мог оставаться строкой из env, которую Node может трактовать как IPC path вместо TCP port. Значение теперь преобразуется в целое число 1..65535 с понятной ошибкой.

Проверено согласованное использование root:

| Данные | Директория |
| --- | --- |
| ZIP uploads | `EnvService.uploadsDirectory = storageRoot/uploads` |
| Final .slr | `storageRoot/slr` в UploadsService |
| Encrypted ACK | `storageRoot/custody` в AckCustodyService |
| Covers | `storageRoot/covers` в ArchiveCoversService |
| Builder source staging | `storageRoot/staging` в UploadsService |

## Изменённые файлы этой задачи

- `apps/api/src/config/env.service.ts`
- `apps/api/src/config/cors.ts` — новый helper.
- `apps/api/src/config/deployment.spec.ts` — новые storage/startup/PORT/CORS регрессии.
- `apps/api/src/main.ts`
- `apps/api/src/modules/uploads/uploads.controller.ts`
- `apps/api/src/modules/uploads/uploads.module.ts`
- `apps/api/src/modules/uploads/uploads-storage.spec.ts` — новые raw/multipart storage регрессии.
- `apps/api/.env.example`
- `docs/deployment/VPS_BACKEND_PREP_REPORT.md`

`package.json`, `tsconfig.json`, `nest-cli.json` и `pnpm-lock.yaml` проверены, дополнительных изменений этой задачей не потребовали. Общие frozen docs и Web/Viewer/Core не изменялись этой задачей.

## Env и production runtime

- Новый `WEB_ALLOWED_ORIGINS`: comma-separated canonical HTTPS origins, например `https://project.vercel.app,https://market.example`. Без credentials, path, query, fragment, wildcard или trailing slash. Пустое значение в production запрещает browser origins; native requests без Origin продолжают работать.
- Существующий `STORAGE_LOCAL_ROOT`: live/production требует явного абсолютного постоянного root. Пример будущей конфигурации: `/var/lib/solarch/storage`; этот путь не хардкодится. Пользователь сервиса должен иметь права записи.
- `PORT`: существующая переменная, теперь строгий числовой TCP port.
- `DATABASE_URL`: Prisma datasource уже использует `env("DATABASE_URL")`, PrismaService выполняет `$connect()` при startup. Новая БД и миграции не применялись.
- `SOLARCH_CLI_PATH`: существующая live-валидация требует absolute existing file; ArchiveBuilder использует configured path и `spawn(..., shell: false)`. Windows-specific fallback candidates не используются при явной live-конфигурации. Builder/IPC/crypto контракт не менялся. На VPS нужен Linux executable с правами исполнения.
- Native production command уже правильная: `rtk pnpm --filter @solarch/api start:prod` → `node dist/src/main.js`. Nest build уже переписывает aliases; `tsc-alias` не добавлялся. Проверены 62 compiled JS files: unresolved `require('@/...')` — 0.
- Plain Node v20.20.2 успешно загрузил compiled entrypoint и import graph без ts-node/tsconfig-paths. Smoke выполнялся из пустой временной cwd с минимальным env; `NestFactory.create` перехвачен до DB/storage/network initialization. Это проверка runtime import graph, не доказательство полного production server startup с реальными зависимостями.
- Отдельно вызван compiled EnvService startup hook: missing root, relative root и `/tmp/solarch` отвергнуты с ошибкой `STORAGE_LOCAL_ROOT`.

## Проверки

Статус: локальная реализация и обязательные Backend regression checks завершены; полный dirty-tree whitespace check остаётся FAIL по прежним изменениям. VPS deployment не выполнялся.

| Команда / проверка | Результат |
| --- | --- |
| `rtk pnpm --filter @solarch/api prisma:generate` | PASS, Prisma Client 5.22.0; schema/DB не изменялись |
| `rtk pnpm --filter @solarch/api lint` | PASS |
| `rtk pnpm --filter @solarch/api test` | PASS, 138/138 тестов, 15/15 suites |
| `rtk pnpm --filter @solarch/api test:e2e` | PASS, 25/25 |
| `rtk pnpm --filter @solarch/api build` | PASS |
| Plain Node compiled entrypoint/import graph | PASS, без TypeScript runtime loaders |
| Compiled invalid-storage startup hook | PASS, missing/relative/temp rejected |
| `rtk git diff --check` | FAIL: существующие CRLF/trailing whitespace во всём dirty tree |
| Scoped diff-check с command-local `cr-at-eol` для пяти изменённых tracked файлов | PASS; git config не изменялся |

Первые test/build runs выявили ошибки новых тестов (проверка пути через HTTP DTO и process.env приоритет над тестовой конфигурацией); тесты исправлены. Дополнительный запуск `test -- --runInBand` завершился No tests found из-за разделителя аргументов pnpm/Jest; после этого запущен обычный полный `test`.

E2E suite использует существующие mock Prisma/RPC/custody: это API regression evidence, не live Devnet/VPS E2E. Новые upload тесты записывают синтетические байты в disposable директории. Storage validation test проверяет сохранность отдельного синтетического retained file, отсутствие оставшихся probes и отказ symlink к temp. CORS test использует реальный Nest HTTP server/preflight. Реальные secrets для новых тестов не нужны.

## Совместимость, риски и ограничения

HTTP API, payment/license semantics, immutable prices, `.slr`, crypto и trust anchors не менялись. Marketplace в production должен быть указан в allowlist; native Viewer без Origin продолжает использовать тот же Bearer flow. CORS не заменяет авторизацию и не блокирует non-browser клиентов.

Проверка записи подтверждает текущую доступность файловой системы, но не долговечность mount, free space, backup policy или отсутствие будущего изменения permissions. Права на root и его родителей должны запрещать посторонним менять symlinks/данные. Plain Node smoke не подключался к PostgreSQL и не запускал live payment или real archive build. Jest выдаёт существующее предупреждение bigint native bindings/pure-JS fallback; dependencies этой задачей не обновлялись.

Полный `git diff --check` остаётся FAIL: исходный dirty tree содержит массовые CRLF и прежние trailing spaces. Даже command-local разрешение CRLF оставляет 40 прежних trailing-whitespace findings вне scoped fix. Репозиторий целиком не нормализован, чтобы не переписать чужие изменения.

## Что сделать при фактическом VPS deployment

1. Подготовить сервисного Linux пользователя, persistent volume/root, permissions и резервное копирование; проверить существующие DB storage paths при переносе, особенно старые абсолютные Windows/WSL paths. Автоматической миграции этих записей нет.
2. Установить совместимый Node/pnpm и Linux solarch CLI; настроить `SOLARCH_CLI_PATH` и executable permissions.
3. Передать реальные production secrets и env безопасным способом, включая `DATABASE_URL`, absolute storage root, `PORT`, `PUBLIC_API_ORIGIN` и browser allowlist.
4. Сверить migration history и применить миграции контролируемым deployment workflow к нужной БД, затем generate/build и `start:prod`.
5. Настроить process supervision, HTTPS/reverse proxy, firewall и health monitoring отдельной задачей.
6. Проверить на VPS full startup, DB readiness, upload/build/download/cover paths, Vercel CORS и native Viewer; выполнить live smoke отдельно.
