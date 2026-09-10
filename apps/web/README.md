# @solarch/web — Marketplace Frontend

Публичный Marketplace и Creator Dashboard SolArch.

Ветка: `feat/marketplace-frontend`. Владеем только `apps/web`.
Контракты: [`docs/API.md`](../../docs/API.md), [`docs/INTEGRATION.md`](../../docs/INTEGRATION.md).

Посетитель забирает `.slr` бесплатно и без регистрации; платит он позже и не здесь —
внутри десктопного SolArch Viewer. Поэтому в браузере нет и не будет ни оплаты,
ни приватных ключей, ни содержимого архива.

## Быстрый старт

Требуется Node.js 20+.

```bash
npm install                # из корня монорепозитория (npm workspaces)
cp apps/web/.env.example apps/web/.env
npm run web                # http://localhost:5173
```

Backend не нужен: в dev-режиме поднимается MSW и отвечает вместо него.

## Команды

Из корня монорепозитория:

```bash
npm run web            # dev-сервер
npm run web:build      # tsc -b && vite build
npm run web:test       # vitest run
npm run web:lint       # oxlint
```

Из `apps/web` доступно то же плюс остальное:

```bash
npm run dev
npm run build
npm run preview        # раздать собранное из dist/
npm run typecheck      # tsc -b --noEmit
npm run test
npm run test:watch
npm run test:coverage
npm run lint
```

Полная проверка перед коммитом — четыре команды, все обязаны быть чистыми:

```bash
npm run typecheck && npm run lint && npm run test && npm run build
```

> **Осторожно при слиянии веток.** Корневой `package.json` нам не принадлежит,
> и в ветке `feat/archive-core-viewer` он уже заменён: пакетным менеджером там
> объявлен pnpm, `package-lock.json` удалён, а `pnpm-workspace.yaml` перечисляет
> только `apps/viewer`. После наивного merge команды `npm run web*` из корня
> исчезнут, а `apps/web` не попадёт в workspace. Команды внутри `apps/web`
> переживут это в любом случае. Вопрос вынесен команде (Q20).

## Переменные окружения

Секретов во фронтенде нет и быть не может: всё, что попадает в сборку, публично.
`.env` в git не отслеживается, в репозитории лежит только `.env.example`.

```bash
VITE_API_BASE_URL=http://localhost:3000   # базовый URL backend; пути идут под префиксом /v1
VITE_ENABLE_MSW=true                      # мок backend
```

`VITE_ENABLE_MSW` действует только в dev-сборке: в production MSW не подключается
никогда, независимо от значения. Чтобы поработать против настоящего backend,
достаточно выставить `false` и указать его адрес в `VITE_API_BASE_URL`.

## Мок backend и вход автора

`src/mocks/` — MSW с состоянием: архивы, сессия, загрузки и метрики живут в памяти
и меняются в ответ на запросы, а не отдают заранее записанные ответы. Те же
обработчики используются в тестах (`src/mocks/node.ts`), поэтому тест и живой
экран видят один и тот же backend.

Войти в кабинет без расширения кошелька позволяет демо-кошелёк: он объявляет себя
через тот же реестр Wallet Standard, что и настоящие, и подписывает сообщение
локально. Вход в два шага — «Demo wallet (dev)», затем подпись показанного текста.

Демо-кошелёк подключается динамически и только под `import.meta.env.DEV` —
в production-сборке его нет.

## Страницы

```text
/                         Landing + каталог: сортировки, поиск, постраничность в адресе
/archives/:slug           Публичная страница архива: опись, метрики, условия, скачивание
/how-it-works             Как это работает
/login                    Вход автора по подписи кошелька
/dashboard                Мои архивы
/dashboard/new            Создание архива: метаданные, цена, payout wallet, политика
/dashboard/:id            Загрузка файлов, статусы сборки, публикация
/dashboard/:id/analytics  Аналитика: периоды 7d/30d/all, воронка, выручка
```

`/download` (дистрибутив Viewer) из карты страниц ещё не сделана: неизвестно,
откуда берётся сам дистрибутив (Q6).

## Структура

```text
src/
  routes/            файловые роуты TanStack Router
  routeTree.gen.ts   генерируется плагином роутера — руками не править
  components/
    ui/              shadcn на примитивах Base UI
    layout/          шапка, подвал, меню, контейнер, заголовки
    archive/         карточки, опись, цена, статусы, шкала тона
    catalog/ auth/ upload/ publish/ analytics/ form/ state/ brand/ product/
  lib/
    api/             типизированный клиент: схемы zod, запросы, ключи кеша, ошибки
    i18n/            словари en/ru, форматирование чисел, дат и байтов
    wallet/          Wallet Standard: реестр, подключение, подпись
    theme.ts money.ts files.ts …
  mocks/             MSW: handlers/*, состояние в db.ts, демо-кошелёк
  test/              renderApp и общие хелперы; сценарные тесты
```

## Правила

- Никаких `fetch()` в компонентах — только типизированный клиент из `lib/api/`.
- Ответы backend проходят через схемы zod: контракт проверяется в рантайме,
  а не подразумевается.
- Тексты в компонентах не пишем — только через `useI18n()`. Локали `en` и `ru`
  обязаны совпадать по ключам: `ru` типизирован как `typeof en`, пропуск падает
  на `tsc`.
- Приватные ключи, seed-фразы и content key фронтенд не обрабатывает никогда.
- Цена архива неизменяема после создания; UI обязан это явно показывать.
- Метрики и popularity фронтенд не вычисляет — отображает ответ backend.
- Публичный список файлов содержит только `display_path`, `display_name`,
  `extension`, `mime_type`, `size_bytes`.
- Общий контракт молча не меняем: сначала вопрос команде, потом правка `docs/`,
  потом код. Каждое допущение помечено в коде комментарием
  `ДОПУЩЕНИЕ (открытый вопрос QN)`.

## Чего здесь нет

Это не пробелы, а границы роли (`docs/INTEGRATION.md` §2): верификация платежей,
entitlement, device license, криптография `.slr`, построение Solana-транзакций,
подсчёт метрик, схема БД, object storage. Всё это — ветки backend и viewer.

Состояние работ, принятые решения и открытые вопросы — в
[`WORKLOG_FRONTEND.md`](../../WORKLOG_FRONTEND.md).
