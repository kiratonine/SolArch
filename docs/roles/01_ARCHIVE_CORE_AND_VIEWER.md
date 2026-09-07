# SolArch — Роль 1: Archive Core & Desktop Viewer

**Ветка:** `feat/archive-core-viewer`  
**Ответственный:** участник 1  
**Главная зона ответственности:** собственный формат `.slr`, криптографическое ядро и desktop-приложение SolArch Viewer.

---

## 1. Цель роли

Сделать техническое ядро SolArch, которое доказывает главную ценность проекта:

> `.slr` можно свободно скачать и переслать, но защищённое содержимое открывается только после подтверждённой оплаты, получения Entitlement и активации device-bound license.

Эта ветка отвечает за всё, что относится к самому контейнеру и его открытию на компьютере.

---

## 2. Что находится в зоне ответственности

### 2.1 Формат `.slr`

Нужно спроектировать и реализовать версию формата `.slr` для hackathon/MVP.

Контейнер должен быть **self-contained** и включать:

- magic bytes и версию формата;
- публичный header;
- зашифрованный manifest;
- таблицу/индекс файлов и chunks;
- зашифрованные данные;
- integrity checks;
- signature block;
- данные, необходимые Viewer для обращения к backend по `archive_id`.

Контейнер не должен содержать content key в открытом виде.

### 2.2 `solarch-core`

Реализовать Rust-библиотеку, которая отвечает за:

- создание контейнера;
- чтение/парсинг `.slr`;
- сериализацию header/manifest;
- chunked encryption;
- chunked decryption;
- integrity verification;
- проверку подписи контейнера;
- безопасную нормализацию путей;
- защиту от path traversal;
- работу с supported file metadata.

Рекомендуемая зона:

```text
crates/
  solarch-core/
```

### 2.3 CLI для интеграции с backend

Нужен минимальный CLI/интерфейс, который сможет использовать Backend-разработчик после объединения веток.

Пример назначения:

```text
solarch create
solarch inspect
solarch verify
```

CLI должен позволять backend-сервису передать подготовленный source directory/files и получить готовый `.slr`.

Важно: CLI является техническим integration point, а не отдельным пользовательским продуктом.

### 2.4 SolArch Viewer

Создать desktop-приложение на **Tauri + React + TypeScript**, системное ядро — Rust.

Минимально для hackathon целевая ОС:

```text
Windows
```

Viewer должен:

- регистрировать расширение `.slr`;
- открывать `.slr` двойным кликом;
- читать public header;
- показывать locked/unlocked состояние;
- показывать название, автора, цену, policy и fingerprint;
- обращаться к Marketplace Backend за актуальным payment/license state;
- показывать QR для оплаты;
- отслеживать payment status;
- активировать device-bound license;
- сохранять локальную подписанную лицензию;
- открывать защищённые файлы только внутри Viewer;
- показывать buyer/license watermark;
- повторно открывать архив на активированном устройстве.

---

## 3. Device-bound license

При первом запуске Viewer должен:

```text
generate device_private_key + device_public_key
```

Требования:

- `device_private_key` не отправляется на сервер;
- private key хранится через защищённое хранилище ОС;
- backend получает только `device_public_key`;
- license привязывается к `archive_id + entitlement + device_public_key`;
- content key возвращается в виде, пригодном только для активированного устройства;
- Viewer валидирует server signature лицензии.

Для MVP `max_devices = 1` должен реально работать.

Ключевой демонстрационный сценарий:

```text
Device A:
оплата → активация → архив открывается

тот же .slr на Device B:
без разрешённой активации контент не открывается
```

---

## 4. Внутренние viewers

Обязательные типы для hackathon/MVP:

```text
PDF
PNG
JPG / JPEG
WebP
DOCX
XLSX
```

Не реализовывать:

```text
video
audio
PPTX
legacy .doc
legacy .xls
```

### Требование `view_only`

Защищённый файл не должен передаваться во внешнее приложение.

Нельзя использовать flow:

```text
DOCX → Microsoft Word
XLSX → Microsoft Excel
PDF → external PDF reader
```

Нужно рендерить содержимое внутри SolArch Viewer.

Минимальные возможности:

- PDF: просмотр страниц;
- images: просмотр и масштабирование;
- DOCX: read-only rendering;
- XLSX: read-only rendering таблиц и переключение листов.

Для hackathon допустим best-effort DRM. Не обещать абсолютную защиту от screen capture.

---

## 5. Watermark

Для защищённого просмотра добавить видимый watermark.

Минимально он может содержать:

```text
buyer_wallet_short
license_id_short
archive_id_short
```

Watermark должен быть заметен в demo минимум для:

- PDF;
- изображений;
- DOCX;
- XLSX.

---

## 6. Payment UI внутри Viewer

Эта роль **не реализует blockchain payment verification** — это зона Backend.

Viewer отвечает только за клиентскую часть:

1. открыть `.slr`;
2. получить у backend актуальные public/payment metadata;
3. запросить payment intent;
4. показать QR / payment state;
5. после оплаты получить подтверждение от backend;
6. запросить активацию device license;
7. получить signed license + wrapped/encrypted content key;
8. открыть содержимое.

Payment asset для MVP:

```text
USDC only
```

Viewer не должен считать локальные данные `.slr` абсолютным источником истины по payment state.

---

## 7. Интерфейс с Marketplace Backend

Backend должен предоставить контракт, который Viewer использует.

Минимально Viewer должен уметь вызвать операции уровня:

```text
GET current archive public metadata
POST create payment intent
GET/POST payment verification status
POST activate device
GET/POST license check
```

Точные endpoint names будут зафиксированы в общем `docs/API.md`.

До появления общего API-файла следует вынести network layer Viewer в отдельный adapter, чтобы endpoint paths можно было поменять без изменения UI/crypto logic.

---

## 8. Что не входит в эту ветку

Не делать:

- Marketplace web UI;
- creator dashboard;
- web authentication;
- public marketplace catalog;
- upload API;
- PostgreSQL schema Marketplace;
- server-side Solana verification;
- atomic 95/5 USDC split transaction;
- fee sponsorship;
- ATA creation;
- marketplace analytics;
- moderation/admin web layer;
- payouts/custodial balances;
- x402;
- mobile viewer;
- macOS/Linux support для hackathon, если это не останется свободным временем.

---

## 9. Предлагаемая структура

```text
apps/
  viewer/
    src/
    src-tauri/

crates/
  solarch-core/
  solarch-cli/
```

Пример модулей:

```text
solarch-core/
  format/
  crypto/
  manifest/
  chunks/
  integrity/
  signature/

viewer/
  open-archive/
  locked-state/
  payment/
  license/
  device/
  secure-store/
  file-viewers/
    pdf/
    image/
    docx/
    xlsx/
  watermark/
```

---

## 10. Тесты

### Unit

Покрыть:

- header parsing;
- manifest serialization;
- encryption/decryption;
- corrupted chunk;
- wrong signature;
- invalid magic/version;
- path normalization;
- license signature validation;
- device key handling helpers.

### Integration

Проверить:

- создать `.slr`;
- открыть `.slr`;
- прочитать public metadata;
- после mocked license расшифровать содержимое;
- invalid license не открывает контент;
- Device B отклоняется при `max_devices = 1`.

### Обязательный ручной demo-flow

```text
1. Получить готовый .slr.
2. Открыть в Viewer.
3. Увидеть Locked.
4. Пройти реальный backend payment flow.
5. Получить license.
6. Открыть PDF/DOCX/XLSX/image.
7. Увидеть watermark.
8. Закрыть Viewer.
9. Открыть снова — доступ сохраняется.
10. Проверить тот же .slr на другом устройстве — доступ отсутствует.
```

---

## 11. Definition of Done

Ветка готова к merge, когда:

- `.slr` реально создаётся;
- формат документирован внутри кода;
- content key не лежит в контейнере открыто;
- Viewer открывает `.slr`;
- device key создаётся и хранится локально;
- Viewer умеет пройти backend payment/license flow;
- поддержаны PDF/images/DOCX/XLSX;
- protected files не экспортируются через UI;
- watermark работает;
- Device A / Device B сценарий работает;
- есть unit и integration tests;
- отсутствуют secrets и приватные ключи в git;
- README ветки содержит команды запуска и тестирования.

---

## 12. Главный результат роли

К моменту объединения веток участник должен передать команде:

```text
working .slr format
+ solarch-core
+ packaging CLI/API
+ Windows SolArch Viewer
+ device-bound license client
+ internal protected viewers
+ watermark
```

Это главное технологическое ядро SolArch.
