# SolArch — Роль 3: Marketplace Backend & Solana

**Ветка:** `feat/marketplace-backend`  
**Ответственный:** участник 3  
**Главная зона ответственности:** backend Marketplace, uploads, storage, Solana USDC payments, Entitlement, Device License и analytics.

---

## 1. Цель роли

Создать доверенный backend SolArch, который связывает:

```text
Marketplace
→ archive upload/generation
→ public download
→ Solana payment
→ Entitlement
→ Device License
→ analytics
```

Все критические проверки оплаты и доступа выполняются только backend.

---

## 2. Основной стек

Рекомендуемая основа:

```text
NestJS
TypeScript
PostgreSQL
Object Storage
```

Queue/Redis можно подключать только если это действительно необходимо для archive processing в рамках hackathon.

Backend должен предоставлять REST API для:

- Marketplace Frontend;
- SolArch Viewer.

---

## 3. Auth

Нужен creator authentication flow.

Минимально:

- login/challenge/verify согласно общему решению;
- session/token;
- `GET /me`;
- ownership checks;
- author-only routes;
- admin/moderation hooks только в минимальном объёме, нужном для MVP.

Нельзя полагаться на скрытие кнопок на frontend. Ownership проверяется сервером.

---

## 4. Archives

Backend отвечает за lifecycle архива:

```text
draft
→ uploading
→ processing
→ ready
→ published/unpublished
```

Разделять:

```text
technical_status
marketplace_status
```

### Creator может:

- создать archive record;
- загрузить ZIP/files;
- задать metadata;
- указать payout wallet;
- задать цену;
- дождаться generation;
- получить готовый `.slr`;
- publish/unpublish;
- открыть analytics.

---

## 5. Неизменяемая цена

Главное правило:

```text
price_currency = USDC
price_amount = immutable after archive creation
```

После успешного создания archive запись цены нельзя изменять обычным `PATCH`.

Если creator хочет другую цену:

```text
создаёт новый archive_id
```

Также фиксировать snapshot platform fee:

```text
platform_fee_bps = 500
```

Это 5%.

Даже если глобальная комиссия платформы позже изменится, уже созданный archive сохраняет свою fee policy.

---

## 6. Payout Wallet и USDC ATA

SolArch не создаёт custodial wallet.

Creator указывает:

```text
creator_payout_wallet
```

Backend должен:

1. провалидировать Solana address;
2. вычислить canonical USDC Associated Token Account;
3. проверить, существует ли ATA;
4. если ATA отсутствует — создать его автоматически;
5. расходы ATA creation оплачивает SolArch;
6. сохранить payout destination, необходимый для будущих payment intents.

Creator никогда не передаёт private key/seed phrase.

Для demo предпочтительно создавать ATA при публикации архива, а не во время покупки.

---

## 7. Payment Asset

Для hackathon/MVP:

```text
USDC only
```

Не реализовывать:

```text
SOL pricing
dynamic SOL/USD conversion
other SPL assets
x402
```

Использовать только утверждённый canonical USDC mint для выбранной сети.

---

## 8. Payment Model — non-custodial 95/5 split

При цене архива 10 USDC:

```text
Buyer pays:       10.00 USDC
Creator receives:  9.50 USDC
SolArch receives:  0.50 USDC
```

Никаких внутренних creator balances и payout withdrawals.

Оплата должна быть **одной атомарной Solana-транзакцией**.

Backend формирует transaction request с текущим recent blockhash, содержащий
необходимые инструкции:

```text
USDC transfer → Creator ATA = 95%
USDC transfer → SolArch ATA = 5%
```

Если одна инструкция не проходит, вся транзакция не должна считаться покупкой.
До ответа Solana Pay POST Backend обязан подписать первый signer slot ключом
SolArch fee payer; wallet `account` остаётся единственным missing signer.

---

## 9. Fee Sponsorship

SolArch является fee payer.

Покупатель должен иметь возможность оплатить архив, имея только нужную сумму в USDC.

```text
Buyer:
pays archive price in USDC

SolArch:
pays Solana network fee in SOL
```

Network fee не вычитается:

- из 95% creator share;
- из 5% platform share;
- сверх отображаемой цены покупателю.

Экономически SolArch покрывает fee из собственного бюджета.

---

## 10. Payment Intent

Backend создаёт authoritative payment intent.

Он должен фиксировать:

```text
payment_intent_id
archive_id
archive_fingerprint
device_public_key
intent_credential_hash
price_amount
currency = USDC
creator_wallet
creator_ata
creator_share
platform_wallet
platform_ata
platform_share
reference
solana_pay_url
status
expires_at
```

Viewer не должен самостоятельно вычислять доверенные payment instructions.
30-минутный `expires_at` прекращает выдачу новых transactions. Публичный Solana
Pay GET/POST endpoint создаёт или идемпотентно возвращает одну ещё валидную
issuance; после окончания её blockhash window может создать свежую до intent
expiry. `account` из wallet POST используется только для построения transaction.

---

## 11. Payment Verification

После подписания транзакции backend обязан проверить:

- transaction signature;
- expected network;
- canonical USDC mint;
- creator recipient;
- creator amount = 95%;
- platform recipient;
- platform amount = 5%;
- total amount = archive price;
- expected reference/payment intent;
- exact Backend-issued transaction message hash;
- landing within that issuance's lastValidBlockHeight;
- transaction `confirmationStatus == finalized`;
- transaction success (`meta.err == null`);
- отсутствие replay;
- одна transaction signature не используется повторно;
- payment intent не используется для другого archive.

Только после полной проверки:

```text
payment_confirmed
```

Issuance, submission и `awaiting_finality` не создают Entitlement. Транзакция,
выданная до intent expiry и landed в своей blockhash validity, доводится до
Solana `finalized` commitment после expiry при необходимости. Late/unissued/reference-
only transaction отклоняется. Exact DTO/state/error contract — `docs/API.md`
§§7–8.

Для production MVP:

```text
getLatestBlockhash commitment = confirmed
processed payment = informational only
confirmed payment = awaiting_finality only
finalized payment + full verification = Payment/Entitlement
```

`confirmed` при получении blockhash не является payment authorization threshold.

---

## 12. Entitlement

Следовать модели:

```text
Payment ≠ Entitlement ≠ Device License
```

После `payment_confirmed` backend создаёт Entitlement.

Для Viewer purchase Payment Intent заранее и неизменно привязан к
`device_public_key`. Backend выводит `buyer_wallet` из подтверждённой transaction;
покупатель не имеет SolArch account/session и не подтверждает wallet при
activation/refresh. Entitlement наследует единственный Device A из intent.

Минимальные поля:

```text
id
archive_id
buyer_wallet
payment_id
status
max_devices
devices_activated
policy_snapshot
created_at
expires_at
```

Entitlement означает право покупателя получить доступ к конкретному archive.

---

## 13. Device License

Viewer отправляет:

```text
payment_intent_id + intent credential (initial activation)
или license_id + device refresh token (refresh)
device_public_key
device_name
viewer_version
```

Backend:

1. авторизует exact intent/refresh credential;
2. проверяет immutable pre-payment device binding и entitlement/archive state;
3. проверяет `max_devices=1`, не разрешая replacement/Device B;
4. создаёт/reuses device activation и signed 72-hour offline license;
5. оборачивает content key через exact HPKE contract API.md;
6. при initial activation выдаёт device refresh token, при refresh — новый
   signed license + wrapper для того же Device A.

Для MVP:

```text
max_devices = 1
```

Ключевой acceptance test:

```text
Device A активирован
→ открывает archive

Device B
→ получает отказ при max_devices = 1
```

---

## 14. Content Key Storage

Backend отвечает за безопасное хранение/получение content key.

Для hackathon допустимо использовать упрощённое серверное key storage, но:

- ключ не хранится в `.slr` открыто;
- ключ не возвращается до valid entitlement/device activation;
- ключ не логируется;
- API responses не попадают в verbose logs;
- secrets не коммитятся.

Production KMS/HSM можно оставить post-hackathon.

---

## 15. Archive Generation Integration

Фактический `.slr` формат и Rust tooling реализует участник Archive Core.

Backend должен иметь отдельный adapter/port:

```text
ArchiveBuilder
```

который после merge вызывает `solarch-core/solarch-cli`.

До merge можно использовать stub/mock generation.

Backend отвечает за:

- подготовку input;
- запуск processing;
- передачу metadata;
- получение готового `.slr`;
- сохранение generated file в storage;
- status `ready/failed`.

Не дублировать Rust container implementation в TypeScript.

---

## 16. Public Marketplace API

Нужны публичные endpoints уровня:

```text
list published archives
get public archive
get public file listing
download .slr
```

Guest auth не требуется.

Нельзя отдавать:

- original ZIP/RAR;
- raw uploaded files;
- content key;
- private manifest;
- internal storage path;
- private signed storage credentials.

Download endpoint отдаёт только generated `.slr`.

---

## 17. Public File Listing

Хранить отдельно от encrypted manifest.

Минимальные поля:

```text
archive_id
display_path
display_name
extension
mime_type
size_bytes
sort_order
is_publicly_listed
```

Этот объект нужен Marketplace Frontend до оплаты.

---

## 18. Marketplace Metrics

Обязательные event types:

```text
archive_view
archive_download
payment_confirmed
```

Публично показывать:

```text
views
downloads
paid unlocks
```

Эти значения доступны всем.

### Backend rules

`payment_confirmed`:

- создаётся только после реальной blockchain verification;
- является самым доверенным показателем.

`archive_download`:

- учитывается сервером;
- не увеличивается только frontend-событием.

`archive_view`:

- учитывается сервером;
- для MVP можно использовать anonymous session + временное deduplication window.

---

## 19. Creator Analytics

Owner-only analytics endpoint должен отдавать:

```text
views
downloads
confirmed payments
gross revenue
creator revenue
platform fees
view_to_download_conversion
download_to_purchase_conversion
```

Если есть период:

```text
7d
30d
all
```

Расчёт должен выполняться backend, а frontend только отображает.

---

## 20. Sorting

Backend реализует:

```text
popular_week
popular_month
most_downloaded
price_asc
price_desc
```

Popularity formula должна быть зафиксирована до merge в общем SPEC.

Для первой версии допустимо:

```text
confirmed_payments DESC
downloads DESC as secondary sort
```

для соответствующего временного окна.

---

## 21. Storage

Backend хранит:

- source upload временно/по policy;
- generated `.slr`;
- cover/preview;
- public metadata.

Public download не должен раскрывать постоянный приватный storage URL, если это позволяет обойти server-side accounting.

---

## 22. Минимальная модель данных

Ожидаемые сущности:

```text
users
wallets / auth identities
archives
archive_listings
archive_public_files
uploads
payment_intents
payments / transactions
entitlements
device_licenses
device_activations
marketplace_events
```

Точные поля фиксируются в общей документации перед активной интеграцией.

---

## 23. Безопасность

Обязательно:

- backend-only payment verification;
- ownership checks;
- immutable price enforcement;
- idempotency;
- replay protection;
- unique transaction signature;
- reference uniqueness;
- amount/recipient/mint validation;
- rate limits на критические endpoints;
- path traversal protection при upload/extraction;
- запрет executable content для MVP;
- secret redaction;
- no private keys/content keys in logs;
- basic moderation hook для `blocked`.

---

## 24. Что не входит в эту ветку

Не делать:

- Marketplace React UI;
- Creator Dashboard UI;
- `.slr` Rust binary format;
- Tauri Viewer;
- internal PDF/DOCX/XLSX rendering;
- desktop secure store;
- screenshot blocking;
- custodial creator wallets;
- creator balances;
- withdrawals;
- refunds;
- escrow;
- subscriptions;
- ratings/reviews;
- referral system;
- SOL pricing;
- video/audio;
- x402;
- on-chain license registry.

---

## 25. Тесты

### Unit

Покрыть:

- immutable price;
- 5% calculation;
- creator 95% calculation;
- ATA derivation;
- payment intent creation;
- amount/recipient/mint validation;
- replay protection;
- entitlement rules;
- max devices;
- analytics calculations;
- popularity sorting.

### Integration

Проверить:

- create archive;
- upload completion;
- generation adapter;
- publish/unpublish;
- guest listing;
- guest `.slr` download;
- creator ATA exists / auto-create;
- payment intent;
- signed transaction verification;
- entitlement creation;
- device activation;
- analytics events.

### E2E

Обязательный реальный flow:

```text
1. Creator creates archive.
2. Backend validates payout wallet.
3. Backend creates USDC ATA if missing.
4. Archive becomes ready/published.
5. Guest downloads .slr.
6. Viewer creates payment intent.
7. Buyer signs one transaction.
8. Creator receives 95%.
9. SolArch receives 5%.
10. SolArch pays network fee.
11. Backend verifies transaction.
12. Entitlement is created.
13. Device A activates license.
14. Device B is rejected for max_devices = 1.
15. payment_confirmed increments public/creator analytics.
```

---

## 26. Definition of Done

Ветка готова к merge, когда:

- creator auth работает;
- archives lifecycle работает;
- immutable price реально enforced;
- USDC-only payment работает;
- creator payout wallet поддерживается;
- ATA auto-creation работает;
- SolArch fee payer работает;
- одна atomic transaction делит 95/5;
- backend полностью проверяет payment;
- Entitlement создаётся;
- Device License работает;
- max_devices = 1 работает;
- public Marketplace API готов;
- `.slr` download accounting работает;
- public metrics работают;
- creator analytics работает;
- unit/integration/e2e tests проходят;
- migrations присутствуют;
- README содержит setup/test commands;
- `.env.example` есть, secrets не коммитятся.

---

## 27. Главный результат роли

К моменту объединения веток участник должен передать:

```text
Marketplace API
+ creator/archive backend
+ uploads/storage
+ non-custodial USDC 95/5 payment flow
+ fee sponsorship
+ automatic creator ATA
+ payment verification
+ Entitlement
+ Device License
+ public metrics
+ creator analytics
```

Это доверенный серверный слой SolArch.
