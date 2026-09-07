# SolArch — Branch Integration Contract

---

## 1. Purpose

Этот документ позволяет трём разработчикам работать независимо до merge.

Branches:

```text
feat/archive-core-viewer
feat/marketplace-frontend
feat/marketplace-backend
```

Главное правило:

> Каждая ветка должна зависеть от согласованного интерфейса, а не от незавершённой внутренней реализации другой ветки.

---

## 2. Ownership boundaries

### Archive branch owns

```text
crates/solarch-core
crates/solarch-cli
apps/viewer
```

### Frontend branch owns

```text
apps/web
```

### Backend branch owns

```text
apps/api
database migrations
storage/payment/license server logic
```

Общие config/types могут быть вынесены в shared package только после согласования.

---

## 3. Frontend ↔ Backend integration

Frontend использует отдельный API client.

До готового Backend:

- mock server;
- fixtures;
- typed DTO.

Запрещено в компонентах предполагать DB schema.

Source of truth:

```text
docs/API.md
```

### Required integration flows

```text
catalog
archive detail
guest download
creator login
create archive
upload
publish/unpublish
analytics
```

---

## 4. Viewer ↔ Backend integration

Viewer network adapter должен покрывать:

```text
get current archive metadata
create payment intent
submit/check payment verification
activate device
check license
```

До готового Backend:

- mock API;
- deterministic test entitlement/license;
- fake payment status only inside development test adapter.

Production/demo adapter не должен принимать client-side fake success.

---

## 5. Backend ↔ `solarch-core`

Backend не реализует `.slr` crypto в TypeScript.

Shared integration interface:

```text
ArchiveBuilder
```

Conceptual input:

```json
{
  "archive_id": "arc_...",
  "input_directory": "...",
  "metadata_file": "...",
  "output_file": "..."
}
```

Conceptual output:

```json
{
  "success": true,
  "output_path": "...",
  "archive_fingerprint": "...",
  "file_count": 14,
  "size_bytes": 12345678
}
```

Реализация может использовать CLI process call.

До merge Archive branch Backend uses mock/stub.

---

## 6. Backend ↔ Viewer cryptographic contract

Нужно согласовать до интеграции:

```text
device public key encoding
license payload schema
license signature encoding
wrapped content key format
archive fingerprint encoding
```

Эти поля нельзя придумывать независимо в двух ветках.

Рекомендуется создать shared test fixtures:

```text
fixtures/device-key/
fixtures/license/
fixtures/slr/
```

---

## 7. Public Header ↔ Backend consistency

Archive generation получает immutable snapshot:

```text
archive_id
price
currency
platform_fee_bps
license policy
creator identity snapshot
```

Viewer compares important fields with Backend state.

If mismatch:

```text
do not initiate payment
show archive metadata mismatch/integrity error
```

---

## 8. Supported content contract

Backend validation and Viewer support must agree on exactly:

```text
PDF
PNG
JPG/JPEG
WebP
DOCX
XLSX
```

Backend should not publish a protected archive containing file types that Viewer cannot render in MVP.

---

## 9. Status contract

Use shared values.

Technical:

```text
draft
uploading
processing
ready
failed
```

Marketplace:

```text
draft
published
unpublished
blocked
```

Payment:

```text
created
pending
confirmed
expired
failed
```

License:

```text
active
expired
revoked
```

Do not invent alternative strings in one branch.

---

## 10. Money contract

All branches use:

```text
currency = USDC
platform_fee_bps = 500
```

API money is decimal string.

Backend alone performs authoritative integer/base-unit calculations.

Frontend may show a preview calculation but must render backend economics response after create.

Viewer renders amount from Backend payment intent.

---

## 11. Analytics contract

Public metrics names:

```text
views
downloads
paid_unlocks
```

Creator metrics extend with:

```text
gross
creator
platform
view_to_download
download_to_purchase
```

Frontend does not generate counts itself.

---

## 12. Merge order

Recommended integration order:

```text
1. Merge common docs and monorepo skeleton.
2. Backend exposes stable mock/real API.
3. Frontend integrates API.
4. Core exposes CLI/test vectors.
5. Backend replaces ArchiveBuilder mock.
6. Viewer integrates real payment/license API.
7. Full E2E.
```

Actual Git merge order can vary, but interface compatibility must be tested.

---

## 13. Integration checklist

Before final merge:

### Frontend + Backend

- catalog response matches;
- archive page response matches;
- guest download works;
- auth works;
- create/upload/publish works;
- analytics matches.

### Backend + Core

- generated `.slr` exists;
- fingerprint returned;
- source files correctly packed;
- failures update status.

### Viewer + Core

- valid `.slr` opens;
- invalid `.slr` fails;
- supported renderers work.

### Viewer + Backend

- payment intent works;
- QR transaction works;
- payment verification works;
- entitlement returned;
- device activation works;
- wrapped key unlocks archive.

---

## 14. Conflict policy

If implementation requires changing shared API/format:

```text
1. Open/describe conflict.
2. Agree with affected owner.
3. Update docs first.
4. Add/adjust contract test.
5. Change implementation.
```

No silent breaking contract changes.
