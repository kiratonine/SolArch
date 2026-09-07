# SolarArchive — Addendum 01: анализ аналогов, дифференциация и дополнения к ТЗ

**Формат документа:** Markdown  
**Тип документа:** дополнение к основному ТЗ `SolarArchive_Project_Blueprint.md`  
**Версия:** 0.1  
**Дата:** 2026-05-25  
**Язык:** русский  

---

## 0. Назначение этого файла

Этот файл является **дополнением** к основному документу `SolarArchive_Project_Blueprint.md`.

В этом документе **не повторяется базовое описание проекта**, архитектура `.solararchive`, базовая схема лицензирования, формат контейнера и базовый MVP-flow. Все эти разделы остаются в первом Markdown-файле.

Этот Addendum добавляет только новую информацию после анализа аналогичных решений в экосистеме Solana и Web3-paywall:

- обзор близких продуктов и подходов;
- выводы о том, что уже существует на рынке;
- чем SolarArchive должен отличаться;
- какие требования стоит добавить к продукту;
- какие новые архитектурные слои стоит заложить;
- какие product/engineering-решения следует принять перед разработкой;
- дополнительные roadmap-пункты;
- ссылки на источники для разработчиков и product-команды.

---

## 1. Главный вывод после анализа рынка

Прямого массового аналога формата:

```text
.solararchive + desktop viewer + Solana/USDC payment + device-bound license + internal DRM-viewer
```

обнаружено не было.

Однако уже существуют решения, которые закрывают отдельные части идеи:

```text
зашифрованные файлы + оплата через Solana
paywall для URL
token-gated контент
USDC/SOL digital product marketplace
x402 / HTTP 402 pay-per-access
клиентское шифрование файлов через Solana wallet
```

Следовательно, SolarArchive не должен позиционироваться как просто:

> «файлы за оплату в Solana»

Потому что такие подходы уже существуют.

Более сильное позиционирование:

> **SolarArchive — Solana-native encrypted content container with device-bound licensing and protected desktop viewing.**

По-русски:

> **SolarArchive — защищенный контейнер для продажи цифровых файлов через Solana/USDC с привязкой лицензии к устройству и просмотром внутри контролируемого приложения.**

---

## 2. Обзор найденных аналогов и близких решений

### 2.1 Shelby Token-Gated Files on Solana

**Источник:**  
https://docs.shelby.xyz/sdks/solana-kit/guides/token-gated-solana

**Что делает:**

Shelby описывает tutorial/SDK-сценарий для token-gated file marketplace на Solana:

```text
Seller uploads encrypted files
Seller registers files on Solana with a price
Buyer pays SOL
Buyer proves purchase
Buyer decrypts and downloads files
```

В документации указано, что:

- продавцы загружают зашифрованные файлы;
- файлы регистрируются на Solana с ценой;
- покупатель платит SOL;
- после покупки он может расшифровать и скачать файлы;
- используется threshold cryptography;
- decryption key release зависит от доказательства покупки.

**Насколько близко к SolarArchive:** очень близко по платежной и криптографической логике.

**Чего нет относительно SolarArchive:**

- нет собственного desktop-расширения `.solararchive` как потребительского контейнера;
- нет отдельного desktop viewer;
- нет device-bound лицензирования в стиле SolarArchive Viewer;
- нет явного внутреннего DRM-просмотра без raw export;
- продукт больше похож на infrastructure/tutorial для marketplace, а не на «файл, который открывается отдельным приложением».

**Вывод для SolarArchive:**

Shelby подтверждает, что паттерн `pay → prove payment → decrypt` технически и продуктово валиден. Но SolarArchive должен отличаться не оплатой, а именно:

```text
desktop-first защищенным контейнером
привязкой лицензии к устройству
встроенным viewer
anti-resale / watermark / no-export режимами
```

---

### 2.2 SOL-Route

**Источник:**  
https://medium.com/@aditya311001rj/sol-route-a-fully-encrypted-pay-to-unlock-file-marketplace-built-on-solana-storacha-mcp-11c9cfc7f287

**Что делает:**

SOL-Route описан как fully encrypted pay-to-unlock file marketplace на Solana + Storacha.

Высокоуровневая логика:

```text
Seller encrypts file
Seller uploads encrypted content to storage
Buyer creates order
Buyer pays on Solana
Server verifies payment
Server sends CID/key or access data
Buyer decrypts locally
```

**Насколько близко к SolarArchive:** очень близко по идее «платный зашифрованный файл».

**Отличия:**

- это marketplace/file-delivery flow;
- отсутствует собственный архивный desktop-format уровня `.solararchive`;
- нет отдельного фокуса на device-bound license;
- нет полноценного desktop DRM-viewer;
- нет сценария «пользователь получил файл-контейнер и открыл его как отдельный тип файла».

**Вывод для SolarArchive:**

SOL-Route показывает, что web3-аудитория уже понимает модель:

```text
зашифрованный файл → on-chain payment → key delivery
```

SolarArchive должен добавить следующий слой:

```text
key delivery → device activation → controlled local viewing
```

---

### 2.3 SubFlow

**Источник:**  
https://github.com/Emengkeng/SubFlow

**Что делает:**

SubFlow — Solana-native marketplace для цифровых продуктов:

- курсы;
- ebooks;
- templates;
- software;
- оплата USDC на Solana;
- secure/time-limited download links после оплаты;
- zero chargebacks.

**Насколько близко к SolarArchive:** средне близко.

**Отличия:**

- это marketplace цифровых товаров;
- основной output — download link, а не защищенный контейнер;
- нет собственного desktop-формата;
- нет внутреннего viewer;
- нет device-bound DRM-модели.

**Вывод для SolarArchive:**

SubFlow конкурирует не с технологией `.solararchive`, а с бизнес-сценарием:

```text
продажа цифрового товара за USDC на Solana
```

Поэтому SolarArchive не должен соревноваться только как «маркетплейс файлов». Нужно делать упор на:

```text
защищенный контейнер
контроль доступа после покупки
ограничение экспорта
лицензирование устройств
```

---

### 2.4 PayWen

**Источники:**  
https://github.com/PayWen/app  
https://www.paywen.dev/docs

**Что делает:**

PayWen — open-source crypto paywall service:

```text
creator pastes URL
sets price
shares paywall link
visitor pays
creator receives USDC on Solana
```

**Насколько близко к SolarArchive:** средне близко.

**Отличия:**

- PayWen защищает URL, а не локальный файл-контейнер;
- не является архивным форматом;
- не решает проблему повторного распространения файла;
- нет desktop viewer;
- нет device-bound license;
- нет внутреннего просмотра с запретом raw export.

**Вывод для SolarArchive:**

PayWen закрывает простой use-case:

```text
paywall для ссылки
```

SolarArchive должен закрывать более сложный use-case:

```text
платный защищенный файл, который может распространяться сам по себе, но открывается только при наличии лицензии
```

---

### 2.5 x402 / HTTP 402 Payment Required

**Источники:**  
https://docs.cdp.coinbase.com/x402/welcome  
https://github.com/solana-foundation/solana-com/blob/main/apps/docs/content/guides/getstarted/intro-to-x402.mdx  
https://docs.rs/x402-sdk-solana-rust

**Что делает:**

x402 — платежный протокол, который возвращает `HTTP 402 Payment Required`, если клиент пытается получить защищенный ресурс без оплаты.

Типичный flow:

```text
Client requests protected resource
Server returns 402 Payment Required
Client pays
Client retries request with payment proof
Server verifies payment
Server returns resource
```

x402 особенно подходит для:

- API monetization;
- платных endpoint-ов;
- pay-per-file download;
- AI-agent payments;
- premium content per request.

**Насколько близко к SolarArchive:** средне близко, но архитектурно важно.

**Отличия:**

- x402 — не формат файла;
- x402 не решает локальный DRM-viewer;
- x402 не решает device-bound license само по себе;
- x402 может быть использован как дополнительный payment/unlock protocol.

**Вывод для SolarArchive:**

В SolarArchive стоит заложить совместимость с x402 как **дополнительный payment adapter**, но не делать x402 основой всей системы.

Рекомендуемая архитектурная добавка:

```text
Payment Adapter Layer:
- Solana Pay Adapter
- Direct Solana Transfer Adapter
- USDC SPL Transfer Adapter
- x402 Adapter
- Future Smart Contract Adapter
```

---

### 2.6 Access Protocol

**Источник:**  
https://docs.accessprotocol.co/

**Что делает:**

Access Protocol — Web3-native monetization/paywall system для premium content. Пользователь получает доступ к контенту через stake/lock ACS token у конкретного creator/pool.

**Насколько близко к SolarArchive:** дальний аналог.

**Отличия:**

- модель stake/subscription, а не one-time purchase файла;
- нет `.solararchive` контейнера;
- нет локального desktop viewer;
- нет device-bound license;
- нет фокуса на protected file distribution.

**Вывод для SolarArchive:**

Access Protocol — не прямой конкурент. Но он показывает, что Web3-аудитория уже принимает идею:

```text
token-gated premium access
```

SolarArchive может позже добавить subscription-mode, но для MVP лучше оставить one-time purchase.

---

### 2.7 Vaultana

**Источники:**  
https://vaultana.io/whitepaper/  
https://vaultana.io/roadmap/

**Что делает:**

Vaultana описывает клиентское шифрование файлов через WebCrypto и Solana wallets, а также собственный `.vault` secure file format.

В roadmap упоминаются:

- `.vault` secure file format;
- wallet-based key derivation;
- password mode;
- client-side AES-256-GCM;
- recipient-based encryption;
- token-gated Pro mode.

**Насколько близко к SolarArchive:** технологически близко по идее «свой защищенный файловый формат», но бизнес-сценарий другой.

**Отличия:**

- Vaultana больше про privacy/self-encryption;
- SolarArchive должен быть про monetized protected content;
- у Vaultana нет явного pay-to-open archive + device-bound DRM-viewer сценария;
- `.vault` не равен `.solararchive` по бизнес-логике.

**Вывод для SolarArchive:**

Vaultana показывает, что идея собственного secure file format в Solana-экосистеме уже появляется. SolarArchive должен отличаться коммерческим и DRM-слоем:

```text
creator sells file → buyer pays → device activates → content opens in protected viewer
```

---

### 2.8 Solana Pay Specification

**Источник:**  
https://docs.solanapay.com/spec

**Что делает:**

Solana Pay — стандарт для кодирования transaction requests в URL. Он подходит для:

- QR-code payments;
- wallet payment links;
- merchant flows;
- платежей в SOL и SPL-токенах;
- передачи параметров вроде recipient, amount, reference, label, message, memo.

**Насколько важно для SolarArchive:** высоко.

**Вывод:**

Solana Pay должен быть базовым способом оплаты в MVP, потому что он проще для пользователя:

```text
SolarArchive Viewer показывает QR/payment link
wallet подтверждает платеж
backend проверяет reference/signature
license server выдает право доступа
```

---

## 3. Матрица отличий SolarArchive от найденных решений

| Возможность | Shelby | SOL-Route | SubFlow | PayWen | x402 | Vaultana | SolarArchive target |
|---|---:|---:|---:|---:|---:|---:|---:|
| Оплата в Solana/SOL/USDC | Да | Да | Да | Да | Да/зависит от сети | Частично | Да |
| Зашифрованные файлы | Да | Да | Не основной фокус | Нет/зависит от URL | Нет, это payment layer | Да | Да |
| Key delivery после оплаты | Да | Да | Косвенно | Нет | Косвенно | Нет/другая модель | Да |
| Собственное файловое расширение | Нет | Нет | Нет | Нет | Нет | `.vault` | `.solararchive` |
| Desktop-приложение для открытия | Нет/не основной фокус | Нет | Нет | Нет | Нет | Не основной фокус | Да |
| Device-bound license | Не основной фокус | Не основной фокус | Нет | Нет | Нет | Нет | Да |
| Внутренний viewer без raw export | Нет | Нет | Нет | Нет | Нет | Нет/не основной фокус | Да |
| Watermark по buyer/license | Не основной фокус | Не основной фокус | Нет | Нет | Нет | Нет | Да |
| Creator-controlled license rules | Частично | Частично | Частично | Частично | Через сервер | Нет | Да |
| Может распространяться как самостоятельный файл | Нет/не основной сценарий | Нет/не основной сценарий | Нет | Нет | Нет | Да, но без paywall-модели | Да |
| DRM-подход после покупки | Нет/слабый | Нет/слабый | Нет | Нет | Нет | Нет | Да, частичный |

---

## 4. Обновленная продуктовая стратегия

### 4.1 Что не стоит заявлять

Не рекомендуется позиционировать SolarArchive как:

```text
первый проект, где платишь SOL за файл
первый Solana paywall
первый encrypted file marketplace
аналог WinRAR на Solana
```

Эти формулировки слабые или могут быть спорными.

### 4.2 Что стоит заявлять

Более точное позиционирование:

```text
SolarArchive is a device-bound encrypted content container for Solana-native digital sales.
```

Или:

```text
SolarArchive lets creators sell protected file containers via SOL/USDC, with buyer-specific licensing and controlled desktop viewing.
```

По-русски:

```text
SolarArchive позволяет авторам продавать защищенные файловые контейнеры через SOL/USDC, выдавая покупателю лицензию, привязанную к устройству, и открывая контент внутри контролируемого viewer-приложения.
```

### 4.3 Главный продуктовый фокус

SolarArchive должен конкурировать не как обычный marketplace, а как:

```text
protected content delivery format
```

Ключевая идея:

```text
файл можно переслать, но нельзя открыть без лицензии;
после оплаты контент открывается не как обычная папка, а внутри защищенного viewer;
доступ привязывается к buyer wallet + device public key + transaction proof.
```

---

## 5. Новые требования к продукту

Эти требования следует добавить к основному ТЗ как новые PRD/NFR-пункты.

### PRD-ADD-01: режимы распространения архива

SolarArchive должен поддерживать два режима распространения:

#### Режим A — Link-first

Автор получает ссылку:

```text
https://solararchive.app/a/{archive_id}
```

Покупатель открывает страницу, платит и получает доступ через web/desktop flow.

#### Режим B — File-first

Автор получает файл:

```text
content.solararchive
```

Покупатель получает этот файл любым способом:

- Telegram;
- email;
- Discord;
- Google Drive;
- сайт автора;
- флешка;
- локальная передача.

При открытии файла SolarArchive Viewer сам показывает paywall.

**Почему это важно:**

Большинство аналогов работают как link/file marketplace. Отличие SolarArchive — возможность распространять защищенный файл как самостоятельный объект.

---

### PRD-ADD-02: режимы доступа после оплаты

В интерфейсе автора необходимо добавить настройку `access_mode`:

```text
view_only
view_and_export
export_after_purchase
streaming_only
```

Описание:

| Режим | Описание |
|---|---|
| `view_only` | Файлы доступны только внутри SolarArchive Viewer. Экспорт отключен. |
| `view_and_export` | Файлы можно просматривать и экспортировать. |
| `export_after_purchase` | После оплаты пользователь получает обычный ZIP/папку. DRM не применяется. |
| `streaming_only` | Подходит для видео/аудио. Контент расшифровывается чанками и не сохраняется целиком. |

Для MVP рекомендуется реализовать:

```text
view_only
export_after_purchase
```

Остальные режимы можно отложить.

---

### PRD-ADD-03: creator-controlled license rules

Автор должен иметь возможность задавать правила лицензии:

```json
{
  "max_devices": 1,
  "allow_export": false,
  "allow_print": false,
  "allow_copy_text": false,
  "offline_grace_period_hours": 72,
  "license_duration_days": null,
  "watermark_enabled": true,
  "visible_watermark": true,
  "invisible_watermark": true
}
```

Минимум для MVP:

```text
max_devices
allow_export
watermark_enabled
```

---

### PRD-ADD-04: обязательный buyer-specific watermark для view-only режима

Если архив создан в режиме `view_only`, SolarArchive Viewer должен добавлять watermark поверх просматриваемого контента.

Watermark может включать:

```text
buyer_wallet_short
license_id_short
transaction_signature_short
timestamp
archive_id_short
```

Пример видимого watermark:

```text
Licensed to: 7x4A...Pq91 / License: lic_9X2B / 2026-05-25
```

Для PDF/изображений watermark можно накладывать визуально.

Для видео можно накладывать динамический watermark в разных местах экрана.

Для текстовых файлов можно показывать watermark в header/footer viewer-а.

Цель watermark не в абсолютной защите, а в снижении мотивации сливать контент.

---

### PRD-ADD-05: предупреждение покупателя до оплаты

Перед оплатой пользователь должен видеть прозрачное предупреждение:

```text
Этот контент защищен SolarArchive.
После оплаты лицензия будет привязана к вашему кошельку и этому устройству.
Количество устройств: N.
Экспорт файлов: разрешен/запрещен.
Офлайн-доступ: X часов/дней.
Криптовалютные платежи необратимы.
```

Это снижает риск споров и chargeback-like претензий.

---

### PRD-ADD-06: публичная проверка архива перед оплатой

Viewer должен показывать покупателю до оплаты:

```text
archive name
creator wallet
price
currency
total file count
total encrypted size
allowed actions
license rules
hash/fingerprint архива
platform verification status
```

Но содержимое файлов не должно раскрываться до оплаты, кроме явно разрешенного preview.

---

### PRD-ADD-07: optional preview внутри контейнера

Автор может добавить preview-файлы:

```text
cover image
README
short video preview
sample PDF pages
file list without sensitive names
```

Preview должен быть незашифрованным или зашифрованным отдельным preview-key, доступным без оплаты.

Это повысит конверсию, особенно для курсов, шаблонов, отчетов и медиа.

---

## 6. Новые архитектурные дополнения

### 6.1 Payment Adapter Layer

В основной архитектуре нужно добавить отдельный слой платежных адаптеров.

```text
Payment Adapter Layer
├── Solana Pay Adapter
├── Direct SOL Transfer Adapter
├── SPL USDC Transfer Adapter
├── x402 Adapter
└── Future Smart Contract Adapter
```

Назначение:

- не привязывать продукт только к одному способу оплаты;
- упростить добавление x402;
- упростить будущий переход на smart contract;
- иметь единый интерфейс проверки платежей.

Рекомендуемый интерфейс:

```ts
interface PaymentAdapter {
  createPaymentIntent(input: CreatePaymentIntentInput): Promise<PaymentIntent>;
  verifyPayment(input: VerifyPaymentInput): Promise<PaymentVerificationResult>;
  getSupportedCurrencies(): SupportedCurrency[];
}
```

---

### 6.2 Entitlement Service

Нужно отделить факт платежа от факта права доступа.

```text
Payment ≠ License
Payment → Entitlement → Device License
```

Определения:

- **Payment** — транзакция в Solana/USDC/x402.
- **Entitlement** — право покупателя получить доступ к конкретному archive_id.
- **Device License** — активация entitlement на конкретном устройстве.

Новая модель:

```text
User pays
↓
Payment Verifier confirms transaction
↓
Entitlement Service creates entitlement
↓
License Service binds entitlement to device_public_key
↓
Viewer receives encrypted content key
```

Это важно, потому что один платеж может давать:

- одну лицензию на одно устройство;
- несколько лицензий на несколько устройств;
- временный доступ;
- доступ к нескольким архивам;
- подписочный доступ в будущем.

---

### 6.3 Policy Engine

Для правил автора нужен отдельный policy layer.

```text
Policy Engine
- max_devices
- allow_export
- allow_print
- allow_copy_text
- watermark_enabled
- offline_grace_period
- license_duration
- region restrictions, если когда-нибудь понадобится
```

Viewer не должен сам придумывать правила. Он должен получать подписанную policy от сервера и проверять подпись.

Пример policy:

```json
{
  "archive_id": "arc_01HZ...",
  "policy_version": 3,
  "access_mode": "view_only",
  "max_devices": 1,
  "allow_export": false,
  "allow_print": false,
  "allow_copy_text": false,
  "watermark": {
    "enabled": true,
    "visible": true,
    "invisible": true
  },
  "offline_grace_period_hours": 72,
  "server_signature": "ed25519_signature"
}
```

---

### 6.4 Competitor Monitoring / Market Intelligence

Это не обязательная часть MVP, но полезная operational-задача.

Создать внутренний документ или таблицу:

```text
competitors.md
```

С полями:

```text
project_name
url
category
chain
payment_asset
file_encryption
key_delivery
device_binding
desktop_viewer
drm_features
last_checked_at
notes
```

Цель — раз в месяц обновлять, что делают конкуренты.

---

## 7. Новые таблицы / поля в базе данных

Эти таблицы добавляются как дополнение к основной схеме БД.

### 7.1 `payment_adapters`

```sql
CREATE TABLE payment_adapters (
  id UUID PRIMARY KEY,
  code TEXT UNIQUE NOT NULL,
  name TEXT NOT NULL,
  status TEXT NOT NULL,
  supported_currencies JSONB NOT NULL,
  config JSONB NOT NULL DEFAULT '{}',
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
```

Примеры `code`:

```text
solana_pay
solana_direct_transfer
spl_usdc
x402
smart_contract_v1
```

---

### 7.2 `entitlements`

```sql
CREATE TABLE entitlements (
  id UUID PRIMARY KEY,
  archive_id UUID NOT NULL,
  buyer_wallet TEXT NOT NULL,
  payment_id UUID NOT NULL,
  status TEXT NOT NULL,
  max_devices INT NOT NULL DEFAULT 1,
  devices_activated INT NOT NULL DEFAULT 0,
  starts_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  expires_at TIMESTAMPTZ NULL,
  policy_snapshot JSONB NOT NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
```

Назначение:

```text
хранить право покупателя на доступ до привязки к конкретному устройству
```

---

### 7.3 `license_policies`

```sql
CREATE TABLE license_policies (
  id UUID PRIMARY KEY,
  archive_id UUID NOT NULL,
  version INT NOT NULL,
  access_mode TEXT NOT NULL,
  max_devices INT NOT NULL DEFAULT 1,
  allow_export BOOLEAN NOT NULL DEFAULT false,
  allow_print BOOLEAN NOT NULL DEFAULT false,
  allow_copy_text BOOLEAN NOT NULL DEFAULT false,
  watermark_enabled BOOLEAN NOT NULL DEFAULT true,
  visible_watermark BOOLEAN NOT NULL DEFAULT true,
  invisible_watermark BOOLEAN NOT NULL DEFAULT false,
  offline_grace_period_hours INT NOT NULL DEFAULT 72,
  license_duration_days INT NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
```

---

### 7.4 `competitor_watchlist`

Необязательная operational-таблица.

```sql
CREATE TABLE competitor_watchlist (
  id UUID PRIMARY KEY,
  name TEXT NOT NULL,
  url TEXT NOT NULL,
  category TEXT NOT NULL,
  chain TEXT NULL,
  has_file_encryption BOOLEAN NULL,
  has_payment_unlock BOOLEAN NULL,
  has_device_binding BOOLEAN NULL,
  has_desktop_viewer BOOLEAN NULL,
  has_drm_viewer BOOLEAN NULL,
  notes TEXT NULL,
  last_checked_at TIMESTAMPTZ NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
```

---

## 8. Новые API endpoints

### 8.1 Payment Intents

```http
POST /api/payment-intents
```

Создает намерение оплаты через выбранный payment adapter.

Request:

```json
{
  "archive_id": "arc_01HZ...",
  "buyer_wallet": "BUYER_SOLANA_WALLET",
  "payment_adapter": "solana_pay",
  "currency": "USDC",
  "device_public_key": "optional_at_this_stage"
}
```

Response:

```json
{
  "payment_intent_id": "pi_01HZ...",
  "adapter": "solana_pay",
  "amount": "10.00",
  "currency": "USDC",
  "recipient": "CREATOR_WALLET",
  "reference": "REFERENCE_PUBLIC_KEY",
  "payment_url": "solana:...",
  "expires_at": "2026-05-25T13:30:00Z"
}
```

---

### 8.2 Payment Verification

```http
POST /api/payment-intents/{payment_intent_id}/verify
```

Request:

```json
{
  "transaction_signature": "SOLANA_TX_SIGNATURE",
  "buyer_wallet": "BUYER_SOLANA_WALLET"
}
```

Response:

```json
{
  "verified": true,
  "payment_id": "pay_01HZ...",
  "entitlement_id": "ent_01HZ...",
  "next_step": "activate_device_license"
}
```

---

### 8.3 Device License Activation через Entitlement

```http
POST /api/entitlements/{entitlement_id}/activate-device
```

Request:

```json
{
  "device_public_key": "DEVICE_PUBLIC_KEY",
  "device_name": "User Windows Laptop",
  "viewer_version": "0.1.0"
}
```

Response:

```json
{
  "license_id": "lic_01HZ...",
  "encrypted_content_key": "base64...",
  "license_token": "signed_license_jwt_or_binary_token",
  "policy": {
    "access_mode": "view_only",
    "allow_export": false,
    "max_devices": 1,
    "watermark_enabled": true
  }
}
```

---

### 8.4 Archive Public Metadata

```http
GET /api/archives/{archive_id}/public-metadata
```

Возвращает только безопасную информацию до оплаты.

Response:

```json
{
  "archive_id": "arc_01HZ...",
  "title": "Premium Course Files",
  "creator_wallet": "CREATOR_WALLET",
  "price": "10.00",
  "currency": "USDC",
  "file_count": 42,
  "encrypted_size_bytes": 104857600,
  "access_mode": "view_only",
  "max_devices": 1,
  "allow_export": false,
  "preview_available": true,
  "archive_fingerprint": "sha256..."
}
```

---

## 9. Новые engineering decisions

### DEC-ADD-01: использовать термин `Entitlement`

В коде и документации нужно явно разделять:

```text
Payment
Entitlement
Device License
Content Key
```

Не использовать слово `license` для всего подряд.

Правильная модель:

```text
Payment proves money was sent.
Entitlement proves buyer has the right to access archive.
Device License proves this device is activated.
Content Key unlocks encrypted content.
```

---

### DEC-ADD-02: не делать marketplace основным MVP

Несмотря на то что аналоги часто являются marketplace, SolarArchive MVP лучше делать как:

```text
creator dashboard + file container generator + desktop viewer
```

Marketplace можно добавить позже.

Почему:

- marketplace увеличивает сложность модерации;
- появляется больше юридических рисков;
- нужна система discovery, рейтингов, жалоб, категорий;
- главная ценность SolarArchive не marketplace, а protected container.

---

### DEC-ADD-03: поддерживать x402 не в MVP, а как совместимый слой

x402 не нужен для первого MVP, но архитектура не должна его блокировать.

Решение:

```text
MVP: Solana Pay + direct verification
Post-MVP: x402 adapter for HTTP-protected resources and API/file endpoints
```

---

### DEC-ADD-04: использовать `view_only` как флагманскую функцию

Многие аналоги заканчивают процесс на:

```text
payment → download
```

SolarArchive должен продвигать другой сценарий:

```text
payment → device activation → protected view
```

Поэтому `view_only` режим важнее, чем обычный export.

---

### DEC-ADD-05: не обещать абсолютный DRM

Во всех материалах для разработчиков, авторов и покупателей должно быть указано:

```text
SolarArchive снижает риск несанкционированного распространения, но не может гарантировать 100% защиту после того, как контент показан на устройстве пользователя.
```

Это важное юридическое и репутационное ограничение.

---

## 10. Дополнительный roadmap

### Phase 0.5 — Market validation перед полной разработкой

Цель: проверить спрос до дорогостоящей разработки viewer/DRM.

Задачи:

- сделать landing page;
- описать `.solararchive` как концепт;
- показать mockup открытия файла и оплаты;
- провести 10–20 интервью с потенциальными авторами;
- проверить willingness-to-pay;
- собрать waitlist;
- выяснить, важнее ли авторам `view_only` или обычный paid download.

Deliverables:

```text
landing page
interactive Figma prototype
creator interview notes
updated PRD
```

---

### Phase 1.5 — Differentiation MVP

Добавить поверх базового MVP минимальные отличия от конкурентов:

```text
.solararchive file-first flow
device activation
view_only режим
visible watermark
public archive metadata before payment
```

Это важнее, чем ранний marketplace.

---

### Phase 2.5 — x402 compatibility

Добавить:

```text
x402 payment adapter
HTTP 402 unlock endpoint
paid API/resource access mode
```

Потенциальные use-cases:

- платный download endpoint;
- платный preview endpoint;
- paid content API;
- AI-agent access to encrypted datasets.

---

### Phase 3 — Creator platform / marketplace

Только после того, как protected container доказал ценность.

Добавить:

- profiles creators;
- public listings;
- search;
- reviews;
- reports/takedown;
- categories;
- revenue analytics;
- affiliate/referral system;
- creator verification.

---

### Phase 4 — SDK / Enterprise

Добавить:

```text
SolarArchive SDK
CLI tools
white-label viewer
enterprise license server
on-prem deployment
custom branding
```

Это может стать B2B-направлением.

---

## 11. Возможные бизнес-модели после анализа рынка

### 11.1 Platform fee

SolarArchive берет процент с платежей:

```text
2%–10% platform fee
```

Плюсы:

- понятно;
- растет вместе с volume;
- похоже на marketplace-модель.

Минусы:

- нужно технически удерживать fee;
- creator может захотеть direct payment без комиссии;
- нужен прозрачный механизм split payments.

---

### 11.2 Creator subscription

Автор платит за расширенные функции:

```text
Free: limited archives / file size
Pro: larger archives, watermark control, analytics
Business: custom branding, team access, priority support
```

Плюсы:

- не нужно забирать процент с каждой продажи;
- проще юридически;
- можно позволить direct-to-wallet payments.

Минусы:

- сложнее монетизировать маленьких авторов;
- нужна постоянная ценность Pro-функций.

---

### 11.3 Hybrid

Рекомендованный вариант:

```text
Free tier + platform fee
Pro subscription + lower fee
Enterprise/on-prem license
```

Пример:

```text
Free: 5% fee, базовый viewer
Pro: $19/month + 2% fee, watermark/analytics
Business: custom pricing, team features
Enterprise: self-hosted license server
```

---

## 12. Риски, выявленные после анализа аналогов

### Risk-ADD-01: продукт могут воспринимать как обычный paywall

Если позиционировать SolarArchive только как `pay to unlock file`, пользователи и инвесторы будут сравнивать его с Shelby, SOL-Route, PayWen, SubFlow и x402 wrappers.

Митигирование:

```text
делать акцент на .solararchive + desktop viewer + device-bound license + protected viewing
```

---

### Risk-ADD-02: DRM может создать friction

Чем сильнее защита, тем сложнее UX.

Покупатель может не захотеть устанавливать desktop app.

Митигирование:

- поддержать web preview;
- сделать installer максимально простым;
- дать авторам выбор: `view_only` или `export_after_purchase`;
- прозрачно объяснять правила до оплаты.

---

### Risk-ADD-03: open-source paywall-проекты быстрее копируют базовый flow

Простой flow:

```text
pay → verify → download
```

легко повторить.

Митигирование:

- инвестировать в viewer;
- watermark;
- device license;
- качественный creator UX;
- security reputation;
- формат `.solararchive`;
- signing/verification trust layer.

---

### Risk-ADD-04: хранение ключей и выдача лицензий становится главным trust point

Если сервер выдает ключи, он становится критической частью системы.

Митигирование:

- audit logging;
- server-side key isolation;
- KMS/HSM позже;
- signed license tokens;
- key rotation;
- минимизация доступа сотрудников к ключам;
- threat model document.

---

## 13. Новые acceptance criteria

### AC-ADD-01: отличие от простого paywall

MVP считается недостаточным, если он реализует только:

```text
pay → download file
```

MVP должен обязательно включать минимум:

```text
.solararchive container
SolarArchive Viewer
payment screen inside viewer
device activation
license verification
protected view mode или его минимальную демонстрацию
```

---

### AC-ADD-02: device-bound flow

При тестировании:

```text
1. Покупатель оплачивает archive на Device A.
2. Device A успешно открывает archive.
3. Файл .solararchive пересылается на Device B.
4. Device B не должен получить доступ без новой device activation.
5. Если max_devices = 1, Device B должен получить отказ.
```

---

### AC-ADD-03: no-export policy

Если `allow_export = false`, viewer не должен предоставлять стандартную кнопку:

```text
Export
Save as
Extract all
Open in external app
```

Для MVP допустимо, что защита является best-effort, но UI не должен сам выдавать raw files.

---

### AC-ADD-04: watermark visibility

Если `watermark_enabled = true`, viewer должен показывать видимый watermark минимум для:

```text
PDF preview
image preview
text preview
```

Видео watermark можно отложить на более поздний этап.

---

### AC-ADD-05: transparent buyer disclosure

До оплаты покупатель должен увидеть:

```text
цена
валюта
creator wallet
max devices
export allowed/not allowed
refund policy / irreversible payment notice
archive fingerprint
```

---

## 14. Дополнительные вопросы для команды перед разработкой

Перед началом реализации нужно принять решения:

1. Название расширения окончательно `.solararchive` или нужен более короткий вариант вроде `.solarc`?
2. Нужен ли web-viewer в MVP или только desktop-viewer?
3. Какие типы файлов viewer должен поддерживать в первой версии?
4. Разрешать ли авторам режим `export_after_purchase`, если он снижает DRM-ценность?
5. Сколько устройств по умолчанию: 1 или 2?
6. Нужно ли делать platform fee в MVP или оставить direct-to-creator payment?
7. Нужно ли хранить encrypted archive в облаке проекта, или `.solararchive` должен быть полностью self-contained?
8. Нужно ли делать публичный marketplace или только private share links?
9. Какой токен USDC использовать: только canonical/native USDC на Solana или разрешать другие SPL assets?
10. Как обрабатывать refund/disputes при необратимых on-chain payments?

---

## 15. Обновленный short pitch для команды

```text
SolarArchive is not another Solana file paywall.
It is a protected content container.

Competitors can lock links or sell downloads.
SolarArchive lets creators distribute a file that remains encrypted until a buyer pays, activates a device, and opens the content inside a controlled viewer.
```

Русская версия:

```text
SolarArchive — это не просто paywall для файлов на Solana.
Это защищенный контейнер для цифрового контента.

Другие решения продают ссылки или скачивания.
SolarArchive позволяет авторам распространять сам файл, который остается зашифрованным до оплаты, активации устройства и открытия внутри контролируемого viewer-приложения.
```

---

## 16. Источники для дальнейшего анализа

### Близкие решения

- Shelby Token-Gated Files on Solana  
  https://docs.shelby.xyz/sdks/solana-kit/guides/token-gated-solana

- SOL-Route article  
  https://medium.com/@aditya311001rj/sol-route-a-fully-encrypted-pay-to-unlock-file-marketplace-built-on-solana-storacha-mcp-11c9cfc7f287

- SubFlow GitHub  
  https://github.com/Emengkeng/SubFlow

- PayWen GitHub  
  https://github.com/PayWen/app

- PayWen docs  
  https://www.paywen.dev/docs

- Vaultana whitepaper  
  https://vaultana.io/whitepaper/

- Vaultana roadmap  
  https://vaultana.io/roadmap/

- Access Protocol docs  
  https://docs.accessprotocol.co/

### Платежные стандарты и интеграции

- Solana Pay Specification  
  https://docs.solanapay.com/spec

- Coinbase x402 documentation  
  https://docs.cdp.coinbase.com/x402/welcome

- Solana x402 guide  
  https://github.com/solana-foundation/solana-com/blob/main/apps/docs/content/guides/getstarted/intro-to-x402.mdx

- x402 Solana Rust SDK  
  https://docs.rs/x402-sdk-solana-rust

### Solana token/access infrastructure

- Solana Token Extensions  
  https://solana.com/solutions/token-extensions

- Solana Token ACL guide  
  https://solana.com/developers/guides/advanced/acl

---

## 17. Как использовать этот файл вместе с основным ТЗ

Разработчикам следует читать документы в таком порядке:

```text
1. SolarArchive_Project_Blueprint.md
2. SolarArchive_Addendum_01_Market_And_Differentiation.md
```

Первый файл отвечает на вопрос:

```text
Как устроен SolarArchive технически?
```

Этот файл отвечает на вопрос:

```text
Что нужно добавить после анализа рынка, чтобы SolarArchive не был просто очередным Solana-paywall?
```

---

## 18. Краткий список изменений, которые нужно перенести в основной backlog

```text
[ ] Добавить Entitlement Service между Payment и Device License
[ ] Добавить Payment Adapter Layer
[ ] Добавить будущую совместимость с x402
[ ] Добавить creator-controlled license policies
[ ] Добавить режимы access_mode
[ ] Добавить watermark как обязательный элемент view_only режима
[ ] Добавить public metadata screen before payment
[ ] Добавить preview mode
[ ] Добавить testing flow: Device A paid, Device B rejected
[ ] Не делать marketplace основным MVP
[ ] Позиционировать продукт как protected content container, а не просто paywall
```
