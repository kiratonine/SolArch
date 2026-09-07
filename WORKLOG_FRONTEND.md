# SolArch — Worklog: Marketplace Frontend

**Роль:** участник 2 — Marketplace Frontend
**Ветка:** `feat/marketplace-frontend`
**Владение кодом:** `apps/web` (и только он)
**Source of truth по контрактам:** `docs/API.md`, `docs/INTEGRATION.md`, `docs/SPEC.md`, `docs/DECISIONS.md`

> Этот файл — память между сессиями. Изменяемое состояние живёт здесь,
> неизменное сжатое описание проекта — в `CLAUDE.md` (загружается автоматически).

---

## 0. Как пользоваться файлом

Начало сессии:
```text
1. CLAUDE.md загружается автоматически — там сжатый контекст проекта.
2. Прочитать этот файл: «Текущее состояние» + первый незакрытый этап.
3. docs/*.md читать точечно и только если этап того требует.
4. НЕ читать docs/context/* — устаревший черновик (старое имя продукта и расширение).
```

Конец сессии:
```text
1. Обновить статусы этапов.
2. Добавить запись в «Журнал сессий».
3. Записать новые решения / открытые вопросы.
```

---

## 1. Что мы строим

Публичный Marketplace + Creator Dashboard.

Два пользовательских пути:
```text
Visitor:  Discover → Inspect → Download .slr   (без регистрации)
Creator:  Login → Create Archive → Upload → Configure → Publish → Analytics
```

Frontend **не** отвечает за: payment verification, entitlement, device license, `.slr` crypto,
Solana-транзакции, приватные ключи, подсчёт метрик. Всё это — backend/viewer.
Оплата происходит внутри Viewer, не в браузере.

Ключевые продуктовые константы (менять нельзя):
```text
USDC only · platform fee 5% · creator 95% · price immutable after create
max_devices = 1 · network fees paid by SolArch · non-custodial payout wallet
public metrics = views / downloads / paid_unlocks
supported content = PDF, PNG, JPG/JPEG, WebP, DOCX, XLSX
```

### Стек

```text
React + TypeScript + Vite      SPA, без Next.js — SEO проекту не нужен
TanStack Query                 кеш, staleTime, инвалидация, retry
TanStack Router                типобезопасные роуты и search params (?sort=)
Tailwind CSS
shadcn/ui на Base UI           Base UI — дефолт shadcn с релиза 2026-07
MSW                            мок backend на уровне сети; те же хендлеры в тестах
zod                            схемы DTO = контракт + рантайм-проверка ответов
Структура                      apps/web как npm workspace (INTEGRATION.md §2)
```

Одобрены к использованию, но ещё не подключены (ставим по месту применения):
`react-hook-form` + `zod` резолвер — на S7 (форма создания архива);
`zustand` — только если появится клиентское состояние, которое не покрывает TanStack Query.

Проверено по актуальной документации: `npx shadcn@latest init -t vite` даёт шаблон Vite;
CLI v4 поддерживает флаг `--base` для выбора примитивов, Base UI идёт по умолчанию.
Точные команды фиксируем на S0 после реального запуска CLI.

---

## 2. Дорожная карта (этапы ≈ сессии)

Статусы: `todo` / `in-progress` / `done`

| # | Этап | Статус | Комментарий |
|---|------|--------|-------------|
| S0 | Скелет `apps/web` | **done** | Vite 8, React 19, TS 6, Tailwind v4, shadcn/Base UI, TanStack Query+Router, MSW, Vitest, oxlint |
| S1 | Typed API client + mock-слой (`lib/api/*`) по `docs/API.md` | **done** | zod-схемы как контракт, MSW с состоянием, 35 тестов |
| S2 | Дизайн-язык: тема, layout, базовые компоненты, i18n | **done** | Тема «запечатано на виду», en/ru, тёмная тема, 61 тест |
| S3 | Public: Landing / Catalog + сортировки + состояния | todo | Состояния готовы на S2; здесь сортировки, поиск и ссылка на архив |
| S4 | Public: Archive Page + file listing + metrics + CTA Download `.slr` | todo | Гость без логина |
| S5 | Creator auth (wallet challenge/verify) + guard роутов + сессия | todo | Приватные ключи не трогаем; SPA-guard, не middleware |
| S6 | Creator Dashboard: My Archives | todo | статусы, цена, метрики, revenue |
| S7 | Create Archive: форма + экономика 95/5 + immutable price warning + payout wallet | todo | Валидация Solana-адреса |
| S8 | Upload UX: ZIP/файлы, progress, processing, ready/failed | todo | Никакой крипты в браузере |
| S9 | Publish / Unpublish + preview публичной карточки | todo | |
| S10 | Analytics: периоды 7d/30d/all, конверсии, revenue | todo | Цифры только с backend |
| S11 | Тесты: unit/component + integration на mock API | todo | Список в `docs/TESTING.md` §5 |
| S12 | Интеграция с реальным backend + E2E (12 шагов из роли §14) | todo | Зависит от ветки backend |
| S13 | README, команды запуска, проверка отсутствия секретов | todo | Definition of Done |

---

## 3. Карта страниц

Клиентский роутинг (SPA), не файловый:

```text
/                         Landing + каталог (+ ?sort=)
/archives/:slug           Публичная страница архива
/download                 Скачать SolArch Viewer
/login                    Creator auth (wallet signature)
/dashboard                My Archives
/dashboard/new            Create Archive (метаданные + цена + payout wallet + policy)
/dashboard/:id            Archive Details: upload, статусы, publish/unpublish, public link
/dashboard/:id/analytics  Creator analytics
```

Сортировки каталога (значения передаём в backend как есть):
```text
popular_week | popular_month | most_downloaded | price_asc | price_desc
```

---

## 4. Контракты, от которых зависим

Эндпоинты, которые использует фронт (из `docs/API.md`):

```text
POST /v1/auth/wallet/challenge
POST /v1/auth/wallet/verify
GET  /v1/me
POST /v1/auth/logout

POST  /v1/archives
GET   /v1/archives/:archiveId
PATCH /v1/archives/:archiveId
POST  /v1/archives/:archiveId/publish
POST  /v1/archives/:archiveId/unpublish
GET   /v1/archives/:archiveId/download
GET   /v1/archives/:archiveId/analytics?period=7d|30d|all

POST /v1/uploads/init
PUT  <upload transport>
POST /v1/uploads/:uploadId/complete
POST /v1/uploads/:uploadId/cancel

GET /v1/marketplace/archives?sort=&search=&category=&page=
GET /v1/marketplace/archives/:slug
GET /v1/marketplace/archives/:slug/files
GET /v1/marketplace/archives/:slug/download
```

Общие статусы (нельзя выдумывать свои строки):
```text
technical:   draft | uploading | processing | ready | failed
marketplace: draft | published | unpublished | blocked
```

Деньги: decimal string (`"10.00"`), не float. Превью 95/5 можно считать до create,
после create показываем `economics` из ответа backend.

Публичный file listing — только эти поля:
```text
display_path · display_name · extension · mime_type · size_bytes
```

---

## 5. Текущее состояние

```text
Remote:      https://github.com/kiratonine/SolArch — main и feat/marketplace-frontend запушены
apps/web:    скелет + API-слой + моки + дизайн-язык и i18n; сборка, линт и тесты зелёные
Backend:     недоступен → работаем на MSW
Этап:        S0, S1, S2 done → следующий S3
```

Проверено на S2: `tsc -b`, `oxlint`, `vitest` (61/61), `vite build` — всё зелёное.
Каталог снят в браузере в состояниях «скелет» и «данные», в светлой и тёмной теме,
на 1280px и 390px, на обоих языках; в консоли ноль ошибок.

Организационный вопрос (открыт): по `INTEGRATION.md` §12 первым шагом идёт
«merge common docs and monorepo skeleton» — надо договориться с командой,
что `main` становится общей базой, от которой ответвляются две другие ветки.
Иначе три ветки разойдутся на разных версиях документации и корневого конфига.

---

## 6. Принятые решения (frontend-local)

| # | Решение | Дата | Причина |
|---|---------|------|---------|
| F1 | React + Vite SPA вместо Next.js | 2026-09-07 | SEO не требуется, SSR — оверкил; бэкенд отдельный на NestJS |
| F2 | TanStack Query как слой данных | 2026-09-07 | Кеш, staleTime, инвалидация, ретраи из коробки |
| F3 | Tailwind CSS | 2026-09-07 | Скорость + совместимость с shadcn |
| F4 | shadcn/ui на примитивах Base UI | 2026-09-07 | Base UI качественнее Radix и с 2026-07 — дефолт shadcn |
| F5 | Тему меняем заменой токенов/шаблона shadcn | 2026-09-07 | Не переписывать компоненты при смене визуала |
| F6 | `docs/context/*` объявлен устаревшим | 2026-09-07 | Старое имя продукта, старое расширение, старая бизнес-логика |
| F7 | TanStack Router | 2026-09-07 | Один вендор с Query; типобезопасные search params — сортировка каталога живёт в URL |
| F8 | MSW для мока backend | 2026-09-07 | Клиент сразу пишется как боевой; на S12 моки просто выключаются; хендлеры переиспользуются в тестах и E2E |
| F9 | `apps/web` как npm workspace | 2026-09-07 | `INTEGRATION.md` §2 закрепляет `apps/web` за нашей веткой; готово к слиянию трёх веток |
| F10 | DTO в snake_case, как на проводе | 2026-09-07 | Файл сверяется с `docs/API.md` построчно; нет тихих ошибок маппинга при интеграции |
| F11 | zod-схемы как источник типов и рантайм-проверки ответов | 2026-09-07 | Бэкенда нет; расхождение с контрактом падает на границе сети с внятным сообщением, а не как `undefined` в компоненте |
| F12 | Расчёт денег на `bigint` в base units | 2026-09-07 | `PAYMENTS.md` §5 запрещает float; комиссия вниз, автору остаток — `creator + platform === price` всегда |
| F13 | Мок с состоянием в памяти, а не статика | 2026-09-07 | Иначе невозможно проверить переходы draft → uploading → processing → ready → published |
| F14 | oxlint вместо ESLint | 2026-09-07 | Дефолт `create-vite@9`; быстрее и меньше конфигурации |
| F15 | i18n на своём типизированном словаре, без библиотеки | 2026-09-07 | `ru` объявлен как `typeof en` — забытый ключ падает на `tsc`, а не всплывает пустотой в UI; плюрализация и форматы через `Intl`; ноль новых зависимостей |
| F16 | Английский по умолчанию, русский по `navigator` | 2026-09-07 | Оплата в USDC, аудитория международная; явный выбор хранится в localStorage и важнее языка браузера |
| F17 | Дизайн-язык «запечатано на виду»; янтарь только за деньги | 2026-09-07 | Один акцент с одним смыслом читается как система. Два токена: `--seal` для заливок, `--seal-ink` для текста (контраст AA) |
| F18 | Unbounded (заголовки) + Golos Text (интерфейс) + IBM Plex Mono (машинные строки) | 2026-09-07 | Archivo отпал — в нём нет кириллицы. Выбранные три семейства несут и латиницу, и кириллицу: `en` и `ru` живут в одной типографике без подмен |
| F19 | Ни одной тени; глубина — разница бумага/поверхность плюс волосяные линии | 2026-09-07 | Одинаковые карточки с одинаковой мягкой тенью — самый заметный признак шаблонной вёрстки |
| F20 | Тема применяется скриптом в `index.html` до первой отрисовки | 2026-09-07 | Иначе тёмная тема моргает белым на каждой загрузке. Ключ намеренно продублирован в `lib/theme.ts` — менять в двух местах |
| F21 | Одна мера ширины 54rem на шапку, контент и подвал | 2026-09-07 | Общая левая и правая кромка. Более широкая мера появится, когда её реально потребует кабинет автора (S6), а не «про запас» |

> Решения, затрагивающие общий контракт, сюда не пишем — они идут в `docs/DECISIONS.md`
> после согласования с командой (`docs/INTEGRATION.md` §14).

---

## 7. Открытые вопросы к команде

Статус `open` — ждём ответа; отвечает разработчик соответствующей ветки.

| # | Вопрос | Кому | Статус |
|---|--------|------|--------|
| Q1 | Формат сессии после `/v1/auth/wallet/verify` — httpOnly cookie или Bearer-токен? В `API.md` не указано. Для SPA это принципиально | backend | open |
| Q2 | Транспорт загрузки файлов: signed URL в object storage или proxy через API? | backend | open |
| Q3 | Как загружается cover архива — отдельный эндпоинт или тот же upload flow? | backend | open |
| Q4 | Пагинация каталога: `page` или `cursor`? Форма ответа (`items` + `next`?) | backend | open |
| Q5 | Есть ли публичный агрегат метрик всего маркетплейса для Landing (роль §3.1)? | backend | open |
| Q6 | Откуда фронт берёт ссылку на дистрибутив Viewer (`Download SolArch Viewer`)? | viewer/backend | open |
| Q7 | CORS и домены: фронт и API на разных origin? Влияет на cookie-сессию (SameSite) | backend | open |
| Q8 | Нет эндпоинта списка архивов автора, хотя раздел My Archives обязателен (роль §6.1). Предполагаем `GET /v1/archives` | backend | open |
| Q9 | Правило округления комиссии: `PAYMENTS.md` §5 требует «детерминированное и покрытое тестами», но направление не задано. Мы отсекаем комиссию вниз, автору — остаток. Нужно совпадение с backend до копейки | backend | open |

Как эти вопросы закрыты в коде до ответов: каждое допущение помечено комментарием
`ДОПУЩЕНИЕ (открытый вопрос QN)` и вынесено в одно место, чтобы правка была точечной.

```text
Q1  lib/api/config.ts     API_CREDENTIALS = 'include' (cookie-сессия)
Q2  lib/api/uploads.ts    поддержаны оба транспорта: signed URL и через API
Q4  lib/api/types.ts      paginatedSchema: items/page/per_page/total/has_more
Q8  lib/api/archives.ts   listMyArchives → GET /v1/archives
Q9  lib/money.ts          комиссия floor, автору остаток
```

---

## 8. Журнал сессий

### Сессия 1 — 2026-09-07
- Изучена актуальная документация (`docs/*.md`, `docs/roles/*`).
- Зафиксирована зона ответственности и дорожная карта S0–S13.
- Зафиксирован стек: React+Vite / TanStack Query / Tailwind / shadcn на Base UI (F1–F5).
- `docs/context/*` помечен как устаревший (F6) — больше не читаем.
- Создан `CLAUDE.md` — автозагружаемый сжатый контекст проекта.
- Выбраны роутер, стратегия моков и структура репозитория (F7–F9).
- Найден remote `github.com/kiratonine/SolArch` — пустой, `docs/` туда ещё не залиты.

### Сессия 2 — 2026-09-07 · S0 выполнен

Сделано:
- `git init`, ветка `main` с общей базой (`docs/`, корневой npm workspace, `.gitignore`, README),
  от неё отведена `feat/marketplace-frontend`.
- Создан `apps/web`: Vite 8, React 19, TypeScript 6.
- TanStack Router с файловыми роутами (`src/routes/`), TanStack Query с общим клиентом.
- Tailwind v4 + shadcn/ui на Base UI, пресет `nova` (Lucide + Geist).
- MSW: `handlers.ts` общий, `browser.ts` для dev, `node.ts` для тестов; service worker в `public/`.
- Vitest + Testing Library, незамоканный запрос в тестах падает намеренно.
- oxlint настроен, предупреждений нет.
- Проверено: build, test, lint зелёные; страница рендерится без ошибок в консоли.

Отклонения от плана и почему:
- **oxlint вместо ESLint** — `create-vite@9` перешёл на него по умолчанию; переписывать
  на ESLint не стали, ради скорости и меньшей конфигурации.
- **Убран `baseUrl` из tsconfig** — TypeScript 6 объявил его устаревшим (`TS5101`);
  алиас `@/*` работает через `paths` без него.
- **Пресет темы `nova`** взят как дефолтный. Меняется заменой токенов в `src/index.css`.

Не сделано:
- В GitHub ничего не запушено — ждём согласования с командой по общей базе `main`.

**Следующий шаг:** S1 — typed API client в `lib/api/` и наполнение MSW-хендлеров
по `docs/API.md`. От ответов на Q1–Q7 этап не блокируется: спорные места закрываем
адаптерами, но Q1 (формат сессии) стоит выяснить до S5.

### Сессия 2 (продолжение) — S1 выполнен

Запушено в GitHub: `main` и `feat/marketplace-frontend`.

Сделано:
- `lib/money.ts` — расчёты USDC на `bigint`, превью split 95/5, валидация цены.
- `lib/api/` — `config`, `errors`, `http`, `types`, `query-keys`, `auth`, `marketplace`,
  `archives`, `uploads`, `analytics`, `index`. Все запросы идут через одну функцию `apiRequest`.
- zod-схемы описывают все ответы; типы выводятся через `z.infer`, дублирования нет.
  Несоответствие ответа контракту поднимает `ContractError` прямо на границе сети.
- Загрузка файлов на `XMLHttpRequest` — только он даёт прогресс отправки (роль §9).
- MSW: 5 модулей хендлеров + база в памяти с 6 архивами-фикстурами.
  Реально работают сортировки, скрытие черновиков, логин, create, publish/unpublish,
  переход `processing → ready`, запрет смены цены.
- Тесты: 35 штук. Покрыты деньги, публичный каталог, приватность полей,
  сортировки, auth, неизменяемость цены, публикация, аналитика, проверка контракта.

Проверено: `tsc -b`, `oxlint`, `vitest` (35/35), `vite build` — всё зелёное.
Каталог отрисован в браузере из мока, в консоли ноль ошибок.

Новые открытые вопросы: Q8 (нет эндпоинта списка архивов автора),
Q9 (направление округления комиссии).

**Следующий шаг:** S2 — дизайн-язык: тема, сетка, шапка/подвал, базовые компоненты
(карточка архива, блок метрик, price breakdown, состояния loading/empty/error).

### Сессия 3 — 2026-09-07 · S2 выполнен

По ходу этапа заказчик добавил требование: интерфейс должен быть на двух языках.
Мультиязычность вошла в S2, потому что иначе вся копия S3–S13 писалась бы дважды.

Дизайн-язык — «запечатано на виду»:
- Холодная синеватая бумага и чернильный тёмно-синий вместо белого и чёрного.
- Один акцент — латунный янтарь — закреплён за деньгами: цена, доля автора, «Sol»
  в логотипе. Два токена: `--seal` (заливки) и `--seal-ink` (текст, контраст AA).
- Статусы живут в отдельной приглушённой шкале `--state-*` и с акцентом не конкурируют.
- Шрифты: Unbounded (только h1 и логотип), Golos Text (интерфейс), IBM Plex Mono
  (только машинные строки). Archivo пришлось отклонить — в нём нет кириллицы.
- Теней нет ни одной; глубина — разница бумага/поверхность плюс волосяные линии.
- Главный носитель языка — корешок карточки: левая полоса, которая цветом несёт
  статус архива, и «манифест» внизу: файлы, вес, открытия.

Сделано:
- `src/index.css` — полностью переписанные токены, светлая и тёмная тема.
- `lib/i18n/` — `locale`, `plural`, `format`, `dict.en`, `dict.ru`, `context`,
  `provider`, `use-i18n`. `ru` типизирован как `typeof en`.
- `lib/theme.ts` + `ThemeSwitch` + скрипт предзагрузки темы в `index.html`.
- `components/brand/` — `SealMark`, `Wordmark`.
- `components/layout/` — `Container`, `SiteHeader`, `SiteFooter`, `PageHeader`,
  `LanguageSwitch`, `ThemeSwitch`.
- `components/archive/` — `ArchiveCard`, `StatusBadge`, `MetricGrid`, `PriceTag`,
  `PriceBreakdown`, `tone.ts`.
- `components/state/` — `EmptyState`, `ErrorState`, `ArchiveCardSkeleton`.
- Добавлены примитивы shadcn: `badge`, `skeleton`.
- Каталог на главной перерисован на новом языке, со всеми тремя состояниями.
- Тесты: 61 (было 35). Покрыты словари, плюрализация, форматы, выбор локали и темы,
  карточка, статусы, разбивка цены, состояния, переключение языка.

Отклонения от плана и почему:
- **Мультиязычность не была в плане S2** — требование пришло в середине этапа.
- **Archivo → Unbounded + Golos Text** — Archivo не покрывает кириллицу.
- **Ширина 54rem вместо 70rem** — при 70rem шапка уезжала шире содержимого;
  общая кромка важнее запаса ширины, которым пока никто не пользуется.
- **Добавлен переключатель темы** — тёмная палитра без него была бы мёртвым кодом.

Не сделано осознанно:
- `ArchiveCard` пока презентационная, без ссылки и без наведения: роут
  `/archives/$slug` появится на S4, а выдумывать заглушку-страницу не стали.
- В шапке нет `Sign in` и `Get the Viewer` — за ними нет ни роутов (S5),
  ни ответа на Q6. Мёртвых ссылок в шапке нет.

**Следующий шаг:** S3 — каталог: сортировки в search params, поиск, ссылка на
страницу архива и наведение на корешок карточки. Компоненты и состояния готовы.
