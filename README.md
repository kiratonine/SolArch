# SolArch

Платформа для создания, распространения и защищённого открытия цифрового контента.

Контейнер `.slr` можно свободно скачать и переслать, но открыть его содержимое можно только
в SolArch Viewer — после оплаты в USDC, серверной верификации платежа и активации лицензии,
привязанной к устройству.

```text
Discover → Inspect → Download .slr → Open in Viewer → Pay USDC
→ Verify on backend → Entitlement → Device License → Protected View
```

## Документация

Общие договорённости команды — в [`docs/`](docs/). Порядок чтения описан в
[`docs/README.md`](docs/README.md).

> ⚠️ `docs/context/` — устаревший черновик (прежнее название продукта, прежнее расширение
> контейнера, устаревшая бизнес-логика). Источником истины не является.

## Структура монорепозитория

```text
apps/web        Marketplace Frontend   — React + Vite
apps/api        Marketplace Backend    — NestJS
apps/viewer     Desktop Viewer         — Tauri
crates/         solarch-core, solarch-cli — Rust: формат .slr и криптография
docs/           Общая документация
```

Зоны ответственности веток зафиксированы в [`docs/INTEGRATION.md`](docs/INTEGRATION.md) §2.

```text
feat/archive-core-viewer     crates/*, apps/viewer
feat/marketplace-frontend    apps/web
feat/marketplace-backend     apps/api, миграции БД
```

## Запуск

Требуется Node.js 20+.

```bash
npm install
npm run web          # dev-сервер фронтенда на http://localhost:5173
npm run web:build
npm run web:test
npm run web:lint
```
