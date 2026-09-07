# SolArch — Product & MVP Specification

**Status:** shared team specification  
**Scope:** Solana hackathon MVP  
**Product:** SolArch  
**Container:** `.slr`

---

## 1. Product statement

SolArch — платформа для создания, распространения, продажи и защищённого открытия цифрового контента.

Главная идея:

> `.slr` можно свободно скачать и переслать. Сам файл не является покупкой. Покупка создаёт право доступа, а содержимое открывается в SolArch Viewer только после подтверждённой USDC-оплаты, Entitlement и device-bound license.

SolArch не позиционируется как обычный ZIP/RAR или простой paywall для ссылки.

Основная ценность:

```text
protected portable container
+ Solana payment proof
+ Entitlement
+ device-bound license
+ controlled desktop viewing
```

---

## 2. Пользовательские роли

### 2.1 Посетитель / покупатель

Без регистрации может:

- открыть Marketplace;
- просматривать опубликованные архивы;
- видеть публичное описание;
- видеть публичный список файлов;
- видеть цену;
- видеть public metrics;
- скачать `.slr`;
- скачать/открыть SolArch Viewer.

После открытия `.slr` покупатель:

- видит locked state;
- видит цену и правила доступа;
- оплачивает USDC;
- получает доступ после backend verification и device activation.

### 2.2 Автор

После аутентификации может:

- создать архив;
- загрузить ZIP или отдельные файлы;
- задать metadata;
- указать собственный Solana payout wallet;
- задать цену в USDC;
- увидеть 95/5 split;
- настроить разрешённую license policy;
- дождаться генерации `.slr`;
- preview публичной карточки;
- publish/unpublish;
- получить публичную ссылку;
- скачать собственный `.slr`;
- видеть analytics.

### 2.3 Администратор

Для MVP нужен минимальный moderation capability:

- скрыть/заблокировать listing;
- изменить moderation status;
- запретить public download заблокированного архива.

Полноценная admin platform не является обязательной.

---

## 3. Утверждённая экономика

```text
Payment asset = USDC only
Platform fee = 5%
Creator share = 95%
```

Пример:

```text
Archive price:       10.00 USDC
Buyer pays:          10.00 USDC
Creator receives:     9.50 USDC
SolArch receives:     0.50 USDC
Network fees:        paid by SolArch
```

### 3.1 Non-custodial

SolArch не создаёт автору custodial wallet.

Автор указывает собственный Solana wallet.

SolArch не хранит:

- creator seed phrase;
- creator private key;
- custodial creator balance.

В MVP отсутствует withdrawal/payout subsystem.

### 3.2 Price immutability

Цена задаётся при создании архива и после создания не меняется.

Immutable:

```text
price_amount
price_currency
platform_fee_bps
```

Если автор хочет другую цену, он создаёт новый archive.

---

## 4. Поддерживаемый контент MVP

Protected internal viewing:

```text
PDF
PNG
JPG / JPEG
WebP
DOCX
XLSX
```

Не входит:

```text
video
audio
PPTX
legacy DOC
legacy XLS
specialized CAD/PSD/3D
```

DOCX/XLSX не должны открываться во внешнем Microsoft Office в режиме protected viewing.

---

## 5. `.slr` distribution model

`.slr` v1 является self-contained encrypted container.

Он должен содержать зашифрованные данные файлов, необходимые для локального protected viewing после получения content key.

Поддерживаются два distribution flow:

```text
Marketplace-first:
Marketplace → Download .slr → Viewer

File-first:
Telegram / Discord / email / Drive / USB → .slr → Viewer
```

---

## 6. Marketplace MVP

### 6.1 Публичные функции

Обязательно:

- landing/catalog;
- archive cards;
- public archive page;
- public file listing;
- price;
- access rules;
- public metrics;
- guest `.slr` download;
- Viewer download link;
- сортировки.

### 6.2 Public metrics

Любой посетитель видит:

```text
views
downloads
paid unlocks
```

### 6.3 Creator analytics

Автор видит:

```text
views
downloads
confirmed payments / paid unlocks
gross revenue
creator revenue
platform fees
view → download conversion
download → purchase conversion
```

Рекомендуемые периоды:

```text
7 days
30 days
all time
```

---

## 7. Viewer MVP

Viewer должен:

- запускаться при открытии `.slr`;
- читать public header;
- показывать locked state;
- показывать текущую цену/policy;
- показывать payment QR;
- работать с backend payment flow;
- генерировать и хранить device key;
- активировать device-bound license;
- повторно открывать архив на том же устройстве;
- рендерить поддерживаемые типы внутри приложения;
- отображать buyer/license watermark;
- не иметь стандартного Extract All / Save As / Open External для protected content.

---

## 8. Licensing model

Строго разделять:

```text
Payment
Entitlement
Device License
Content Key
```

Определения:

- **Payment** — подтверждённый on-chain факт оплаты.
- **Entitlement** — право buyer на конкретный archive.
- **Device License** — активация Entitlement на конкретном device public key.
- **Content Key** — ключ, позволяющий расшифровывать protected content.

Для MVP:

```text
max_devices = 1
```

---

## 9. Marketplace sorting

Обязательно:

```text
popular_week
popular_month
most_downloaded
price_asc
price_desc
```

Для первой версии допустима формула:

```text
popular_week/month:
confirmed_payments DESC
downloads DESC as secondary sort
```

с фильтрацией событий по соответствующему периоду.

---

## 10. Out of scope

Не делать в hackathon MVP:

- SOL pricing;
- dynamic FX;
- other SPL assets;
- x402;
- subscriptions;
- ratings/reviews;
- referrals;
- promocodes;
- creator balances;
- withdrawals;
- custodial wallets;
- refunds;
- escrow;
- NFT licenses;
- on-chain license registry;
- secondary sales;
- mobile app;
- video/audio;
- advanced DRM promises;
- advanced recommendation engine;
- advanced analytics attribution;
- complex admin portal.

---

## 11. Acceptance Criteria

### AC-01

Гость открывает Marketplace без login и видит опубликованные архивы.

### AC-02

Гость открывает archive page и видит title, description, price, file listing, access rules и public metrics.

### AC-03

Гость скачивает `.slr` без регистрации и оплаты.

### AC-04

Marketplace никогда не выдаёт original ZIP/raw protected files гостю.

### AC-05

При открытии unpaid `.slr` Viewer показывает locked state и payment flow.

### AC-06

Покупатель платит только USDC archive price.

### AC-07

Одна подтверждённая transaction распределяет 95% creator и 5% SolArch.

### AC-08

Network fee оплачивает SolArch.

### AC-09

После полной backend verification создаётся Entitlement.

### AC-10

Device A активируется и открывает archive.

### AC-11

Device B отклоняется, если `max_devices = 1`.

### AC-12

PDF/image/DOCX/XLSX открываются внутри Viewer.

### AC-13

Protected content имеет видимый watermark.

### AC-14

Цена archive не может быть изменена после создания.

### AC-15

Если creator USDC ATA отсутствует, SolArch создаёт его автоматически.

### AC-16

Public metrics корректно показывают views, downloads и paid unlocks.

### AC-17

`paid unlocks` увеличивается только после blockchain-verified payment.

---

## 12. Product limitation

SolArch использует practical DRM и traceability.

Нельзя заявлять абсолютную невозможность:

- screen recording;
- screenshots;
- memory extraction;
- reverse engineering;
- photographing the screen.

Корректная формулировка:

> SolArch снижает риск несанкционированного распространения и делает перенос защищённого файла независимым от права его открыть, но не гарантирует абсолютную DRM-защиту после отображения контента пользователю.
