# SolArch — Роль 2: Marketplace Frontend

**Ветка:** `feat/marketplace-frontend`  
**Ответственный:** участник 2  
**Главная зона ответственности:** публичный Marketplace и Creator Dashboard на Next.js.

---

## 1. Цель роли

Создать весь web-интерфейс SolArch Marketplace:

```text
Visitor:
Discover → Inspect → Download .slr

Creator:
Login → Create Archive → Upload → Configure → Publish → Analytics
```

Frontend не отвечает за доверенные payment/license проверки. Все критические операции выполняются через Marketplace Backend.

---

## 2. Технологическая зона

Рекомендуемая основа:

```text
Next.js
TypeScript
App Router
```

UI должен использовать единый визуальный язык SolArch и быть готов к интеграции с backend через typed API client.

---

## 3. Публичный Marketplace

### 3.1 Landing / Catalog

Главная страница должна одновременно:

- кратко объяснять SolArch;
- показывать каталог опубликованных архивов;
- позволять открыть карточку архива;
- показывать основные marketplace metrics;
- иметь CTA для автора;
- иметь ссылку Download SolArch Viewer.

Посетителю регистрация не требуется.

### 3.2 Карточка архива

Показывать минимум:

- cover;
- title;
- short description;
- author/public creator name;
- price в USDC;
- file count;
- total size;
- public metrics:
  - views;
  - downloads;
  - paid unlocks;
- ссылку на public archive page.

### 3.3 Public Archive Page

Страница конкретного архива должна показывать:

- название;
- полное описание;
- cover;
- цену;
- валюта: USDC;
- creator;
- общий размер;
- количество файлов;
- max devices;
- export allowed / not allowed;
- watermark notice;
- public file listing;
- views;
- downloads;
- paid unlocks;
- CTA `Download .slr`;
- CTA/ссылку `Download SolArch Viewer`;
- объяснение, что скачивание бесплатно, а unlock оплачивается внутри Viewer.

Гость может скачать `.slr` без регистрации и без предварительной оплаты.

---

## 4. Discovery

Обязательные сортировки:

```text
Popular this week
Popular this month
Most downloaded
Price ascending
Price descending
```

Frontend не вычисляет popularity самостоятельно — он передаёт параметр backend и отображает результат.

Если backend предоставляет search/category/tags, frontend подключает их как дополнительный UX, но они не должны блокировать основной A-to-Z flow.

---

## 5. Creator Authentication

Автор должен иметь возможность войти через утверждённый общий auth flow.

Frontend отвечает за:

- login UI;
- session state;
- protected creator routes;
- logout;
- обработку expired/unauthorized state.

Private keys никогда не хранятся и не обрабатываются web frontend.

---

## 6. Creator Dashboard

Минимальные разделы:

```text
My Archives
Create Archive
Archive Details
Publish / Unpublish
Analytics
Public Link
Download .slr
```

### 6.1 My Archives

Для каждого архива показывать:

- title;
- technical status;
- marketplace status;
- price;
- views;
- downloads;
- paid unlocks;
- gross sales;
- creator revenue.

### 6.2 Create Archive

Creator должен иметь возможность:

- загрузить ZIP или отдельные файлы;
- ввести title;
- short description;
- full description;
- cover;
- указать payout Solana wallet;
- указать цену в USDC;
- увидеть platform fee 5%;
- увидеть расчёт creator share 95%;
- настроить разрешённые license fields из общего spec;
- увидеть public file listing перед публикацией.

Цена после создания архива **неизменяемая**.

Frontend должен явно предупреждать:

```text
Archive price cannot be changed after creation.
To use another price, create a new archive.
```

### 6.3 Payout Wallet UX

Creator указывает обычный Solana wallet address.

Frontend:

- валидирует базовый формат адреса;
- отправляет address backend;
- показывает статус подготовки USDC payout account;
- не создаёт custodial wallet;
- не просит private key;
- не хранит seed phrase.

ATA создаёт backend/SolArch автоматически при необходимости.

---

## 7. Экран экономики архива

При цене, например, 10 USDC:

```text
Archive price:       10.00 USDC
Creator receives:     9.50 USDC
SolArch fee (5%):     0.50 USDC
Network fees:         covered by SolArch
```

Frontend должен объяснять, что:

- покупатель платит только цену архива;
- автор получает 95%;
- SolArch получает 5%;
- blockchain network fees оплачивает SolArch;
- никаких custodial balances/withdrawals нет.

---

## 8. Analytics

Обязательная публичная статистика архива:

```text
views
downloads
paid unlocks
```

Эти три показателя видят все посетители Marketplace.

Автор видит расширенную аналитику:

```text
views
downloads
confirmed payments / paid unlocks
view → download conversion
download → purchase conversion
gross revenue
creator revenue
platform fees
```

Если backend поддерживает периоды:

```text
7 days
30 days
all time
```

Frontend должен позволить переключать период.

---

## 9. Upload UX

Frontend должен:

- поддерживать выбор ZIP или отдельных файлов;
- показывать upload progress;
- показывать processing state;
- показывать failed state и понятную ошибку;
- не считать upload завершённым до подтверждения backend;
- после generation показывать готовность `.slr`.

Не выполнять криптографическую упаковку в browser.

---

## 10. Public File Listing

До публикации creator должен увидеть, какие данные станут публичными.

Marketplace показывает только public listing:

```text
display_path
display_name
file_extension
mime_type
size
```

Не показывать:

- encrypted manifest;
- chunk map;
- hashes, которые не предназначены для public use;
- storage keys;
- private URLs;
- encryption metadata;
- license secrets.

---

## 11. API Integration Layer

Frontend должен иметь отдельный typed client layer.

Пример:

```text
lib/api/
  auth.ts
  archives.ts
  marketplace.ts
  uploads.ts
  analytics.ts
```

Нельзя разбрасывать `fetch()` по компонентам.

До появления общего `docs/API.md` использовать интерфейсы/adapters, которые легко заменить.

---

## 12. Состояния, которые обязательно обработать

Marketplace:

```text
loading
empty
error
published
unpublished / 404
download unavailable
```

Create Archive:

```text
draft
uploading
processing
ready
failed
published
unpublished
blocked
```

Analytics:

```text
loading
empty
error
success
```

---

## 13. Что не входит в эту ветку

Не делать:

- `.slr` binary format;
- Rust crypto;
- desktop Viewer;
- device secure storage;
- Solana transaction building на доверенной стороне;
- payment verification;
- Entitlement Service;
- Device License backend;
- ATA creation;
- fee sponsorship;
- PostgreSQL schema;
- object storage implementation;
- analytics aggregation logic;
- admin backend;
- payouts;
- custodial balance;
- ratings/reviews;
- referrals/promocodes;
- video/audio marketplace features;
- mobile app.

---

## 14. Тесты

### Unit / Component

Покрыть минимум:

- archive card;
- price breakdown;
- immutable price warning;
- public metrics;
- creator archive states;
- analytics calculations/display;
- form validation;
- payout wallet field validation helpers.

### Integration

Проверить с mocked API:

- marketplace catalog;
- archive details;
- guest download flow;
- creator login/session;
- create archive form;
- upload states;
- publish/unpublish;
- analytics page.

### E2E

К моменту merge нужен реальный flow с backend:

```text
1. Creator входит.
2. Создаёт archive.
3. Загружает files/ZIP.
4. Указывает payout wallet.
5. Устанавливает immutable USDC price.
6. Дожидается ready.
7. Публикует.
8. Guest видит archive.
9. Guest видит public listing и metrics.
10. Guest скачивает .slr без login.
11. После реальной покупки paid unlocks увеличивается.
12. Creator analytics показывает обновлённые цифры.
```

---

## 15. Definition of Done

Ветка готова к merge, когда:

- public Marketplace работает;
- guest не обязан регистрироваться;
- archive page работает;
- public metrics видны;
- `.slr` скачивается через backend;
- Creator Dashboard работает;
- create archive flow работает;
- immutable price отражён в UI;
- payout wallet задаётся creator;
- 95/5 economics отображается;
- upload/processing/publish states реализованы;
- analytics реализована;
- API client изолирован;
- unit/integration/e2e tests проходят;
- README содержит команды запуска;
- secrets отсутствуют в git.

---

## 16. Главный результат роли

К моменту объединения веток участник должен передать:

```text
public Marketplace
+ archive product page
+ guest .slr download UX
+ creator authentication UI
+ Create Archive
+ publish/unpublish
+ public metrics
+ creator analytics
```

Frontend должен быть полностью готов подключиться к реальному backend и Viewer flow.
