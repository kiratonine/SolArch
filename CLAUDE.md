# SolArch — контекст проекта (frontend)

> Этот файл загружается автоматически в каждой сессии. Он — сжатая замена чтению всей `docs/`.
> Держим его коротким. Изменяемое состояние — в `WORKLOG_FRONTEND.md`.

---

## Что читать в начале сессии

```text
1. Этот файл (загружен автоматически).
2. WORKLOG_FRONTEND.md — текущее состояние и следующий шаг.
3. Точечно docs/*.md — ТОЛЬКО если работа касается контракта, который не описан ниже.
```

## ⛔ Что НЕ читать

```text
docs/context/*.md
```

Три файла в `docs/context/` — **устаревший черновик**: старое название продукта
(SolarArchive), старое расширение контейнера, устаревшая бизнес-логика маркетплейса.
Не использовать как источник истины и не цитировать.

**Актуальны:** `docs/SPEC.md`, `docs/README.md`, `docs/API.md`, `docs/ARCHITECTURE.md`,
`docs/DATA_MODEL.md`, `docs/PAYMENTS.md`, `docs/SECURITY.md`, `docs/INTEGRATION.md`,
`docs/TESTING.md`, `docs/DECISIONS.md`, `docs/roles/*`.

---

## Проект в одном абзаце

SolArch продаёт защищённый цифровой контент. Контейнер `.slr` скачивается свободно и
пересылается как обычный файл, но открывается только в десктопном SolArch Viewer после
оплаты в USDC, серверной верификации платежа и активации лицензии, привязанной к устройству.

Три ветки / три разработчика:

```text
feat/archive-core-viewer     Rust + Tauri: формат .slr, крипта, десктопный Viewer
feat/marketplace-backend     NestJS + PostgreSQL + Solana: API, платежи, лицензии
feat/marketplace-frontend    React: Marketplace + Creator Dashboard   ← НАША ВЕТКА
```

## Наша зона ответственности

Владеем **только** `apps/web`.

Делаем: публичный каталог, страницу архива, гостевое скачивание `.slr`, auth UI автора,
Creator Dashboard, создание архива, upload UX, publish/unpublish, отображение аналитики.

Не делаем (это чужие ветки): верификацию платежей, entitlement, device license, крипту `.slr`,
построение Solana-транзакций, приватные ключи, ATA, подсчёт метрик, схему БД, object storage.

Оплата происходит **внутри Viewer**, а не в браузере. На сайте только кнопка «скачать».

## Неизменяемые продуктовые константы

```text
Container = .slr
Payment asset = USDC only
Platform fee = 5% (platform_fee_bps = 500) · Creator = 95%
Price immutable after archive create
Network fees paid by SolArch · buyer pays archive price only
Non-custodial: автор указывает свой Solana wallet, seed/private key фронт не трогает
max_devices = 1
Public metrics = views · downloads · paid_unlocks
Supported content = PDF · PNG · JPG/JPEG · WebP · DOCX · XLSX  (без video/audio)
```

Гость видит каталог, страницу архива, публичный список файлов, метрики и скачивает `.slr`
**без регистрации и без оплаты**.

## Общие статусы (свои строки не выдумывать)

```text
technical:   draft | uploading | processing | ready | failed
marketplace: draft | published | unpublished | blocked
payment:     created | pending | confirmed | expired | failed
license:     active | expired | revoked
```

## Правила контракта

- API prefix `/v1`, JSON, source of truth — `docs/API.md`.
- Деньги — decimal string (`"10.00"`), никогда не float.
- Превью 95/5 считаем до create; после create показываем `economics` из ответа backend.
- Метрики фронт не вычисляет, popularity не считает — передаёт `sort` и рисует ответ.
- Публичный file listing — только `display_path`, `display_name`, `extension`, `mime_type`, `size_bytes`.
- Никаких `fetch()` в компонентах — только typed client в `lib/api/`.
- Менять общий контракт молча нельзя: сначала конфликт → согласование → правка `docs/` → код.

## Стек (решено)

```text
React + TypeScript + Vite      (не Next.js — SEO не нужен, SPA достаточно)
TanStack Query                 (кеш, staleTime, инвалидация)
TanStack Router                (типобезопасные роуты и search params)
Tailwind CSS
shadcn/ui на Base UI           (Base UI — дефолт shadcn с 2026-07)
MSW                            (мок backend на уровне сети, пока API нет)
apps/web как npm workspace
```

Remote: `https://github.com/kiratonine/SolArch`

Тему shadcn меняем заменой темы/токенов, компоненты под это не переписываем.

## Стиль работы

Работа разбита на этапы S0–S13 (`WORKLOG_FRONTEND.md`). Один этап ≈ одна сессия.
В конце этапа обновляем worklog: статус, журнал сессии, решения, открытые вопросы.
