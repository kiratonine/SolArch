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
- exact Solana Pay URL contains no client secret;
- transaction-request GET/POST DTOs;
- fresh recent blockhash after prior issuance validity ends;
- no new issuance at/after intent expiry;
- one active issuance and idempotent same-account POST;
- different account rejected while an issuance remains valid;
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


## Integration Gate 01 cross-branch vectors

[INTEGRATION.md §15](INTEGRATION.md#15-deterministic-interoperability-vectors) owns deterministic synthetic byte vectors for final-file fingerprint, signature preimage/SIG1, device X25519 key, JCS license, Ed25519 envelope signature and RFC 9180 HPKE. They are documentation values, not production secrets or proof of an implemented release. Core and Backend must independently reproduce them before integration after external review.

Required future negative cases: duplicate/unknown JSON fields, invalid UTF-8/JCS, noncanonical Base64/pad bits/hex/key coordinates, low-order/all-zero DH, wrong device/key role, swapped HPKE wrapper, modified info/AAD/nonce/rights/fingerprint, signature metadata mutation, stale grant/new request nonce, expiry/clock rollback/Backend unavailable, and concurrent Device B activation. Test every numeric SLR_FORMAT limit at boundary and above, including metadata cap with valid individual paths, zero-sized files and per-file chunk rounding. Container verification must stream 1 GiB without a whole-file allocation; an UNVERIFIED structural inspect result is not signature verification.

Payment/device tests must prove: intent binds Device A before payment; confirmed
transaction derives `buyer_wallet` server-side; a different wallet may pay without
changing Device A; post-payment key substitution and Device B fail; intent secret
alone cannot change its binding; refresh token works only for its exact
entitlement/license/archive/device; IDs, transaction signature, wallet and public
key alone do not authorize; token values never reach logs/URL/QR/telemetry.

Payment lifetime tests must prove: intent response has the exact secret-free
`solana_pay_url` and no serialized transaction; public GET/POST follow the Solana
Pay DTO; POST `account` is not buyer authorization; each replacement issuance has
a current blockhash and the same immutable reference/95/5 economics; at most one
issuance is blockhash-valid; expiry stops new issuance. Commitment tests must prove that transaction construction obtains
`getLatestBlockhash` at `confirmed`, while this does not authorize access.
A `processed` payment remains informational/pending. A `confirmed` payment remains
`awaiting_finality` and creates no Payment, Entitlement, Device License or Content
Key release. Only `confirmationStatus == finalized` together with
`meta.err == null` and the complete verification checklist may transition the
intent to `confirmed` and atomically create Payment + Entitlement. A pre-expiry issuance
landed within its own validity must progress `pending -> awaiting_finality ->
confirmed` after wall-clock expiry and atomically create exactly one Entitlement.
Unissued/modified/reference-only transactions and transactions landed after their
recorded validity must fail without Entitlement **and without changing intent or
issuance state**. Inject DB/service failure after finality and at every confirmation
write: the whole transaction rolls back to retryable `awaiting_finality`, then the
reconciler commits exactly one Payment, Entitlement and event. Exercise required
UNIQUE constraints under concurrency. Repeat POST, signature submission, polling
and finalization concurrently to prove idempotence.

Prove authoritative terminal chain failure permits immediate reissue before
TTL/policy stop, while dropped/reorged/non-final observations require the prior
window to close. Race cancellation/block against submission: no new issuance is
created, terminal failure waits for all live windows, and any eligible landed
issuance still reaches exactly one Payment/Entitlement after finality.

Deliver the identical activation/refresh `request_nonce` twice and concurrently:
exactly one request may perform issuance; every duplicate returns
`REQUEST_NONCE_REPLAY` without rotating a token or producing a second grant.
Intentional recovery with a fresh nonce remains serialized and succeeds only for
the same Device A.

License tests use exact `issued_at + 72 hours`: local offline open succeeds before
the exclusive deadline, boundary/after requires refresh, active refresh produces
a new signed window/W, revoked/expired/blocked/wrong-device fail, and unavailable
Backend after expiry denies. Exercise same-process monotonic and cross-restart
secure high-water rollback detection, including the 300-second tolerance, while
documenting that it is best-effort rather than a trusted clock.
Reject issuance whose proposed offline deadline exceeds any known authoritative
Entitlement/License expiry. Keep a renderer open across the deadline and verify it
closes, drops plaintext and zeroizes ACK/derived keys at the boundary.

Synthetic crypto round-trips and mocked Entitlements do not demonstrate real
payment verification or credential authorization. Windows secure storage,
trusted release distribution and native Viewer offline/clock behavior require
later Windows-native validation; none is inferred from a documentation/vector
check.
