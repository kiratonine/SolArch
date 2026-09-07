# @solarch/web — Marketplace Frontend

Публичный Marketplace и Creator Dashboard SolArch.

Ветка: `feat/marketplace-frontend`. Контракты: [`docs/API.md`](../../docs/API.md).

## Стек

| Слой | Выбор |
|---|---|
| Сборка | Vite 8 |
| UI | React 19 + TypeScript 6 |
| Роутинг | TanStack Router (file-based, `src/routes/`) |
| Данные | TanStack Query |
| Стили | Tailwind CSS v4 |
| Компоненты | shadcn/ui на примитивах Base UI (пресет `nova`) |
| Мок API | MSW |
| Тесты | Vitest + Testing Library |
| Линт | oxlint |

## Команды

```bash
npm run dev            # dev-сервер, http://localhost:5173
npm run build          # tsc -b && vite build
npm run preview
npm run test           # vitest run
npm run test:watch
npm run test:coverage
npm run lint           # oxlint
npm run typecheck
```

Из корня монорепозитория: `npm run web`, `npm run web:build`, `npm run web:test`, `npm run web:lint`.

## Переменные окружения

Скопировать `.env.example` в `.env`.

```bash
VITE_API_BASE_URL=http://localhost:3000   # базовый URL backend, префикс путей /v1
VITE_ENABLE_MSW=true                      # мок backend; выключить, когда появится реальный API
```

`.env` в git не попадает. Секретов во фронтенде нет и быть не должно.

## Структура

```text
src/
  routes/          файловые роуты TanStack Router
  components/ui/   компоненты shadcn (Base UI)
  lib/             query-client, утилиты; на S1 сюда ляжет typed API client (lib/api/)
  mocks/           MSW: handlers.ts (общие), browser.ts (dev), node.ts (тесты)
  test/            setup.ts и общие тестовые хелперы
  routeTree.gen.ts генерируется плагином роутера, руками не править
```

## Правила

- Никаких `fetch()` в компонентах — только типизированный клиент из `lib/api/`.
- Приватные ключи, seed-фразы и content key фронтенд не обрабатывает никогда.
- Цена архива неизменяема после создания; UI обязан это явно показывать.
- Метрики и popularity фронтенд не вычисляет — отображает ответ backend.
- Публичный список файлов содержит только `display_path`, `display_name`, `extension`,
  `mime_type`, `size_bytes`.
