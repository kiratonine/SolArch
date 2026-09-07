# SolArch — общая документация проекта

Эта папка содержит общие договорённости команды SolArch. Документы предназначены для всех трёх веток разработки и являются общей точкой согласования интерфейсов между Archive Core/Viewer, Marketplace Frontend и Marketplace Backend.

## 1. Проект

**Название:** SolArch  
**Формат защищённого контейнера:** `.slr`  
**Основной сценарий:** защищённый цифровой контент можно свободно скачать и передать, но открыть его можно только после подтверждённой оплаты, получения Entitlement и активации device-bound license.

Ключевая цепочка:

```text
Discover
→ Inspect
→ Download .slr
→ Open in SolArch Viewer
→ Pay USDC
→ Verify on backend
→ Entitlement
→ Device License
→ Protected View
```

## 2. Командные ветки

```text
feat/archive-core-viewer
feat/marketplace-frontend
feat/marketplace-backend
```

Зоны ответственности описаны в отдельных role-файлах команды.

## 3. Общие документы

Читайте в таком порядке:

1. `SPEC.md` — утверждённый продуктовый и MVP scope.
2. `ARCHITECTURE.md` — компоненты, trust boundaries и связи.
3. `API.md` — контракты Marketplace Frontend и Viewer с Backend.
4. `SLR_FORMAT.md` — формат `.slr` и требования к контейнеру.
5. `DATA_MODEL.md` — общая модель PostgreSQL.
6. `PAYMENTS.md` — USDC payment flow, split 95/5, fee sponsorship и ATA.
7. `SECURITY.md` — security rules и threat model.
8. `INTEGRATION.md` — точки интеграции трёх веток.
9. `TESTING.md` — обязательные unit, integration и end-to-end проверки.

## 4. Приоритет документов

Если локальное решение в одной ветке противоречит этим общим документам, разработчик не должен молча менять общий контракт.

Порядок действий:

```text
1. Зафиксировать конфликт.
2. Согласовать решение всей командой.
3. Обновить соответствующий общий документ.
4. Только после этого менять реализацию.
```

## 5. Неизменяемые продуктовые решения MVP

```text
Product name = SolArch
Container extension = .slr
Payment asset = USDC only
Archive price = immutable after creation
Platform fee = 5%
Creator share = 95%
SolArch share = 5%
Buyer pays only archive price
SolArch pays Solana network fees
SolArch automatically creates creator USDC ATA if required
No custodial creator wallet
No creator balance / withdrawal system
Public metrics = views + downloads + paid unlocks
Supported protected content = PDF + images + DOCX + XLSX
No video/audio in MVP
```

## 6. Главный Definition of Done проекта

Проект готов к hackathon demo, когда команда может показать один реальный A-to-Z flow:

```text
Creator creates archive
→ uploads supported files
→ sets immutable USDC price
→ publishes archive
→ guest opens Marketplace
→ sees public file listing and metrics
→ downloads .slr without registration
→ opens .slr in Viewer
→ pays USDC
→ one transaction sends 95% to creator and 5% to SolArch
→ SolArch pays network fee
→ backend verifies payment
→ Entitlement is created
→ Device A receives license
→ protected content opens with watermark
→ same .slr on Device B is rejected when max_devices = 1
```
