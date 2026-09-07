# SolArch — Shared Testing Strategy

---

## 1. Goal

Тестирование должно доказывать не только работу отдельных компонентов, но и главный продуктовый promise:

```text
downloadable/copyable .slr
≠
transferable access right
```

Главный test target — реальный A-to-Z flow.

---

## 2. Test layers

```text
Unit
Integration
Contract
E2E
Security
Manual demo
```

Каждая ветка отвечает за свои unit/integration tests, но финальный E2E общий.

---

## 3. Archive Core unit tests

Покрыть:

- magic/version parser;
- header serialization;
- manifest encryption/decryption;
- chunk encryption/decryption;
- invalid authentication tag;
- corrupted chunk;
- hash/fingerprint;
- container signature;
- invalid signature;
- unsupported version;
- safe paths;
- duplicate normalized paths.

---

## 4. Viewer tests

Покрыть:

- locked state;
- public header display;
- device key creation;
- secure-store adapter;
- license signature validation;
- wrong device rejection;
- supported file routing;
- PDF renderer;
- image renderer;
- DOCX renderer;
- XLSX renderer;
- watermark display;
- no export action in protected mode.

### 4.1 Viewer localization tests

Проверить:

- Russian locale загружается без missing required keys;
- English locale загружается без missing required keys;
- обязательные localization keys существуют в обеих locale;
- locked state корректно отображается на Russian и English;
- payment states корректно отображаются на Russian и English;
- device/license states корректно отображаются на Russian и English;
- backend/error states корректно отображаются на Russian и English;
- PDF/image/DOCX/XLSX viewer controls корректно отображаются на Russian и English;
- выбранный язык сохраняется между restart;
- переключение Russian ↔ English применяется без переустановки;
- protected content не изменяется при переключении locale;
- creator-provided title/description/file names не переводятся автоматически;
- production UI не зависит от отдельной Russian/English версии компонентов.

---

## 5. Frontend tests

Покрыть:

- archive card;
- public metrics;
- catalog states;
- archive page;
- immutable price notice;
- 95/5 breakdown;
- payout wallet field;
- upload states;
- publish/unpublish UI;
- analytics rendering;
- error/loading/empty states.

---

## 6. Backend unit tests

Покрыть:

- immutable price enforcement;
- exact 5% fee calculation;
- creator 95% share;
- rounding/base units;
- payout wallet validation helpers;
- ATA derivation;
- payment intent;
- wrong amount;
- wrong creator recipient;
- wrong platform recipient;
- wrong mint;
- replay;
- idempotent verify;
- Entitlement creation;
- max_devices = 1;
- analytics calculations;
- popularity sorting.

---

## 7. API contract tests

Ensure response fields match `API.md`.

At minimum:

```text
POST /archives
GET marketplace list
GET marketplace archive
GET public files
GET .slr download
POST payment intent
POST verify
POST activate device
GET analytics
```

Breaking field changes fail contract tests.

---

## 8. Core/Backend contract tests

Use stable fixture.

Backend calls ArchiveBuilder and verifies:

```text
success
output exists
fingerprint returned
file count
size
```

Core provides deterministic test fixtures for parser compatibility.

---

## 9. Payment integration tests

Test matrix:

| Case | Expected |
|---|---|
| Correct 95/5 USDC tx | Confirmed |
| Wrong creator amount | Rejected |
| Wrong platform amount | Rejected |
| Missing creator transfer | Rejected |
| Missing platform transfer | Rejected |
| Wrong creator ATA | Rejected |
| Wrong SolArch ATA | Rejected |
| Wrong mint | Rejected |
| Failed transaction | Rejected |
| Replay signature | No duplicate entitlement |
| Repeated verify | Idempotent |
| Fee payer unavailable | Clear failure, no false payment |

---

## 10. Analytics integration tests

Verify:

```text
archive_view → views +1 according to dedupe rules
archive_download → downloads +1
payment_confirmed → paid_unlocks +1
```

Must not increment paid unlocks for:

```text
QR created
tx signed only
signature submitted but unverified
failed tx
```

---

## 11. Device license E2E

Mandatory:

```text
1. Pay archive.
2. Entitlement created with max_devices = 1.
3. Device A activates.
4. Device A opens content.
5. Same entitlement tries Device B.
6. Backend returns DEVICE_LIMIT_REACHED.
7. Device B cannot unwrap content key.
```

---

## 12. Full hackathon E2E

### Creator side

```text
1. Login.
2. Create archive.
3. Set 10 USDC.
4. Set payout wallet.
5. Upload PDF + image + DOCX + XLSX.
6. Backend prepares creator ATA if needed.
7. Archive processes to ready.
8. Publish.
```

### Marketplace side

```text
9. Guest opens listing.
10. Views metric records.
11. Guest sees public file listing.
12. Guest downloads .slr.
13. Downloads metric records.
```

### Viewer/payment side

```text
14. Open .slr.
15. Viewer shows Locked and 10 USDC.
16. Buyer receives payment transaction/QR.
17. Buyer signs.
18. Creator receives 9.50 USDC.
19. SolArch receives 0.50 USDC.
20. SolArch pays network fee.
21. Backend verifies transaction.
22. paid_unlocks increments.
23. Entitlement created.
24. Device A activates.
25. Viewer opens protected files.
26. Watermark visible.
27. Reopen archive on Device A succeeds.
28. Device B is rejected.
```

---

## 13. Security tests

Required:

```text
path traversal archive
zip bomb limit
corrupted .slr
modified public header
modified manifest
invalid signature
forged license
wrong device key
wrong payment amount
wrong recipient
wrong mint
replay
public source-file access attempt
blocked archive download
```

---

## 14. Manual demo checklist

Before presentation:

- clean machine/session tested;
- SolArch fee payer funded;
- creator payout wallet valid;
- creator ATA exists or auto-create path tested;
- buyer has enough USDC;
- RPC reachable;
- backend health green;
- Viewer installer/file association works;
- sample `.slr` backup prepared;
- sample creator archive prepared;
- Device B test prepared;
- no secrets shown on screen.
- installer предлагает Russian / English;
- установка с Russian проверена;
- установка с English проверена;
- выбранный installer language становится initial Viewer language;
- language preference сохраняется после restart;
- Russian ↔ English switch в Settings проверен;

---

## 15. Definition of Done

Final branch merge only after:

```text
all branch unit tests pass
all contract tests pass
payment negative tests pass
full E2E passes
Device B rejection passes
Viewer Russian/English localization tests pass
Windows installer language-selection flow passes
manual demo rehearsed
```

If one of the critical A-to-Z steps is mocked, the team must explicitly know and disclose it; do not silently present mock behavior as real blockchain/security functionality.
