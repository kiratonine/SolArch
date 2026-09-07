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
Структура                      apps/web как npm workspace (INTEGRATION.md §2)
```

Проверено по актуальной документации: `npx shadcn@latest init -t vite` даёт шаблон Vite;
CLI v4 поддерживает флаг `--base` для выбора примитивов, Base UI идёт по умолчанию.
Точные команды фиксируем на S0 после реального запуска CLI.

---

## 2. Дорожная карта (этапы ≈ сессии)

Статусы: `todo` / `in-progress` / `done`

| # | Этап | Статус | Комментарий |
|---|------|--------|-------------|
| S0 | Скелет `apps/web` | todo | Vite+React+TS, Tailwind, shadcn/Base UI, TanStack Query, роутер, тесты, линт |
| S1 | Typed API client + mock-слой (`lib/api/*`) по `docs/API.md` | todo | Без mock-слоя дальше двигаться нельзя |
| S2 | Дизайн-язык: тема shadcn, layout, базовые компоненты | todo | Тему потом можно заменить готовым шаблоном с shadcn |
| S3 | Public: Landing / Catalog + сортировки + состояния | todo | loading/empty/error |
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
Remote:      https://github.com/kiratonine/SolArch  — ПУСТОЙ, ни одной ветки
Локально:    docs/ + CLAUDE.md + WORKLOG_FRONTEND.md. Кода нет, git не инициализирован.
apps/web:    не создан
Backend:     недоступен → работаем на mock-слое (MSW)
Этап:        S0 не начат
```

Открытый организационный вопрос: `docs/` ещё не в GitHub. По `INTEGRATION.md` §12 первым
шагом идёт «merge common docs and monorepo skeleton» — нужно договориться, кто заливает
общие документы в `main`, чтобы три ветки не разошлись на разных версиях документации.

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
- Кода не написано.
- **Следующий шаг:** S0 — инициализация git, ветка `feat/marketplace-frontend`,
  скелет `apps/web` (Vite+React+TS, Tailwind, shadcn/Base UI, TanStack Query+Router, MSW, Vitest, ESLint).
