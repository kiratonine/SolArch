# SolArch — read-only audit публичного каталога и .slr downloads

Дата: **2026-10-10**, UTC. Проверка каталога начата около **11:10**, baseline DB **11:11:11**, файловая/DB сверка **11:14:29**, последующие read-only проверки статусов и сервиса выполнены в той же сессии.

Исходный read-only аудит: **PASS 2 / FAIL 6 / UNKNOWN 0**, охват **8/8 тогда опубликованных архивов**, **1/1 страниц каталога**. В разделах 1–10 сохранено состояние до исправлений. Последующее разрешённое владельцем снятие ровно шести архивов с публикации и его проверки описаны отдельно в checkpoint 11: **PASS**, публичный каталог теперь содержит только два исправных архива.

## 1. Окружение, метод и ограничения

- Frontend: https://sol-arch.vercel.app/catalog; Backend: https://solarch-api.duckdns.org.
- Ветка main, local HEAD `d1abc30615e775f1ae43dfdf1a4486fe728c7e2e`; существующий dirty tree и индекс сохранены. Deployment Backend на VPS: `/opt/solarch/releases/0930e1b85e373e17dd8bc850f81b8a6beb788cca`.
- Прочитаны AGENTS.md, API.md, SECURITY.md, DATA_MODEL.md, INTEGRATION.md и актуальные VPS/Supabase/Viewer release deployment reports. NestJS best-practices использован для read-only разбора download controller/exception handling, без рефакторинга.
- Настоящий production браузер через Playwright, без mock/MSW: service-worker registrations **0**. Последовательно открыта страница каждого архива и нажата реальная ссылка `main a[download]`, без Authorization. Никаких покупок, PaymentIntent creation, активации, refresh или wallet login.
- Public catalog API: HTTP 200, `total=8`, `page=1`, `per_page=20`, `total_pages=1`, `has_more=false`. В браузере все восемь карточек, дополнительных pagination links нет. DB независимо содержит **8 published archives / 8 published listings**; опубликованных записей вне проверенного набора не найдено. Это полный каталог, не выборка первых карточек.
- Два успешных скачивания полностью прочитаны из настоящего browser download stream, размер ограничен диагностическим cap 16 MiB (не изменение продуктовых лимитов). SHA-256 вычислен Web Crypto по всем скачанным байтам и сравнен с production DB fingerprint и независимо вычисленным SHA-256 файла VPS. Успешные .slr повторно по HTTP не скачивались в этом аудите.
- DB inspection использует Prisma client production release с DATABASE_URL из приватного VPS env **только в памяти**, interactive transaction с `SET TRANSACTION READ ONLY`; `SHOW transaction_read_only=on` подтверждён. Выбирались публичная identity, статусы, paths и агрегированные counts; не выводились buyer wallets/device keys, HMAC, tokens, signatures лицензий, приватные ключи или строки protected content.
- Файлы проверены как сервисный пользователь **solarch, uid=999**, storage root `/var/lib/solarch/storage`. Custody проверена на существование/доступность/size/mode, **не расшифровывалась**, не читалась в отчёт. PostgreSQL UPDATE/DELETE/DDL/migrations не выполнялись; immutability trigger не отключался.
- Браузер сохранил только два скачанных **зашифрованных** .slr в ignored `.playwright-mcp/`; это не protected plaintext и не proposed Git content. Никаких файлов production/SOURCE/backups не удалено.

## 2. Все опубликованные архивы — browser download results

Колонка SHA означает сравнение **browser bytes ↔ production archive_fingerprint ↔ VPS file SHA-256**. Для 404 SHA недоступен: отсутствующие байты не считались валидным .slr. Отсутствие необязательной обложки — N/A, не ошибка скачивания.

| Archive ID | Название / проверенная страница | Slug | Реальный download URL | HTTP | SHA | Cover | Итог .slr |
| --- | --- | --- | --- | ---: | --- | --- | --- |
| bf14ba07-15a6-4a3b-aabc-36d20e74cb37 | [Test New Archive](https://sol-arch.vercel.app/archives/test-new-archive-m8b9) | test-new-archive-m8b9 | https://solarch-api.duckdns.org/v1/marketplace/archives/test-new-archive-m8b9/download | 200 | MATCH, 2853209 bytes | 200 PNG | PASS |
| 690ac87c-1af1-444f-b2a4-8e6a74d5f2f4 | [fgfdgfdgd](https://sol-arch.vercel.app/archives/fgfdgfdgd-fclj) | fgfdgfdgd-fclj | https://solarch-api.duckdns.org/v1/marketplace/archives/fgfdgfdgd-fclj/download | 200 | MATCH, 64201 bytes | N/A, cover_url=null | PASS |
| 3d764ed0-e1ae-4b37-93da-4be67b36b3fa | [TestafterUIupdate](https://sol-arch.vercel.app/archives/testafteruiupdate-y2bj) | testafteruiupdate-y2bj | https://solarch-api.duckdns.org/v1/marketplace/archives/testafteruiupdate-y2bj/download | 404 | N/A, no .slr | 404 COVER_NOT_FOUND | FAIL |
| 1496a603-5b9f-42d7-b96c-5fedbb44b0e6 | [Cover E2E muchnm34](https://sol-arch.vercel.app/archives/cover-e2e-muchnm34-lchz) | cover-e2e-muchnm34-lchz | https://solarch-api.duckdns.org/v1/marketplace/archives/cover-e2e-muchnm34-lchz/download | 404 | N/A, no .slr | 404 COVER_NOT_FOUND | FAIL |
| a39fdcfb-0626-4dd2-8171-538c03233435 | [Test SolArch](https://sol-arch.vercel.app/archives/test-solarch-u6qc) | test-solarch-u6qc | https://solarch-api.duckdns.org/v1/marketplace/archives/test-solarch-u6qc/download | 404 | N/A, no .slr | N/A, cover_url=null | FAIL |
| 08b035ed-8002-4dad-b625-85b8bfce6f28 | [Full Stack Live 20260917182107](https://sol-arch.vercel.app/archives/full-stack-live-20260917182107-cbkn) | full-stack-live-20260917182107-cbkn | https://solarch-api.duckdns.org/v1/marketplace/archives/full-stack-live-20260917182107-cbkn/download | 404 | N/A, no .slr | N/A, cover_url=null | FAIL |
| 1e4598da-8a63-4692-8897-949da12b68f1 | [SolArch Payment Page Test](https://sol-arch.vercel.app/archives/solarch-payment-page-test-0be2) | solarch-payment-page-test-0be2 | https://solarch-api.duckdns.org/v1/marketplace/archives/solarch-payment-page-test-0be2/download | 404 | N/A, no .slr | N/A, cover_url=null | FAIL |
| 60ad6fed-6d73-4a20-af54-71f901da2460 | [SolArch Devnet Multi Format](https://sol-arch.vercel.app/archives/solarch-devnet-multi-format-yi22) | solarch-devnet-multi-format-yi22 | https://solarch-api.duckdns.org/v1/marketplace/archives/solarch-devnet-multi-format-yi22/download | 404 | N/A, no .slr | N/A, cover_url=null | FAIL |

Browser result для обоих PASS: штатное скачивание `<slug>.slr` завершилось, `Content-Type: application/x-solarch`, `Content-Disposition: attachment; filename="<slug>.slr"`, размер ненулевой. Chromium `net::ERR_ABORTED` при передаче навигации download manager для первого файла — не failure: полный stream прочитан и hash совпал.

Browser result для всех шести FAIL: вместо скачивания браузер переходит на Backend JSON error page. HTTP **404**, `Content-Type: application/json; charset=utf-8`, Content-Disposition отсутствует. Безопасный одинаковый ответ:

```json
{
  "code": "ARCHIVE_NOT_AVAILABLE",
  "message": "Published .slr archive not available for download"
}
```

Ни TLS/network timeout, ни CORS denial не подменяют эти статусы: HTTP responses реально получены. Неуспешные downloads не вернули source ZIP, ACK, license или protected plaintext.

## 3. Физические файлы, fingerprints и custody на VPS

Все восемь `archives` и соответствующие `archive_listings` существуют: **technical_status=ready**, **archives.marketplace_status=published**, **listing.marketplace_status=published**. У каждого есть non-null generatedSlrStorageKey/fingerprint/contentKeyRef, но DB reference **не доказывает наличие файла**.

Для шести FAIL exact DB path имеет вид:

`/tmp/solarch-part05-live-20260914/storage/slr/<archive_id>.slr`

Историческая директория физически отсутствует (проверено также root read-only). Проверка каждого exact DB path и `/var/lib/solarch/storage/slr/<archive_id>.slr` вернула **ENOENT**, не EACCES. Corresponding `/var/lib/solarch/storage/custody/<archive_id>.ack.enc` также **ENOENT**. Отсутствующий hash не помечен MATCH.

| Archive ID | Exact DB .slr path | Persistent .slr | custody/<ID>.ack.enc | Service read / mount | SHA/signature |
| --- | --- | --- | --- | --- | --- |
| 08b035ed-8002-4dad-b625-85b8bfce6f28 | old /tmp path, ENOENT | ENOENT | ENOENT | No file, not a permissions error | UNKNOWN bytes; download FAIL |
| 1496a603-5b9f-42d7-b96c-5fedbb44b0e6 | old /tmp path, ENOENT | ENOENT | ENOENT | No file | UNKNOWN bytes; download FAIL |
| 1e4598da-8a63-4692-8897-949da12b68f1 | old /tmp path, ENOENT | ENOENT | ENOENT | No file | UNKNOWN bytes; download FAIL |
| 3d764ed0-e1ae-4b37-93da-4be67b36b3fa | old /tmp path, ENOENT | ENOENT | ENOENT | No file | UNKNOWN bytes; download FAIL |
| 60ad6fed-6d73-4a20-af54-71f901da2460 | old /tmp path, ENOENT | ENOENT | ENOENT | No file | UNKNOWN bytes; download FAIL |
| a39fdcfb-0626-4dd2-8171-538c03233435 | old /tmp path, ENOENT | ENOENT | ENOENT | No file | UNKNOWN bytes; download FAIL |
| 690ac87c-1af1-444f-b2a4-8e6a74d5f2f4 | /home/denis/.local/share/solarch/backend-storage/slr/690ac87c-1af1-444f-b2a4-8e6a74d5f2f4.slr | Exists, 64201 B | Exists, 340 B | Readable, mode 0600, bind ro,nosuid,nodev,noexec | MATCH / AUTHENTICATED_CONTAINER |
| bf14ba07-15a6-4a3b-aabc-36d20e74cb37 | /home/denis/.local/share/solarch/backend-storage/slr/bf14ba07-15a6-4a3b-aabc-36d20e74cb37.slr | Exists, 2853209 B | Exists, 340 B | Readable, mode 0600, bind ro,nosuid,nodev,noexec | MATCH / AUTHENTICATED_CONTAINER |

Exact SHA-256 полученных браузером файлов, production DB и VPS:

- bf14ba07-15a6-4a3b-aabc-36d20e74cb37: `799b497e212beefb368c193df11aebd968742cc9abdc2b87993d566e47f8159c`.
- 690ac87c-1af1-444f-b2a4-8e6a74d5f2f4: `d1c64fab0808d723ae329963013c306c373c099132d76c23c5c78a7f808265f0`.

Дополнительно native CLI `/opt/solarch/bin/solarch verify --archive <path> --signing-key-id <existing public ID> --signing-public-key <existing public key>`: оба **exit 0**, `verification=AUTHENTICATED_CONTAINER`, signing key ID `archive-devnet-20260914`, fingerprint/size точные, `protected_content_verified=false`. Это проверка signed container, **не** decrypt/render/полные protected plaintext hashes. Первоначальная диагностическая команда с неверными CLI flags была отклонена `invalid builder input`; после сверки реального CLI интерфейса исправлена, PASS только для двух завершённых корректных вызовов. Timeout 30s / maxBuffer 8192 / sanitized child env; никаких signing private keys/ACK в CLI.

Проверен существующий `archives_finalized_content_immutable` trigger: `tgenabled=O` (enabled), без изменений. Наличие прочих constraints/triggers здесь не переаудировалось. Backend/Nginx active; error-priority service journal за период проверки пуст. Working bind mounts и два успешных HTTP downloads исключают общий outage/storage-root/permission отказ. PrivateTmp не объясняет FAIL: исторические файлы отсутствуют и на хосте, а не только в namespace сервиса.

## 4. Обложки — отдельный результат

Результат: **1 available / 2 missing / 5 intentionally absent (N/A)**. На каждый non-null cover_url выполнен один отдельный HTTP GET; .slr от этого повторно не скачивался.

| Archive | Public cover URL | HTTP / bytes / type | VPS file / browser |
| --- | --- | --- | --- |
| Test New Archive | https://solarch-api.duckdns.org/v1/marketplace/covers/64e17804-9a5c-492a-82ac-4936fa5cf2ea.png | 200 / 1189576 / image/png | Exists/readable, 0600; CORP cross-origin |
| TestafterUIupdate | https://solarch-api.duckdns.org/v1/marketplace/covers/61dbaec2-1824-463a-8812-590452703599.png | 404 / JSON, 90 B / COVER_NOT_FOUND | Persistent file ENOENT; browser image NotSameOrigin, fallback |
| Cover E2E muchnm34 | https://solarch-api.duckdns.org/v1/marketplace/covers/bc27421b-3457-4579-a922-81ec08121cf5.png | 404 / JSON, 90 B / COVER_NOT_FOUND | Persistent file ENOENT; browser image NotSameOrigin, fallback |

Для обеих missing covers безопасный message `Cover not found`; error response имеет CORP same-origin, поэтому Chromium может показать NotSameOrigin вместо JSON для `<img>`. Корневая проблема этих двух cover URLs — физическое отсутствие файла, не доказательство CORS failure для .slr. Для остальных пяти cover_url=null, запрос изображения не требуется; предусмотренная заглушка не считается FAIL.

## 5. Связанные записи неисправных архивов

Counts получены напрямую в read-only production DB; никакие идентификаторы покупателей, платежные signatures, device keys или credentials не раскрывались. Payments total=confirmed в каждой строке ниже.

| Archive ID / название | PaymentIntent | Payment / confirmed | Entitlement | DeviceActivation | DeviceLicense | Upload | Public files | Tx issuance | Nonce records | Events baseline→after |
| --- | ---: | ---: | ---: | ---: | ---: | ---: | ---: | ---: | ---: | --- |
| 08b035ed-8002-4dad-b625-85b8bfce6f28 / Full Stack Live | 4 | 1 / 1 | 1 | 0 | 0 | 1 | 1 | 1 | 0 | 5→6 |
| 1496a603-5b9f-42d7-b96c-5fedbb44b0e6 / Cover E2E | 0 | 0 / 0 | 0 | 0 | 0 | 1 | 1 | 0 | 0 | 4→5 |
| 1e4598da-8a63-4692-8897-949da12b68f1 / Payment Page Test | 5 | 0 / 0 | 0 | 0 | 0 | 1 | 1 | 0 | 0 | 4→5 |
| 3d764ed0-e1ae-4b37-93da-4be67b36b3fa / TestafterUIupdate | 0 | 0 / 0 | 0 | 0 | 0 | 1 | 1 | 0 | 0 | 7→8 |
| 60ad6fed-6d73-4a20-af54-71f901da2460 / Multi Format | 18 | 2 / 2 | 2 | 2 | 2 | 1 | 4 | 4 | 2 | 5→6 |
| a39fdcfb-0626-4dd2-8171-538c03233435 / Test SolArch | 1 | 1 / 1 | 1 | 1 | 1 | 1 | 3 | 1 | 9 | 3→4 |

Status detail:

- Full Stack Live: intents 3 expired / 1 confirmed; Entitlement active, license отсутствует. Это оплаченная запись, не disposable пустой архив.
- Payment Page Test: все 5 intents expired; payments/entitlements/licenses отсутствуют. История intent всё равно существует.
- Multi Format: intents 9 created / 7 expired / 2 confirmed; entitlements 1 active / 1 expired; licenses 2 active. `created` сам по себе не доказывает ещё payable window; TTL/issuance cancellation здесь не выполнялись и не пересчитывались. Нельзя удалять оплаченные/лицензированные записи или молча подменять bytes.
- Test SolArch: 1 confirmed intent/payment, 1 active entitlement, 1 active license.
- Cover E2E и TestafterUIupdate: финансовых/device записей нет, но uploads/public files/listing/events присутствуют.

Для всего каталога baseline и последующая сверка совпали по коммерческим counts: **32 intents, 7 confirmed payments, 7 entitlements, 6 activations, 6 licenses**. Ни один такой объект этим аудитом не создавался/изменялся.

## 6. Точные причины шести неисправностей и сравнение с deployment report

1. **Full Stack Live (08b035ed…)**: DB/listing опубликованы, но exact historical .slr path ENOENT и matching persistent .slr/custody отсутствуют. Download controller отклоняет наличие записи без физического файла. Paid Entitlement существует.
2. **Cover E2E (1496a603…)**: та же потеря historical .slr и custody; отдельно missing cover bc274… . Финансовых связей нет.
3. **Payment Page Test (1e4598da…)**: historical .slr/custody отсутствуют; пять expired intent records не дают скачиваемых bytes.
4. **TestafterUIupdate (3d764ed0…)**: historical .slr/custody отсутствуют; отдельно missing cover 61dbae… . Финансовых связей нет.
5. **Multi Format (60ad6fed…)**: canonical fingerprint сохранён, но физические .slr/custody отсутствуют на VPS; два confirmed payments/entitlements/licenses сохраняются. Нельзя rebuild тот же ID/fingerprint с новым ACK.
6. **Test SolArch (a39fdcfb…)**: historical .slr/custody отсутствуют при existing confirmed purchase/license.

Набор **ровно совпадает** с шестью missing archive IDs и двумя missing cover keys из VPS_DEPLOY_REPORT.md. Это подтверждение ранее зафиксированной filesystem gap после миграции, не новая corruption двух перенесённых файлов. Database schema/data migration сама по себе не переносила эти assets; internal contentKeyRef не содержит ACK и не восстанавливает custody.

Read-only разбор committed production MarketplaceController/MarketplaceService показывает: catalog допускает ready/published DB records независимо от `fs.existsSync`; detail `download_available` вычисляется из technicalStatus. Поэтому все шесть страниц доступны и показывают download CTA, хотя download route выполняет fs.existsSync и возвращает 404. Это несогласованность фактической availability и UI/metadata, **не исправленная этим аудитом**. Никаких permissions workaround или изменения frozen contracts.

## 7. Штатные побочные эффекты GET

Собственные DB diagnostics read-only, но public Backend штатно записывает analytics при реальных GET detail/download:

| Event type | Baseline | После восьми browser checks | Delta |
| --- | ---: | ---: | ---: |
| archive_view | 23 | 31 | +8 |
| archive_download | 15 | 17 | +2 |
| payment_confirmed | 7 | 7 | 0 |

Всего marketplace_events **45→55**. Delta согласуется с восемью просмотрами и двумя успешными скачиваниями. Для каждого FAIL добавлен только view; failed download не записал download event. Нельзя строго исключить постороннего посетителя на публичном сайте без выделенного session tracing, но наблюдаемые per-archive/event deltas соответствуют ровно выполненному последовательному аудиту. Аналитика не очищалась и не откатывалась.

## 8. Рекомендации — только после отдельного согласования

### Возможное снятие с публикации

Рассмотреть owner-approved **unpublish**, а не block/revoke, для шести нескачиваемых listings до восстановления. Unpublish по frozen API не должен сам отзывать существующие paid entitlements. Перед действием проверить актуальные issuance windows/paid state и поведение владельца/покупателей; согласовать точные archive IDs и синхронизацию archive/listing статусов. **Сейчас ни один статус не изменён.**

### Потенциальное удаление без коммерческих связей

Только **Cover E2E (1496a603…)** и **TestafterUIupdate (3d764ed0…)** могут быть предметом отдельного решения как тестовые архивы без intent/payment/entitlement/activation/license связей. Это не разрешение на DELETE: сохранить backup и учесть upload/listing/public-files/events/FK/cascade/immutability policy; предпочтительно сначала снять с публикации. Не удалять protected/source files или audit history автоматически.

**Payment Page Test (1e4598da…)** не включён в эту группу: несмотря на отсутствие оплаты, содержит пять historical PaymentIntent. Нужна отдельная retention/legal/audit оценка, а не предположение «без лицензий можно удалить».

### Нельзя удалять без отдельного решения по коммерческой истории

**Full Stack Live (08b035ed…), Multi Format (60ad6fed…), Test SolArch (a39fdcfb…)** имеют confirmed payments/Entitlements; последние два также DeviceActivation/DeviceLicense. Сохранить эти записи, immutable fingerprint/custody bindings, финансовую/audit историю. Два работающих архива также имеют реальные коммерческие связи и не являются кандидатами удаления.

## 9. План безопасного исправления после решения владельца

1. Согласовать точные ID, желаемое действие для каждого и период обслуживания; снять свежий приватный backup DB/storage и snapshot audit counts. Не использовать reset/db push/disable trigger.
2. Предпочесть поиск **исходных exact finalized .slr и matching encrypted custody** в retained локальных копиях/VM/backups. Этот аудит не утверждает, что exhaustive backup recovery невозможен: проверены authoritative paths и текущий VPS root, а не каждый внешний backup. Сравнить .slr SHA с неизменным DB fingerprint, trusted signature, encrypted custody identity/binding/authentication в отдельном approved процессе без вывода ACK.
3. Если exact bytes найдены, переносить приватно в persistent storage, сохранить старые immutable DB paths через согласованные ограниченные read-only filesystem mappings, проверить service-user access и persistence. Не превращать /tmp в постоянное хранилище и не обходить finalized-archive trigger; при невозможности безопасного mapping запросить решение, а не менять generatedSlrStorageKey.
4. Если bytes/custody отсутствуют, по отдельному разрешению unpublish проблемные listings и сохранить коммерческие records. Changed content требует **нового Archive ID**, это не восстановление оплаченного старого архива и не license transfer/reset.
5. Отдельно восстановить exact covers из backup либо согласовать корректную замену через existing cover API. Не считать починку картинки решением .slr проблемы.
6. Обсудить минимальную availability-consistency проверку catalog/detail/download как отдельный Backend issue: сверить контракт, добавить регрессии missing file, не вносить текущим read-only аудитом.
7. После одобренных изменений повторить sequential browser download/SHA/cover checks всех затронутых архивов и read-only relation counts. Новый report checkpoint и external review; никакой новой покупки без отдельного разрешения.

## 10. Проверки / границы результата

- RTK Git branch/index read-only; controlled SSH known-host, production units/current release, file stat/access/hash/findmnt, bounded native signature verify: выполнены.
- DB SELECT в read-only transaction, published coverage, relation counts/statuses, enabled finalized immutability trigger: выполнены.
- Real browser all eight detail pages + actual guest download click, full bytes/hash для двух успехов; один HTTP GET для каждой из трёх non-null covers: выполнены.
- Нет load testing/parallel download floods, SQL writes/DDL, plaintext decrypt/render, auth/private Data API probe, payments, license changes, service restarts, commit/push.
- Код не менялся: unit/build suites не запускались как замена live evidence. Создан **только этот новый report**; предыдущие незакоммиченные изменения не переписаны.

**Историческое завершение read-only аудита:** на этом этапе ожидалось решение владельца; production не изменялся. Полученное затем разрешение и выполненные действия — ниже.

## 11. Owner-authorized checkpoint — снятие шести неисправных архивов с публикации

**2026-10-10 UTC: preflight 11:47:13, commit maintenance transaction 11:49:14, итоговая DB/filesystem сверка 11:53:23. Статус операции: PASS.** Разрешение владельца ограничено unpublish ровно шести перечисленных IDs, без удаления, блокировки или отзыва лицензий. Старый аудит выше остаётся историческим evidence, а не утверждением о текущем published-состоянии.

### Preflight и приватный snapshot — PASS

- Все шесть targets имели `technical_status=ready`, а обе marketplace status записи — `published`. Два исправных архива `bf14ba07-15a6-4a3b-aabc-36d20e74cb37` и `690ac87c-1af1-444f-b2a4-8e6a74d5f2f4` исключены из allowlist и остались published.
- Не обнаружены pending/awaiting_finality intents, открытые TTL или active/unknown transaction issuances. Все шесть связанных issuance records уже terminal: consumed/expired/failed. Девять старых `created` intents Multi Format имеют истёкший TTL и не имеют issuance; они **не изменены**. Существующие confirmed purchases не являются неурегулированными платежами и сохранены.
- Legitimate owner session для API unpublish отсутствовала; использована явно разрешённая ограниченная admin DB maintenance через существующее приватное Backend connection, без подмены авторизации.
- До любых UPDATE создан, fsync и повторно проверен приватный snapshot полных затрагиваемых и связанных записей вне Git: `/var/backups/solarch/unpublish-six-20261010-CwDo46/before.json` на VPS. Размер **115074 bytes**, root-owned файл **0600**, приватный каталог **0700**. SHA-256: `eb9994b427bf0f5006c58d882da7f73130ed834c0a79f91143944fef14cb36be`. Snapshot содержит приватные DB records, не опубликован, не выведен в логи и не включён в Git; сохранён для восстановления/audit. Это дополнительный maintenance snapshot, не удаление или замена прежних backups.

### Атомарная операция — PASS

Одна транзакция с exact parameterized ID allowlist, проверкой прежних published-статусов и row counts **6 archives + 6 listings**. Короткая table-lock boundary исключила конкурентные записи в archives/listings и связанные коммерческие таблицы между snapshot, preflight recheck и commit. Lock/statement/transaction timeouts ограничены. Полное сравнение записей с ожидаемым результатом до commit требовало только 12 status изменений; любое несоответствие означало rollback. Analytics table не блокировалась.

| Archive ID | Название | archives status до → после | listing status до → после | Старый detail / download после |
| --- | --- | --- | --- | --- |
| 08b035ed-8002-4dad-b625-85b8bfce6f28 | Full Stack Live 20260917182107 | published → unpublished | published → unpublished | 404 / 404, ARCHIVE_NOT_AVAILABLE |
| 1496a603-5b9f-42d7-b96c-5fedbb44b0e6 | Cover E2E muchnm34 | published → unpublished | published → unpublished | 404 / 404, ARCHIVE_NOT_AVAILABLE |
| 1e4598da-8a63-4692-8897-949da12b68f1 | SolArch Payment Page Test | published → unpublished | published → unpublished | 404 / 404, ARCHIVE_NOT_AVAILABLE |
| 3d764ed0-e1ae-4b37-93da-4be67b36b3fa | TestafterUIupdate | published → unpublished | published → unpublished | 404 / 404, ARCHIVE_NOT_AVAILABLE |
| 60ad6fed-6d73-4a20-af54-71f901da2460 | SolArch Devnet Multi Format | published → unpublished | published → unpublished | 404 / 404, ARCHIVE_NOT_AVAILABLE |
| a39fdcfb-0626-4dd2-8171-538c03233435 | Test SolArch | published → unpublished | published → unpublished | 404 / 404, ARCHIVE_NOT_AVAILABLE |

Не изменены `technical_status`, fingerprint, content_key_ref, storage paths, price и даже `updated_at`. Не выполнялись DELETE/DROP/reset, DDL/migrations, block/revoke, trigger disable, payments или license mutations. `archives_finalized_content_immutable` остаётся enabled (`O`).

### Реальный браузер и public HTTP — PASS

- Production `/catalog` в настоящем Playwright браузере, без MSW, показывает **ровно две карточки**, одна страница: Test New Archive и fgfdgfdgd. Независимый catalog HTTP GET: **200, total=2, total_pages=1**.
- Открыты все шесть старых frontend URLs из таблицы исходного аудита. Каждая backend detail response — **404 ARCHIVE_NOT_AVAILABLE**; браузер показывает **“This archive is not available”**, download link отсутствует. Frontend SPA document может иметь HTTP 200 — это не доступ к архиву и не PASS скачивания.
- Все шесть прежних download URLs независимо запрошены последовательно: **404 ARCHIVE_NOT_AVAILABLE**, JSON, ни одного публичного `.slr` response. Покупки не выполнялись.
- У двух оставшихся архивов нажаты реальные guest download buttons без Authorization; browser download завершён без failure. Ответы **200**, `Content-Type: application/x-solarch`, attachment filename `.slr`. По всем скачанным байтам вычислен SHA-256, совпадающий с неизменным DB fingerprint и повторным filesystem SHA VPS:

| Archive ID / title | Browser bytes | Browser / DB / VPS SHA-256 | Результат |
| --- | ---: | --- | --- |
| bf14ba07-15a6-4a3b-aabc-36d20e74cb37 / Test New Archive | 2853209 | 799b497e212beefb368c193df11aebd968742cc9abdc2b87993d566e47f8159c | PASS |
| 690ac87c-1af1-444f-b2a4-8e6a74d5f2f4 / fgfdgfdgd | 64201 | d1c64fab0808d723ae329963013c306c373c099132d76c23c5c78a7f808265f0 | PASS |

### Сохранность DB и filesystem — PASS для maintenance, не восстановление missing content

После браузерных проверок выполнена отдельная read-only DB transaction. Полные records всех перечисленных ниже таблиц сравнивались со snapshot, разрешая **только** две marketplace status колонки у exact allowlist. Сравнение PASS для каждой таблицы, не только совпадение counts: immutable values и коммерческие records без изменений.

| Таблица | До | После |
| --- | ---: | ---: |
| archives | 8 | 8 |
| archive_listings | 8 | 8 |
| archive_public_files | 15 | 15 |
| uploads | 8 | 8 |
| payment_intents | 32 | 32 |
| payment_transaction_issuances | 9 | 9 |
| payments | 7 | 7 |
| entitlements | 7 | 7 |
| device_activations | 6 | 6 |
| device_licenses | 6 | 6 |
| request_nonce_records | 21 | 21 |

Штатные `marketplace_events` изменились **55→59** после двух просмотров и двух успешных скачиваний; эта analytics table намеренно исключена из требования byte-identical records. Никакая коммерческая запись maintenance или browser smoke не создана/изменена.

Повторная проверка exact DB paths: оба published `.slr` существуют и SHA совпадает; соответствующие `.ack.enc` существуют. У всех шести unpublished архивов исторический `.slr` и matching persistent custody по-прежнему отсутствуют. Их missing content и два отсутствующих covers **не восстановлены** снятием с публикации.

**Итог:** unpublish и проверки **PASS**; оставшийся публичный каталог **2 PASS / 0 FAIL / 0 UNKNOWN**. Шесть исторических missing `.slr` остаются неисправными, но больше не предлагаются публично. Для оплаченных Full Stack Live, Multi Format и Test SolArch сохраняется нерешённая availability/custody gap: сохранение Payment/Entitlement/License не означает возможность восстановить ACK или открыть отсутствующие bytes. Unpublish сам по frozen API не отзывает paid Entitlement, однако этот checkpoint не доказывает успешный licensed reopen/refresh этих отсутствующих архивов. Восстановление exact originals/custody или другое решение требует отдельного согласования; никакого rebuild того же Archive ID или удаления записей.

Из локальных файлов в этом checkpoint изменён **только данный report**; исходники и contracts не менялись. `rtk git diff --check` — **FAIL (exit 2)** на существующем dirty tree: whitespace/CRLF diagnostics в 375 ранее изменённых файлах. Их нормализация вне scope и не выполнялась. Отдельная проверка данного report: trailing whitespace отсутствует, final newline есть; staged index пуст. Этот локальный housekeeping failure не меняет результаты production DB/browser проверок. Нет commit/push/staging, перезапуска сервисов или покупки. Операция завершена, ожидается дальнейшее решение владельца.
