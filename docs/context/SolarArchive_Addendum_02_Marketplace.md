# SolarArchive — Addendum 02: Marketplace

**Формат документа:** Markdown  
**Тип документа:** дополнение к основному ТЗ `SolarArchive_Project_Blueprint.md` и `SolarArchive_Addendum_01_Market_And_Differentiation.md`  
**Версия:** 0.1  
**Дата:** 2026-09-05  
**Статус:** командное продуктовое решение / требования к Marketplace  
**Язык:** русский  

---

## 0. Назначение документа

Этот файл фиксирует отдельное продуктовое и техническое ТЗ для публичного **SolarArchive Marketplace**.

Документ не заменяет:

- `SolarArchive_Project_Blueprint.md`;
- `SolarArchive_Addendum_01_Market_And_Differentiation.md`.

Все базовые решения по формату `.solararchive`, шифрованию, SolarArchive Viewer, Solana/USDC payments, Entitlement, device-bound license, watermarking и DRM-подходу остаются в силе, если ниже прямо не указано иное.

Главное изменение относительно предыдущего roadmap:

> Публичный marketplace больше не рассматривается только как далёкая Phase 3. Команда решила включить marketplace-flow в продукт и отдельно формализовать его как самостоятельный слой SolarArchive.

При этом Marketplace **не заменяет** основную технологическую ценность SolarArchive.

```text
SolarArchive core value:
protected .solararchive container
+ payment after download/open
+ Entitlement
+ device-bound license
+ controlled Viewer
```

Marketplace добавляет поверх этого:

```text
discovery
+ public archive pages
+ public download
+ creator publishing
+ creator analytics
```

---

## 1. Главная идея Marketplace

SolarArchive Marketplace — это публичный веб-каталог защищённых `.solararchive`-контейнеров.

Базовая модель:

```text
Пользователь открывает SolarArchive Marketplace
        ↓
Смотрит каталог архивов
        ↓
Открывает карточку конкретного архива
        ↓
Изучает описание, цену и публичный список содержимого
        ↓
Скачивает .solararchive БЕЗ регистрации
        ↓
Открывает файл на компьютере через SolarArchive Viewer
        ↓
Viewer показывает paywall
        ↓
Пользователь оплачивает SOL/USDC
        ↓
Backend подтверждает платёж
        ↓
Создаётся Entitlement / Device License
        ↓
Контент открывается в SolarArchive Viewer
```

Ключевой принцип:

> **Скачивание `.solararchive` не является покупкой.**

Пользователь может свободно получить зашифрованный контейнер. Оплата требуется не за сам факт скачивания, а за право открыть защищённое содержимое.

---

## 2. Принципы доступа

### 2.1 Покупатель / посетитель

Для следующих действий регистрация на Marketplace **не требуется**:

- открыть главную страницу;
- просматривать каталог;
- использовать публичные фильтры и сортировку;
- открывать страницу архива;
- смотреть публичное описание;
- смотреть цену и валюту;
- смотреть публичный список файлов;
- смотреть правила доступа;
- скачивать `.solararchive`;
- переходить на страницу скачивания SolarArchive Viewer.

Авторизация покупателя на сайте не должна быть обязательным условием для download-flow.

Платёж и buyer identity обрабатываются существующим SolarArchive payment/license flow в Viewer.

### 2.2 Автор / продавец

Для создания и публикации архива автор должен быть аутентифицирован.

После входа автор может:

- создать новый архив;
- загрузить ZIP;
- загрузить RAR;
- загрузить отдельные файлы;
- использовать иные уже поддерживаемые основным ТЗ способы загрузки;
- заполнить публичные данные карточки;
- указать цену;
- выбрать поддерживаемую валюту;
- настроить правила доступа;
- запустить генерацию `.solararchive`;
- опубликовать архив на Marketplace;
- редактировать карточку;
- снимать архив с публикации;
- скачивать собственный `.solararchive`;
- получать публичную ссылку;
- видеть статистику.

Механизм аутентификации автора наследуется из основного ТЗ. Этот Addendum не вводит новый способ регистрации или входа.

### 2.3 Администратор

Администратор использует существующий moderation/admin layer и должен иметь возможность:

- видеть опубликованные архивы;
- скрывать или блокировать карточку;
- блокировать запрещённый контент;
- видеть базовую информацию об авторе;
- обрабатывать жалобы, если complaint-flow будет включён в конкретный релиз;
- отслеживать подозрительную активность.

---

## 3. Роль Marketplace в архитектуре

Marketplace следует рассматривать как отдельный web-layer над существующими сущностями SolarArchive.

```text
Marketplace Web
      ↓
Archives API
      ↓
Archive metadata / Marketplace listing
      ↓
Generated .solararchive
      ↓
SolarArchive Viewer
      ↓
Payment → Entitlement → Device License
```

Marketplace не должен:

- выдавать content key;
- считать обычное скачивание оплатой;
- раскрывать расшифрованное содержимое;
- заменять SolarArchive Viewer;
- отдавать исходный ZIP/RAR покупателю до оплаты;
- переносить критическую payment verification на frontend.

---

## 4. Основные страницы Marketplace

### 4.1 Landing / главная страница

Главная страница должна одновременно выполнять две задачи:

1. коротко объяснять, что такое SolarArchive;
2. сразу давать доступ к каталогу архивов.

Рекомендуемая структура:

```text
Header
Hero / краткое объяснение SolarArchive
Marketplace catalog
Filters / sorting
Archive cards
CTA для авторов
Footer
```

На первом экране пользователь должен быстро понять:

```text
архив можно скачать бесплатно
↓
для открытия нужен SolarArchive Viewer
↓
доступ к содержимому оплачивается внутри Viewer
```

### 4.2 Каталог архивов

Каталог отображает только архивы, которые имеют публичный статус публикации.

Каждый элемент каталога представлен карточкой.

### 4.3 Страница архива

У каждого опубликованного архива должна быть публичная страница.

Пример URL:

```text
/marketplace/{archive_slug}
```

или:

```text
/a/{archive_id}
```

Конкретный URL-pattern определяется реализацией, но ссылка должна быть стабильной и пригодной для распространения.

### 4.4 Dashboard автора

Dashboard автора должен содержать минимум:

```text
My Archives
Create Archive
Archive status
Marketplace status
Downloads
Paid unlocks
Revenue
Archive settings
Public link
Download .solararchive
```

---

## 5. Карточка архива в каталоге

Минимальная карточка должна показывать:

- название;
- короткое описание;
- cover/thumbnail, если он задан;
- цену;
- валюту;
- автора или публичное имя автора, если оно предусмотрено профилем;
- количество файлов;
- общий размер;
- тип доступа, если это важно покупателю;
- кнопку/ссылку открытия страницы архива.

Рекомендуемые дополнительные публичные показатели:

- количество скачиваний;
- количество подтверждённых оплат;
- дата публикации.

Эти показатели могут использоваться также для сортировки.

Карточка не должна содержать:

- content key;
- приватные storage URLs;
- приватный manifest;
- внутренние hashes, не предназначенные для публичной проверки;
- технические данные лицензий других покупателей.

---

## 6. Публичная страница архива

Страница архива является основной product page для конкретного `.solararchive`.

Она должна содержать следующие блоки.

### 6.1 Основная информация

Обязательно:

- название;
- полное описание;
- цена;
- валюта оплаты;
- автор;
- общий размер;
- количество файлов;
- access mode;
- max devices;
- разрешён ли export;
- наличие watermark, если это требуется раскрывать покупателю;
- правила офлайн-доступа, если они применяются;
- предупреждение о необратимости криптовалютного платежа.

### 6.2 Публичный список содержимого

Команда решила, что пользователь должен иметь возможность **до скачивания и оплаты понять, какие файлы находятся внутри архива**.

Для этого Marketplace должен хранить отдельный **public file listing**.

Пример:

```text
course/
├── README.md
├── lesson-01.pdf
├── lesson-02.pdf
├── examples/
│   ├── example-01.ts
│   └── example-02.ts
└── assets/
    └── cover.png
```

Для каждого публично отображаемого файла можно показывать:

- display name;
- тип/MIME или расширение;
- размер;
- логический путь внутри архива.

### 6.3 Важное архитектурное ограничение

Публичный список файлов **не должен быть тем же объектом**, что зашифрованный внутренний manifest `.solararchive`.

Нужно разделить:

```text
Encrypted Manifest
    содержит полную внутреннюю структуру для Viewer

Public Listing Manifest
    содержит только данные, разрешённые для Marketplace
```

`Public Listing Manifest` не должен содержать:

- chunk map;
- encryption metadata;
- content keys;
- file keys;
- приватные hashes, если они не нужны для публичной проверки;
- внутренние storage paths;
- служебные данные DRM/license engine.

Это изменение необходимо, потому что основная архитектура считает полный manifest чувствительными данными, а Marketplace по новому продуктовому решению должен показывать состав архива до оплаты.

### 6.4 Preview

Если в существующей модели архива настроен preview, страница может показывать:

- cover;
- README;
- sample pages;
- изображения;
- иные разрешённые автором preview-материалы.

Preview не является обязательным условием публикации, если команда отдельно не решит обратное.

### 6.5 Главный CTA

Основное действие:

```text
Скачать .solararchive
```

Дополнительно рядом необходимо объяснить:

```text
Скачивание бесплатно.
Для открытия защищённого содержимого потребуется SolarArchive Viewer и оплата указанной стоимости.
```

Если Viewer не установлен, пользователь должен иметь понятную ссылку:

```text
Download SolarArchive Viewer
```

---

## 7. Скачивание без регистрации

### 7.1 Обязательное правило

Для публично опубликованного архива `.solararchive` должен скачиваться без:

- регистрации;
- email;
- создания marketplace-account;
- предварительного платежа.

### 7.2 Что именно скачивается

Marketplace отдаёт только:

```text
generated .solararchive
```

Marketplace **не должен** отдавать гостю:

```text
original ZIP
original RAR
original raw uploaded files
content key
decrypted manifest
```

### 7.3 Учёт скачиваний

Каждое успешное начало/завершение download-flow должно учитываться в статистике.

Минимальный показатель:

```text
download_count
```

Для защиты от очевидного накручивания статистики допустимо считать метрику по серверным download events, а не увеличивать её только на frontend.

Точная anti-abuse модель может быть расширена позже.

---

## 8. Создание и публикация архива автором

### 8.1 Базовый flow

```text
Автор регистрируется / входит
        ↓
Create Archive
        ↓
Загружает ZIP / RAR / файлы
        ↓
Система валидирует upload
        ↓
Автор заполняет metadata
        ↓
Указывает цену / валюту / wallet
        ↓
Настраивает license policy
        ↓
Система генерирует .solararchive
        ↓
Система генерирует Marketplace card
        ↓
Автор проверяет preview карточки
        ↓
Publish
        ↓
Архив появляется в публичном каталоге
```

### 8.2 Данные, которые автор должен указать

Минимально:

- `title`;
- `description`;
- `price_amount`;
- `price_currency`;
- payment recipient / creator wallet в соответствии с основной payment-моделью;
- license policy, уже предусмотренную SolarArchive;
- публичность архива.

Рекомендуемые Marketplace-поля:

- `cover`;
- `category`;
- `tags`;
- `short_description`.

`category` и `tags` нужны только для discovery/filtering и являются marketplace metadata, а не частью криптографического ядра.

### 8.3 Автоматически формируемые данные

После обработки upload система может автоматически вычислить:

- количество файлов;
- общий размер;
- типы файлов;
- public file listing;
- archive fingerprint;
- размер готового `.solararchive`.

Перед публикацией автор должен иметь возможность увидеть, какая информация станет публичной.

---

## 9. Статусы архива

Для Marketplace рекомендуется разделить техническое состояние архива и состояние публикации.

Минимальная логика:

```text
processing
ready
failed
```

и отдельно:

```text
draft
published
unpublished
blocked
```

Пример:

```text
technical_status = ready
marketplace_status = published
```

Это позволяет снять карточку с Marketplace, не удаляя сам созданный архив.

---

## 10. Discovery: фильтры и сортировка

На главной странице Marketplace должны быть механизмы discovery.

### 10.1 Обязательные варианты сортировки

На основании решения команды:

- **Популярное за неделю**;
- **Популярное за месяц**;
- **Больше всего скачиваний**;
- **Цена: по возрастанию**;
- **Цена: по убыванию**.

### 10.2 Определение «популярности»

Для первой версии нельзя оставлять `popular` неопределённым.

Рекомендуемая простая модель:

```text
popularity_score =
confirmed_payments * PAYMENT_WEIGHT
+ qualified_downloads * DOWNLOAD_WEIGHT
```

При этом:

```text
Popular this week
→ score только по событиям за последние 7 дней

Popular this month
→ score только по событиям за последние 30 дней
```

Для MVP допустима ещё более простая реализация:

```text
popular = confirmed_payments DESC
```

а downloads использовать как secondary sort.

Главное требование: выбранная формула должна быть единой и документированной.

### 10.3 Дополнительные фильтры

Если в релиз включаются `category` и `tags`, Marketplace может поддерживать:

- category;
- file type;
- price range;
- currency.

Эти фильтры являются полезным расширением, но не должны блокировать первый рабочий marketplace-flow.

---

## 11. Поиск

Текстовый поиск рекомендуется выполнять по публичным marketplace-полям:

- title;
- short description;
- description;
- category;
- tags;
- public file names, если команда хочет индексировать их.

Поиск не должен индексировать расшифрованное содержимое защищённых файлов.

Для первой версии достаточно обычного database search. Отдельный search engine не является обязательным требованием этого Addendum.

---

## 12. Статистика автора

Автор должен видеть статистику по каждому опубликованному архиву.

### 12.1 Обязательные показатели

Минимум:

```text
total_downloads
confirmed_payments
gross_revenue
```

`gross_revenue` необходимо показывать отдельно по валюте, если один продукт или платформа поддерживает несколько assets.

Пример:

```text
Payments: 42
Downloads: 310
Revenue:
- 285 USDC
- 1.7 SOL
```

### 12.2 Рекомендуемый показатель конверсии

Полезная производная метрика:

```text
download_to_payment_conversion =
confirmed_payments / qualified_downloads
```

Пример:

```text
310 downloads
42 payments
13.55% conversion
```

Это помогает автору оценить, насколько хорошо карточка и сам продукт превращают скачивания в реальные открытия после оплаты.

### 12.3 Периоды

Рекомендуемые периоды:

- 7 дней;
- 30 дней;
- всё время.

### 12.4 Что не требуется в первой версии

Необязательно сразу реализовывать:

- сложные cohort reports;
- geo analytics;
- attribution;
- UTM analytics;
- advanced funnels;
- revenue forecasting.

---

## 13. Marketplace events

Для сортировки и аналитики требуется серверный учёт событий.

Минимальные типы:

```text
archive_view
archive_download
payment_confirmed
```

Опционально:

```text
viewer_download_click
archive_preview_open
```

События не должны содержать content keys, приватные ключи или расшифрованное содержимое.

---

## 14. Дополнения к модели данных

Существующая таблица `archives` остаётся основной сущностью архива.

Для Marketplace рекомендуется либо расширить `archives`, либо выделить отдельную таблицу `archive_listings`.

Предпочтительный вариант — отдельная сущность публикации, чтобы не смешивать криптографическое состояние архива и публичную карточку.

### 14.1 `archive_listings`

Концептуальные поля:

```text
id
archive_id
slug
title
short_description
description
cover_storage_key
category
tags
marketplace_status
published_at
updated_at
```

### 14.2 `archive_public_files`

Публичный listing manifest:

```text
id
archive_id
display_path
display_name
file_extension
mime_type
size_bytes
sort_order
is_publicly_listed
```

Эта таблица не заменяет encrypted manifest.

### 14.3 `marketplace_events`

Концептуально:

```text
id
archive_id
event_type
occurred_at
anonymous_session_id
metadata
```

Необходимо соблюдать принцип data minimization. Marketplace не должен собирать персональные данные только ради статистики, если они не нужны продукту или безопасности.

---

## 15. Дополнения к API

Названия endpoint-ов ниже являются рекомендуемой схемой. При реализации они должны быть согласованы с уже существующим `Archives API`.

### 15.1 Публичный каталог

```http
GET /v1/marketplace/archives
```

Поддерживаемые query-параметры могут включать:

```text
sort
period
category
price_min
price_max
currency
search
page / cursor
```

### 15.2 Публичная карточка

```http
GET /v1/marketplace/archives/:slug
```

Возвращает только публичные данные.

### 15.3 Публичный список файлов

```http
GET /v1/marketplace/archives/:slug/files
```

Возвращает только `Public Listing Manifest`.

### 15.4 Download `.solararchive`

```http
GET /v1/marketplace/archives/:slug/download
```

Требования:

- доступен без marketplace-auth;
- только для `published` archive;
- возвращает generated `.solararchive`;
- не возвращает исходный upload;
- создаёт/учитывает download event;
- storage URL не должен давать постоянный неконтролируемый доступ к внутреннему object storage.

### 15.5 Публикация автором

```http
POST /v1/archives/:archive_id/publish
POST /v1/archives/:archive_id/unpublish
```

Требуется author authentication и проверка ownership.

### 15.6 Analytics автора

```http
GET /v1/archives/:archive_id/analytics
```

Возвращает статистику только владельцу архива или администратору.

---

## 16. Безопасность и приватность Marketplace

Публичный Marketplace добавляет attack surface, поэтому необходимо соблюдать следующие правила.

### 16.1 Никогда не публиковать

- content keys;
- device private keys;
- license secrets;
- raw encrypted key material;
- приватный encrypted manifest в расшифрованном виде;
- исходные upload URLs;
- внутренние storage credentials;
- чужие buyer wallet/license данные без продуктовой необходимости.

### 16.2 Ownership

Все author-only действия должны проверять:

```text
authenticated_user owns archive_id
```

Недостаточно скрыть кнопку на frontend.

### 16.3 Download security

Публичный download разрешён только для готового `.solararchive`.

Прямое скачивание исходного ZIP/RAR через Marketplace запрещено.

### 16.4 Public file listing

Перед публикацией система должна чётко отделять:

```text
что увидит весь интернет
```

от:

```text
что останется внутри encrypted manifest
```

Это важно, потому что filename сам по себе иногда может содержать чувствительную информацию.

### 16.5 Модерация

Так как Marketplace является публичным каталогом, существующий basic moderation layer становится обязательным для публичной публикации.

Минимум:

- возможность скрыть listing;
- возможность заблокировать listing;
- возможность заблокировать автора в рамках существующей auth/admin-модели;
- status/reason для moderation action.

Расширенные abuse-reporting и automated malware scanning могут развиваться отдельно согласно общему roadmap.

---

## 17. Marketplace MVP

В рамках **Marketplace MVP** необходимо реализовать только то, что нужно для полного A-to-Z flow.

### 17.1 Обязательно

#### Для посетителя

- публичная главная страница;
- каталог;
- карточки архивов;
- страница архива;
- публичный список содержимого;
- отображение цены;
- отображение правил доступа;
- download `.solararchive` без регистрации;
- ссылка на SolarArchive Viewer;
- сортировка:
  - popular week;
  - popular month;
  - most downloaded;
  - price ascending;
  - price descending.

#### Для автора

- authentication через уже выбранный основной механизм;
- создание архива;
- upload ZIP/RAR/files;
- metadata карточки;
- цена и валюта;
- генерация `.solararchive`;
- preview публичной карточки;
- publish/unpublish;
- публичная ссылка;
- analytics:
  - downloads;
  - confirmed payments;
  - revenue.

#### Backend

- public listing API;
- public archive metadata API;
- public file listing;
- public `.solararchive` download;
- download event;
- payment-confirmed aggregation;
- owner-only analytics;
- publish/unpublish;
- basic moderation integration.

---

## 18. Что не является обязательным Marketplace MVP

Следующие функции остаются будущими улучшениями, если команда отдельно не повысит их приоритет:

- рейтинги;
- отзывы;
- комментарии;
- подписки;
- bundles;
- промокоды;
- referral system;
- полноценные creator profiles;
- social feed;
- recommendations на базе ML;
- personalised recommendations;
- сложные search engines;
- advanced analytics;
- payouts через custodial balance;
- escrow;
- secondary sales;
- transfer/resale marketplace;
- mobile marketplace app;
- автоматические refunds.

---

## 19. Acceptance Criteria

### AC-MKT-01: гостевой каталог

```text
Given пользователь не зарегистрирован
When он открывает Marketplace
Then он видит опубликованные архивы
And может открыть карточку архива
And система не требует login
```

### AC-MKT-02: публичная карточка

```text
Given archive имеет marketplace_status=published
When гость открывает его страницу
Then он видит title, description, price, currency, file count, size и access rules
And видит разрешённый публичный список файлов
And не получает защищённое содержимое
```

### AC-MKT-03: download без регистрации

```text
Given archive опубликован
And пользователь не зарегистрирован
When пользователь нажимает Download .solararchive
Then скачивается generated .solararchive
And регистрация не требуется
And оплата до скачивания не требуется
```

### AC-MKT-04: нельзя скачать исходник

```text
Given автор загрузил source.zip
When гость скачивает продукт
Then гость получает generated .solararchive
And source.zip не выдаётся
```

### AC-MKT-05: payment остаётся в Viewer-flow

```text
Given пользователь скачал .solararchive
When он открывает его в SolarArchive Viewer без активной лицензии
Then Viewer показывает цену/paywall
And доступ к protected content не предоставляется до подтверждённого платежа
```

### AC-MKT-06: публикация только автором

```text
Given пользователь аутентифицирован
When он пытается publish archive
Then backend проверяет ownership
And только владелец archive или admin может изменить marketplace publication state
```

### AC-MKT-07: статистика

```text
Given опубликованный archive имеет downloads и confirmed payments
When автор открывает analytics
Then он видит total downloads
And confirmed payments
And gross revenue
```

### AC-MKT-08: guest не видит author analytics

```text
Given пользователь не является владельцем archive
When он запрашивает owner analytics endpoint
Then backend не возвращает приватную статистику автора
```

### AC-MKT-09: popular week

```text
Given Marketplace имеет события минимум за 7 дней
When пользователь выбирает Popular this week
Then каталог сортируется по документированной popularity formula
And учитываются только события заданного недельного периода
```

### AC-MKT-10: public manifest отделён от encrypted manifest

```text
Given archive опубликован
When Marketplace отдаёт список файлов
Then API возвращает только public listing fields
And не раскрывает chunk map, keys, internal storage paths или private manifest data
```

### AC-MKT-11: unpublished archive

```text
Given archive marketplace_status != published
When гость открывает public URL или download endpoint
Then архив не отображается как публично доступный
And публичный download запрещён
```

### AC-MKT-12: полный buyer-flow

```text
1. Гость открывает Marketplace.
2. Находит архив.
3. Изучает карточку и список файлов.
4. Скачивает .solararchive без регистрации.
5. Открывает его в SolarArchive Viewer.
6. Viewer показывает цену и правила.
7. Покупатель оплачивает.
8. Backend подтверждает payment.
9. Создаётся Entitlement.
10. Активируется Device License.
11. Контент открывается согласно policy.
```

Этот сценарий считается главным end-to-end критерием Marketplace.

---

## 20. Обновление предыдущих продуктовых решений

Этот документ изменяет предыдущие roadmap-положения только в части Marketplace.

Было:

```text
Marketplace — Phase 3 / не основной MVP.
```

Новое решение команды:

```text
Marketplace — отдельный обязательный продуктовый слой,
который должен быть спроектирован и реализовываться вместе
с основным пользовательским flow SolarArchive.
```

При этом **не отменяется** прежний вывод:

> SolarArchive не должен позиционироваться как «просто marketplace файлов».

Правильная модель:

```text
Marketplace = discovery + distribution

.solararchive = protected content container

Viewer = paywall + activation + controlled access
```

Именно сочетание этих слоёв формирует продукт.

---

## 21. Предположения и решения, которые ещё нужно зафиксировать

Ниже перечислены вопросы, которые не были окончательно определены в командном обсуждении и поэтому не должны молча считаться утверждёнными.

### OPEN-MKT-01: категории

Нужен ли фиксированный список категорий или автор вводит только tags?

### OPEN-MKT-02: публичное имя автора

Показывать:

```text
username
wallet
оба варианта
```

Нужно определить отдельно.

### OPEN-MKT-03: публичная статистика

Показывать ли посетителям:

- downloads;
- confirmed payments;

или оставить эти показатели только для сортировки и dashboard автора?

### OPEN-MKT-04: public file names

Командное решение требует показывать содержимое архива.

Нужно окончательно определить:

```text
все filenames публичны по умолчанию
```

или:

```text
автор вручную выбирает, какие filenames можно показывать
```

С точки зрения приватности второй вариант безопаснее.

### OPEN-MKT-05: popularity formula

Нужно выбрать конкретную формулу до реализации.

Минимальный вариант:

```text
confirmed_payments DESC
```

Более полный:

```text
payments + weighted downloads
```

### OPEN-MKT-06: marketplace commission

Этот Addendum не меняет прежнее payment decision автоматически.

Если в MVP используется direct-to-creator payment, Marketplace может работать без custody и payout balance.

Platform fee требует отдельного утверждённого payment-flow.

---

## 22. Краткая итоговая формулировка

> **SolarArchive Marketplace** — публичный каталог защищённых `.solararchive`-контейнеров, где любой посетитель без регистрации может найти архив, изучить его описание и публичный список файлов и бесплатно скачать зашифрованный контейнер. Оплата требуется не для скачивания, а для открытия защищённого содержимого через SolarArchive Viewer. Автор после регистрации может загрузить ZIP/RAR/файлы, настроить цену и правила доступа, сгенерировать `.solararchive`, опубликовать карточку и отслеживать скачивания, подтверждённые оплаты и выручку.

Главный flow продукта:

```text
Discover
→ Inspect
→ Download without registration
→ Open in Viewer
→ Pay
→ Verify
→ Entitlement
→ Device License
→ Protected access
```
