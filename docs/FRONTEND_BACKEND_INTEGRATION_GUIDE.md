# SolArch — Руководство по интеграции: Marketplace Backend ↔ Marketplace Frontend

**Документ:** Инструкция для агента по совмещению бэкенда с фронтендом  
**Ветка бэкенда:** `marketplace-backend` (`apps/api`)  
**Ветка фронтенда:** `feat/marketplace-frontend` (`apps/web`)  
**Дата актуализации:** Сентябрь 2026  
**Статус готовности бэкенда:** Тесты пройдены (21 unit + 17 e2e = 38 тестов PASS), сборка успешна.

---

## 1. Введение и архитектурный контекст

SolArch — децентрализованная платформа дистрибуции защищённого контента в формате `.slr` с оплатой в USDC через Solana Pay и DRM-лицензированием.

### Незыблемые инварианты системы (Non-Negotiable)
1. **Валюта — только USDC**: canonical SPL token mint с 6 знаками (decimals = 6). Никаких SOL, dynamic FX или x402.
2. **Неизменяемая цена (Immutable Price)**: цена архива и snapshot комиссии платформы (500 bps = 5%) замораживаются при `POST /v1/archives`. Метод `PATCH` никогда не может изменить цену. Для смены цены автор создаёт новый архив.
3. **Non-custodial 95/5 Split**: каждая покупка — атомарная Solana-транзакция (95% напрямую на ATA автора, 5% на ATA SolArch). Платформа не хранит балансы авторов и не делает batch withdrawals.
4. **Спонсирование комиссий сети (Fee Sponsorship)**: SolArch является `fee payer` (оплачивает network fee в SOL). Покупатель платит ровно цену архива в USDC и 0 SOL комиссии сети.
5. **Авторитетный бэкенд**: фронтенд и Desktop Viewer не принимают финансовых или лицензионных решений. Только бэкенд проверяет блокчейн и выдаёт лицензии.
6. **Отсутствие аккаунтов покупателей в MVP**: покупатель на вебе не логинится. Гость свободно скачивает `.slr`. Покупка и DRM-активация происходят внутри SolArch Desktop Viewer, где ключ устройства (Device A) привязывается к Payment Intent до оплаты.
7. **Single Device Policy**: `max_devices = 1`. Один покупатель — одно устройство.

---

## 2. Текущий статус бэкенда и результаты тестирования

Ветка `marketplace-backend` полностью укомплектована и протестирована:
- **Unit тесты (`npm run api:test`)**: 7 test suites, 21 тест — **PASS**
  - `crypto.spec.ts` (JCS RFC 8785, Ed25519 pure signatures, RFC 9180 HPKE Base mode, TOKEN32 HMAC)
  - `marketplace.spec.ts` (Каталог, фильтрация, сортировки, дедупликация просмотров)
  - `analytics.spec.ts` (Агрегации, конверсии, разделение выручки 95/5)
  - `uploads.spec.ts` (Защита от Zip Slip, path traversal, фильтрация исполняемых файлов, лимит 512MB)
  - `archives.spec.ts` (Экономика 95/5, неизменяемость цен, автосоздание ATA автора)
  - `licensing.spec.ts` (Ed25519 подпись лицензий, 72h offline window, HPKE wrapping, max_devices=1)
  - `payments.spec.ts` (Solana Pay transaction request, валидация 95/5 split, верификация finality)
- **E2E тесты (`npm run test:e2e --workspace apps/api`)**: 1 test suite, 17 тестов — **PASS**
  - Полный сквозной путь: Health -> Auth (Challenge/Verify) -> Create Archive -> Catalog -> Payment Intent -> Solana Pay Request -> Verification -> Activation -> Licensing -> Analytics.
- **Сборка (`npm run api:build`)**: компиляция NestJS без ошибок.
- **Линтер (`npm run api:lint`)**: 0 ошибок.

---

## 3. Матрица эндпоинтов и карта соответствия

| Область | Метод | Эндпоинт API | Авторизация | Назначение | Статус совместимости с фронтендом |
|---|---|---|---|---|---|
| **Health** | GET | `/v1/health` | Public | Liveness check | 100% готов |
| **Health** | GET | `/v1/health/ready` | Public | Readiness check (DB, Solana, Fee Payer) | 100% готов |
| **Auth** | POST | `/v1/auth/wallet/challenge` | Public | Получение nonce и сообщения для подписи | 100% готов |
| **Auth** | POST | `/v1/auth/wallet/verify` | Public | Проверка подписи, выпуск JWT `access_token` | **Требуется адаптация** (см. разд. 4.1) |
| **Auth** | GET | `/v1/me` (или `/v1/auth/me`) | Bearer JWT | Текущий профиль автора | 100% готов |
| **Auth** | POST | `/v1/auth/logout` | Bearer JWT | Инвалидация сессии | 100% готов |
| **Marketplace** | GET | `/v1/marketplace/archives` | Public | Публичный каталог архивов с сортировкой | **Требуется адаптация пагинации** (см. разд. 4.2) |
| **Marketplace** | GET | `/v1/marketplace/archives/:slug` | Public | Карточка архива для гостей | **Требуется согласование полей** (см. разд. 4.3) |
| **Marketplace** | GET | `/v1/marketplace/archives/:slug/files` | Public | Публичный список файлов архива | 100% готов |
| **Marketplace** | GET | `/v1/marketplace/archives/:slug/download`| Public | Скачивание сгенерированного `.slr` | 100% готов (Stream + headers) |
| **Creator** | POST | `/v1/archives` | Bearer JWT | Создание архива и фиксация 95/5 USDC | 100% готов |
| **Creator** | GET | `/v1/archives` | Bearer JWT | Список архивов текущего автора (My Archives)| **Требуется добавить маршрут** (см. разд. 4.4) |
| **Creator** | GET | `/v1/archives/:archiveId` | Bearer JWT | Детали архива для автора | **Требуется приведение DTO** (см. разд. 4.4) |
| **Creator** | GET | `/v1/archives/:archiveId/files` | Bearer JWT | Опись распакованных файлов до публикации | **Требуется добавить маршрут** (см. разд. 4.4) |
| **Creator** | PATCH| `/v1/archives/:archiveId` | Bearer JWT | Редактирование описания/категории | 100% готов |
| **Creator** | POST | `/v1/archives/:archiveId/publish` | Bearer JWT | Публикация архива и автосоздание ATA | 100% готов |
| **Creator** | POST | `/v1/archives/:archiveId/unpublish`| Bearer JWT | Снятие с публикации | 100% готов |
| **Creator** | GET | `/v1/archives/:archiveId/download` | Bearer JWT | Авторское скачивание `.slr` | 100% готов |
| **Uploads** | POST | `/v1/uploads/init` | Bearer JWT | Инициализация загрузки ZIP | 100% готов |
| **Uploads** | POST | `/v1/uploads/:uploadId/data` (или `/file`)| Bearer JWT | Передача байтов ZIP-архива | **Требуется согласование транспорта** (см. разд. 4.5) |
| **Uploads** | POST | `/v1/uploads/:uploadId/complete` | Bearer JWT | Валидация ZIP, сборка `.slr`, перевод в ready| **Требуется дополнить ответ** (см. разд. 4.5) |
| **Uploads** | POST | `/v1/uploads/:uploadId/cancel` | Bearer JWT | Отмена загрузки | 100% готов |
| **Analytics** | GET | `/v1/archives/:archiveId/analytics` | Bearer JWT | Статистика автора (7d, 30d, all) | 100% готов |
| **Viewer API** | GET | `/v1/viewer/archives/:archiveId` | Public | Метаданные до оплаты | 100% готов |
| **Payments** | POST | `/v1/payment-intents` | Public | Создание интента, привязка Device A | 100% готов |
| **Payments** | GET/POST| `/v1/solana-pay/.../transaction` | Public | Solana Pay Transaction Request (95/5 USDC) | 100% готов |
| **Payments** | POST | `/v1/payment-intents/:id/verify`| SolArchIntent | Верификация finalized транзакции на блокчейне| 100% готов |
| **Licensing** | POST | `/v1/.../activate-device` | SolArchIntent | Выпуск JCS+Ed25519 лицензии и HPKE ACK | 100% готов |
| **Licensing** | POST | `/v1/device-licenses/:id/refresh`| DeviceRefresh| Продление 72-часового окна лицензии | 100% готов |
| **Licensing** | POST | `/v1/licenses/check` | Public | Проверка валидности лицензии | 100% готов |

---

## 4. Критические расхождения и пошаговые инструкции по стыковке

При анализе веток `marketplace-backend` и `feat/marketplace-frontend` выявлено 5 ключевых точек расхождения, которые агент интеграции должен закрыть:

### 4.1. Аутентификация: Bearer JWT vs Cookie Session
- **Проблема**:
  - Фронтенд (`apps/web/src/lib/api/config.ts`) заложил допущение Q1: `API_CREDENTIALS = 'include'` (ожидание httpOnly cookie-сессии).
  - Бэкенд (`apps/api`) возвращает в ответе на `POST /v1/auth/wallet/verify`:
    ```json
    {
      "authenticated": true,
      "access_token": "eyJhbGciOi...",
      "user": { "id": "usr_...", "wallet": "...", "status": "active" }
    }
    ```
  - Все защищённые эндпоинты бэкенда охраняются `WalletAuthGuard`, который ожидает заголовок `Authorization: Bearer <access_token>`.
- **Что сделать агенту**:
  1. В `apps/web/src/lib/api/types.ts` обновить схему `walletVerifyResponseSchema`, добавив токен:
     ```ts
     export const walletVerifyResponseSchema = z.object({
       authenticated: z.boolean(),
       access_token: z.string().optional(),
       user: sessionUserSchema,
     })
     ```
  2. В `apps/web/src/lib/api/auth.ts` при успешном `verifyWalletSignature` сохранять `access_token` (например, в `localStorage.setItem('solarch_token', res.access_token)` или сессионном хранилище/памяти).
  3. В `apps/web/src/lib/api/http.ts` в функции `apiRequest`:
     ```ts
     const token = typeof window !== 'undefined' ? localStorage.getItem('solarch_token') : null;
     const authHeader = token ? { Authorization: `Bearer ${token}` } : {};
     // подмешивать authHeader в headers запроса
     ```
  4. При вызове `logout` удалять сохранённый токен.

---

### 4.2. Формат пагинации каталога архивов
- **Проблема**:
  - Фронтенд (`apps/web/src/lib/api/types.ts`) ожидает плоскую структуру:
    ```ts
    {
      items: T[],
      page: number,
      per_page: number,
      total: number,
      has_more: boolean
    }
    ```
  - Бэкенд (`MarketplaceService.listArchives`) возвращает:
    ```json
    {
      "items": [ ... ],
      "pagination": {
        "page": 1,
        "limit": 20,
        "total": 5,
        "total_pages": 1
      }
    }
    ```
- **Что сделать агенту**:
  - **Рекомендуемый вариант (на бэкенде в `MarketplaceService`)**:
    Сделать ответ обратно совместимым с обеими моделями — вернуть и объект `pagination`, и плоские поля:
    ```ts
    return {
      items: cleanItems,
      page,
      per_page: limit,
      total,
      has_more: page < Math.ceil(total / limit),
      pagination: {
        page,
        limit,
        total,
        total_pages: Math.ceil(total / limit),
      },
    };
    ```
    Это не сломает существующие тесты бэкенда и мгновенно удовлетворит валидацию Zod на фронтенде (`marketplaceArchiveListSchema`).

---

### 4.3. Согласование полей карточки архива (`GET /v1/marketplace/archives/:slug`)
- **Проблема**:
  - Бэкенд возвращает:
    - `access_rules: { max_devices, allow_export, watermark_enabled }`
    - `download_availability: boolean`
  - Фронтенд Zod-схема (`marketplaceArchiveDetailSchema`) ожидает:
    - `license_policy: { max_devices, allow_export, watermark_enabled }`
    - `download_available: boolean`
    - `marketplace_status: 'published'`
- **Что сделать агенту**:
  - В `MarketplaceService.getArchiveBySlug` отдавать оба варианта названий (алиасы):
    ```ts
    return {
      ...
      license_policy: {
        max_devices: arc.maxDevices,
        allow_export: arc.allowExport,
        watermark_enabled: arc.watermarkEnabled,
      },
      access_rules: {
        max_devices: arc.maxDevices,
        allow_export: arc.allowExport,
        watermark_enabled: arc.watermarkEnabled,
      },
      marketplace_status: listing.marketplaceStatus,
      download_available: arc.technicalStatus === 'ready',
      download_availability: arc.technicalStatus === 'ready',
    };
    ```

---

### 4.4. Эндпоинты кабинета автора (`My Archives`)
- **Проблема**:
  1. `GET /v1/archives`: фронтенд запрашивает список архивов автора (`listMyArchives`). На бэкенде маршрут отсутствует (в `ArchivesController` `@Get(':archiveId')` перехватывает `/v1/archives`, пытаясь найти ID `'archives'`, и возвращает 404).
  2. Формат архива автора: фронтенд ожидает DTO `creatorArchiveSchema` с полями в `snake_case` (`archive_id`, `technical_status`, `marketplace_status`, `price`, `economics`, `license_policy`, `creator_payout_wallet`, `payout_account_ready`, `file_count`, `size_bytes`, `metrics`, `created_at`). Бэкенд возвращает объект Prisma в `camelCase`.
  3. `GET /v1/archives/:archiveId/files`: фронтенду необходим просмотр списка распакованных файлов автором *до* публикации архива. Сейчас на бэкенде есть только публичный эндпоинт по slug (`/marketplace/archives/:slug/files`), а у черновика slug ещё не опубликован.
- **Что сделать агенту**:
  1. В `apps/api/src/modules/archives/archives.controller.ts` добавить обработчик списка перед параметризованным маршрутом:
     ```typescript
     @Get()
     async listMyArchives(@CurrentUser() user: any) {
       return this.archivesService.listForCreator(user.id);
     }
     ```
  2. В `ArchivesService` реализовать `listForCreator(userId)` и обновить `findOne`, чтобы они возвращали структурированный DTO:
     ```typescript
     function formatCreatorArchive(arc: any, economics: any) {
       const views = arc.events?.filter(e => e.eventType === 'archive_view').length || 0;
       const downloads = arc.events?.filter(e => e.eventType === 'archive_download').length || 0;
       const paidUnlocks = arc.payments?.filter(p => p.status === 'confirmed').length || 0;
       const sizeBytes = arc.publicFiles?.reduce((acc, f) => acc + Number(f.sizeBytes), 0) || 0;

       return {
         archive_id: arc.id,
         slug: arc.listing?.slug || null,
         title: arc.title,
         short_description: arc.shortDescription || '',
         description: arc.description || '',
         cover_url: arc.listing?.coverStorageKey || null,
         technical_status: arc.technicalStatus,
         marketplace_status: arc.marketplaceStatus,
         price: {
           currency: arc.priceCurrency,
           amount: arc.priceAmount,
         },
         economics,
         license_policy: {
           max_devices: arc.maxDevices,
           allow_export: arc.allowExport,
           watermark_enabled: arc.watermarkEnabled,
         },
         creator_payout_wallet: arc.creatorPayoutWallet,
         payout_account_ready: Boolean(arc.creatorUsdcAta),
         file_count: arc.publicFiles?.length || 0,
         size_bytes: sizeBytes,
         metrics: {
           views,
           downloads,
           paid_unlocks: paidUnlocks,
         },
         created_at: arc.createdAt.toISOString(),
       };
     }
     ```
  3. Добавить маршрут `GET /v1/archives/:archiveId/files` в `ArchivesController`:
     ```typescript
     @Get(':archiveId/files')
     async getArchiveFiles(@Param('archiveId') archiveId: string, @CurrentUser() user: any) {
       return this.archivesService.getFilesForCreator(archiveId, user.id);
     }
     ```
  4. В `POST /v1/archives/:archiveId/publish` возвращать полный объект `CreatorArchive`, чтобы фронтенд мог обновить кэш без дополнительного запроса.

---

### 4.5. Загрузка исходных файлов (`Uploads Flow`)
- **Проблема**:
  - Фронтенд (`apps/web/src/lib/api/uploads.ts`):
    - При `initUpload` получает `{ upload_id }`.
    - Если `upload_url` не пришёл, отправляет файл методом `POST /v1/uploads/:uploadId/data` через `xhr.send(file)` (прямая передача бинарного тела).
    - Вызывает `POST /v1/uploads/:uploadId/complete` и ожидает ответ:
      ```ts
      {
        upload_id: string,
        archive_id: string,
        technical_status: TechnicalStatus
      }
      ```
  - Бэкенд:
    - Контроллер сейчас имеет `@Post(':uploadId/file')` с `FileInterceptor('file')` (ожидает `multipart/form-data` с именем поля `file`).
    - Метод `complete` на бэкенде возвращает `{ archive_id, technical_status, archive_fingerprint, file_count, size_bytes }`, в котором пропущено поле `upload_id`!
- **Что сделать агенту**:
  1. В `UploadsController` добавить обработчик для `@Post(':uploadId/data')`, принимающий бинарный поток:
     ```typescript
     @Post(':uploadId/data')
     async uploadRawData(@Param('uploadId') uploadId: string, @Req() req: Request) {
       // сохранить тело req в storage_data/uploads/<uploadId>.zip
       // вызвать uploadsService.setUploadedFile(uploadId, filePath)
     }
     ```
     *Или* в ответе `POST /v1/uploads/init` возвращать `upload_url: apiUrl('/uploads/' + upload.id + '/file')` и научить фронтенд отправлять `FormData` с полем `file`. Первый вариант проще и прозрачнее.
  2. В `UploadsService.complete` обязательно возвращать `upload_id`:
     ```typescript
     return {
       upload_id: upload.id,
       archive_id: updatedArchive.id,
       technical_status: updatedArchive.technicalStatus,
       archive_fingerprint: updatedArchive.archiveFingerprint,
       file_count: filesToInsert.length,
       size_bytes: buildResult.sizeBytes,
     };
     ```

---

## 5. Пошаговый сценарий развёртывания и проверки интеграции (Step-by-Step Runbook)

### Шаг 1. Запуск инфраструктуры бэкенда
```bash
# 1. Запустить локальный контейнер PostgreSQL
npm run db:up

# 2. Применить миграции базы данных
npm run prisma:migrate --workspace apps/api

# 3. Запустить бэкенд в режиме разработки
npm run api
# Сервер стартует на http://localhost:3000
# Swagger доступен на http://localhost:3000/docs
```

### Шаг 2. Настройка и запуск фронтенда
```bash
# 1. Проверить переменные окружения в apps/web/.env
VITE_API_BASE_URL=http://localhost:3000

# 2. Запустить dev-сервер фронтенда
npm run web
# Приложение доступно на http://localhost:5173 (или 3001)
```

### Шаг 3. Верификация сквозного E2E сценария
Агент должен проверить следующие шаги в браузере или через автоматические тесты:
1. **Гостевой поток**:
   - Открыть главную страницу каталога `http://localhost:5173/`. Каталог загружает `GET /v1/marketplace/archives` без ошибок 401/404.
   - Открыть карточку архива `/archives/:slug`. Проверить отображение цены в USDC, метрик (views, downloads, paid unlocks) и списка файлов (`GET .../files`).
   - Нажать `Download .slr`. Файл `.slr` скачивается с бэкенда (`GET .../download`), счётчик `downloads` инкрементируется на сервере.
2. **Вход автора**:
   - Нажать кнопку `Connect Wallet`.
   - Происходит запрос `POST /v1/auth/wallet/challenge`.
   - Кошелёк (Phantom/Solflare или mock-кошелёк) подписывает сообщение.
   - Отправляется `POST /v1/auth/wallet/verify`.
   - Токен `access_token` сохраняется, интерфейс переключается в состояние авторизованного автора.
3. **Создание архива**:
   - Зайти в `Dashboard` -> `Create Archive`.
   - Ввести название, описание, цену (например, `10.00 USDC`), payout wallet.
   - Увидеть автоматический расчёт 95/5 (Creator: 9.50 USDC, SolArch: 0.50 USDC, Network fees: Covered by SolArch).
   - Нажать `Create`. Архив создаётся в статусе `draft`.
4. **Загрузка контента**:
   - Прикрепить тестовый ZIP-архив с поддерживаемыми файлами (PDF, PNG, DOCX, XLSX).
   - Индикатор загрузки плавно доходит до 100%.
   - Бэкенд распаковывает ZIP, проверяет безопасность (защита от Zip Slip), генерирует `.slr` контейнер.
   - Технический статус переходит в `ready`.
5. **Публикация архива**:
   - Автор нажимает `Publish`.
   - Бэкенд проверяет и при необходимости автоматически создаёт USDC ATA автора на блокчейне (спонсируется SolArch).
   - Статус витрины меняется на `published`.
   - Архив появляется в публичном каталоге.
6. **Аналитика автора**:
   - Открыть `Dashboard` -> `Analytics`.
   - Отображаются корректные цифры просмотров, скачиваний, конверсий и разбивки выручки в USDC за выбранный период (7d, 30d, all).

---

## 6. Чеклист готовности к сдаче (Definition of Done)

- [ ] `npm run api:test` — все unit-тесты бэкенда проходят без ошибок.
- [ ] `npm run test:e2e --workspace apps/api` — все e2e-тесты проходят.
- [ ] `npm run api:build` — сборка бэкенда завершается успешно.
- [ ] `npm run web:test` — тесты фронтенда проходят с подключением к реальному бэкенду.
- [ ] Аутентификация: JWT Bearer токен корректно передаётся во всех запросах автора.
- [ ] Каталог: пагинация и сортировки работают согласованно.
- [ ] Загрузка ZIP: файлы загружаются, упаковываются в `.slr` без рассогласования контрактов.
- [ ] Неизменяемость цен: ни один эндпоинт не позволяет изменить стоимость архива после создания.
- [ ] Безопасность: секретные ключи, content keys и seed phrases никогда не попадают в логи или сетевые ответы.
