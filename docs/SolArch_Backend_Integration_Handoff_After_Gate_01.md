# SolArch — Backend ↔ Archive Core ↔ Viewer Integration Handoff
## After `INTEGRATION_GATE_01`

**Status:** APPROVED CONTRACT HANDOFF  
**Integration Gate:** `INTEGRATION_GATE_01 = PASS`  
**Target Backend branch:** `feat/marketplace-backend`  
**Archive/Core/Viewer branch:** `feat/archive-core-viewer`

---

# 1. Зачем этот файл

Этот файл нужен Backend-разработчику после завершения `INTEGRATION_GATE_01`.

Он кратко объясняет, какие общие Backend ↔ Archive Core ↔ Viewer contracts уже
зафиксированы и что Backend должен реализовать совместимо с ними.

## Важно

Этот файл — **handoff/guide**, а не новый источник истины.

Если этот файл и `docs/*` когда-либо расходятся:

```text
актуальные source-of-truth docs имеют приоритет
```

Не менять wire/crypto/API contract локально в Backend-ветке без согласованного
изменения общих docs.

---

# 2. Обязательные source-of-truth документы

Перед реализацией Backend-разработчик должен прочитать актуальные:

```text
docs/API.md
docs/PAYMENTS.md
docs/SLR_FORMAT.md
docs/SECURITY.md
docs/INTEGRATION.md
docs/DATA_MODEL.md
docs/DECISIONS.md
docs/TESTING.md
docs/ARCHITECTURE.md
docs/roles/03_MARKETPLACE_BACKEND.md
docs/roles/01_ARCHIVE_CORE_AND_VIEWER.md
```

Особенно важны:

```text
docs/API.md §§6–10
docs/PAYMENTS.md §§6–12
docs/INTEGRATION.md §§5–7, §15
docs/SLR_FORMAT.md
docs/SECURITY.md trust/custody sections
docs/DECISIONS.md ADR-019–022
```

---

# 3. Главная product/security модель

Зафиксировано:

```text
Download/copy .slr != право открыть protected content
```

Основной flow:

```text
.slr
→ SolArch Viewer
→ Device A identity
→ device-bound Payment Intent
→ Solana Pay USDC
→ Backend authoritative verification
→ Payment
→ Entitlement bound to Device A
→ Device License
→ device-bound wrapped Content Key
→ local protected viewing
```

Разделение обязательно:

```text
Payment != Entitlement != Device License != Content Key
```

Backend остаётся authoritative для:

```text
archive state
payment verification
Entitlement
max_devices
device/license state
revocation
```

Viewer не определяет самостоятельно, что payment прошёл.

---

# 4. В MVP нет buyer account / wallet login

Не реализовывать:

```text
buyer SolArch account
buyer login
wallet challenge при activation
wallet signMessage при reopen/refresh
buyer session
device transfer/reset
```

Покупатель взаимодействует с wallet только в Solana Pay payment flow.

`buyer_wallet` Backend получает только из authoritative подтверждённой Solana
transaction.

Viewer-supplied wallet address не является:

```text
authentication
authorization
proof of entitlement
```

Другой человек/wallet может оплатить QR Device A. Это допустимо:

```text
buyer_wallet = wallet, реально оплативший transaction
access device = immutable Device A из Payment Intent
```

Оплата не переносит access на компьютер плательщика.

---

# 5. Device A фиксируется ДО оплаты

Viewer создаёт device X25519 keypair локально.

Backend получает только:

```text
device_public_key
```

Device private key никогда не покидает устройство.

`POST /v1/payment-intents` принимает:

```json
{
  "archive_id": "arc_...",
  "device_public_key": "<canonical X25519 B64>"
}
```

До выдачи QR Backend immutably связывает Payment Intent минимум с:

```text
payment_intent_id
archive_id
archive_fingerprint
device_public_key = Device A
immutable USDC price
platform_fee_bps = 500
95/5 recipients/amounts
unique Solana payment reference
created_at
expires_at
```

После оплаты запрещено:

```text
Device A -> Device B replacement
post-payment device selection
reuse Payment/Entitlement for another device
```

MVP:

```text
max_devices = 1
```

---

# 6. Payment Intent private credential

Backend создаёт:

```text
payment_intent_client_secret
```

Exact format:

```text
TOKEN32
32 CSPRNG bytes
RFC 4648 base64url without padding
exactly 43 ASCII chars
```

Raw secret:

```text
не хранится в DB
не попадает в QR
не попадает в URL/query
не попадает в .slr
не логируется
не попадает в telemetry
не передаётся через argv/Git
```

Backend хранит purpose-separated keyed HMAC representation согласно `docs/API.md §9.1`.

Viewer должен сохранить secret через Windows secure storage **до показа QR**.

Initial activation использует:

```http
Authorization: SolArchIntent <payment_intent_client_secret>
```

---

# 7. Solana Pay transaction-request flow

Payment Intent response НЕ содержит одну заранее созданную transaction на все 30 минут.

Он возвращает:

```text
solana_pay_url
payment_intent_client_secret
```

QR содержит только:

```text
solana:<absolute HTTPS transaction-request endpoint>
```

Private intent credential в QR отсутствует.

Canonical endpoint:

```text
GET/POST /v1/solana-pay/payment-intents/:paymentIntentId/transaction
```

## GET

Возвращает public Solana Pay metadata:

```json
{
  "label": "SolArch",
  "icon": "https://<trusted-domain>/assets/..."
}
```

Не раскрывает:

```text
secret
device key
buyer
amount/economics beyond what contract allows
Entitlement
private state
```

## POST

Wallet передаёт:

```json
{
  "account": "<canonical Solana public key>"
}
```

`account` — только input для построения transaction.

Он НЕ является buyer authorization.

---

# 8. Transaction construction

Backend строит transaction только из trusted immutable Payment Intent data.

Для каждого допустимого issuance:

```text
getLatestBlockhash commitment = confirmed
```

Backend сохраняет:

```text
recent blockhash
lastValidBlockHeight
message hash
canonical wallet account
issuance time/state
```

`confirmed` здесь нужен только для fresh blockhash.

Он **не** является payment authorization threshold.

Transaction содержит:

```text
USDC only
immutable archive price
creator transfer = 95%
SolArch transfer = 5%
unique payment reference
buyer debit signer
SolArch fee payer
```

SolArch оплачивает network fees.

Backend должен поставить валидную SolArch fee-payer signature.

Wallet добавляет только свою требуемую buyer signature и не должен менять
transaction message / fee payer / recent blockhash.

Нельзя иметь несколько одновременно payable variants одного intent.

---

# 9. Payment Intent lifetime

Intent:

```text
expires_at = created_at + 1800 seconds
```

30-minute deadline означает:

```text
после expires_at нельзя выдавать НОВУЮ Solana transaction
```

Это НЕ означает:

```text
уже landed payment перестаёт существовать
```

Transaction, выданная до expiry и landed внутри собственного
`lastValidBlockHeight`, продолжает отслеживаться до authoritative result даже
после `expires_at`.

---

# 10. Exact production Solana commitment policy

Для MVP contract фиксирован:

```text
transaction construction:
getLatestBlockhash commitment = confirmed
```

Payment observation:

```text
processed
→ informational/pending only
→ NO Payment
→ NO Entitlement
→ NO Device License
→ NO Content Key

confirmed
→ awaiting_finality only
→ NO Payment
→ NO Entitlement
→ NO Device License
→ NO Content Key

finalized
→ authoritative payment threshold
```

Но даже `finalized` недостаточно само по себе.

Backend создаёт Payment + Entitlement только если:

```text
confirmationStatus == finalized
AND meta.err == null
AND полный SolArch verification checklist PASS
```

Полный checklist находится в:

```text
docs/PAYMENTS.md §10
docs/API.md §8
```

Нельзя ослаблять production contract до `confirmed`.

Test/mock environment может иметь отдельный non-production override, но такой
прогон не считается real USDC E2E.

---

# 11. Authoritative transaction verification

Transaction signature сама по себе ничего не доказывает.

Backend обязан проверить минимум:

```text
transaction exists
meta.err == null
confirmationStatus == finalized
correct Solana network
correct configured USDC mint

exact Backend-issued message hash
landing inside issued lastValidBlockHeight
exact Payment Intent reference

exact immutable total price
creator recipient
creator amount = 95%
platform recipient
platform amount = 5%

buyer source token account
buyer signer/authority
buyer_wallet derived server-side

no replay
transaction_signature UNIQUE
payment intent belongs to same archive
exact pre-payment Device A binding
```

Reference-only, modified, unissued или late transaction не создаёт side effects.

---

# 12. Payment → Entitlement atomicity

После successful finalized verification:

```text
payment intent -> confirmed
Payment -> created
Entitlement -> created
Device A -> copied from Payment Intent
payment_confirmed durable event -> created
```

Это одна atomic DB/service transaction.

Обязательная идемпотентность/uniqueness:

```text
payments.transaction_signature UNIQUE
payments.payment_intent_id UNIQUE
entitlements.payment_id UNIQUE
one Entitlement per paid intent/payment
one Device A per Entitlement for MVP
```

DB/service failure после blockchain finality:

```text
НЕ превращает paid transaction в expired/failed
```

Остаётся:

```text
awaiting_finality / reconciliation
```

до успешного atomic commit.

---

# 13. Payment verification endpoint

Canonical Viewer endpoint:

```text
POST /v1/payment-intents/:paymentIntentId/verify
```

Auth:

```http
Authorization: SolArchIntent <payment_intent_client_secret>
```

Viewer передаёт:

```json
{
  "device_public_key": "<Device A>",
  "transaction_signature": "<optional lookup hint>"
}
```

Transaction signature:

```text
не credential
не authorization
```

Backend всё равно сам получает authoritative transaction и проверяет её.

Expected payment states:

```text
pending
awaiting_finality
confirmed
expired
failed
```

---

# 14. Entitlement и initial activation

Entitlement создаётся только после successful finalized payment.

Device A:

```text
Entitlement.device_public_key
=
PaymentIntent.device_public_key
```

Initial activation:

```text
POST /v1/payment-intents/:paymentIntentId/activate-device
```

Auth:

```http
Authorization: SolArchIntent <payment_intent_client_secret>
```

Request содержит:

```text
device_public_key
device_name
viewer_version
fresh request_nonce
```

Backend обязан проверить exact Device A.

Нельзя принять replacement key.

---

# 15. Device refresh credential

При initial activation Backend выдаёт отдельный:

```text
device_refresh_token
```

Format:

```text
TOKEN32
32 CSPRNG bytes
43-char unpadded base64url
```

Backend хранит только purpose-separated keyed HMAC representation.

Server-side binding минимум:

```text
entitlement_id
license_id
archive_id
device_public_key
active/revoked state
```

Viewer хранит token через Windows secure storage.

Refresh endpoint:

```text
POST /v1/device-licenses/:licenseId/refresh
```

Auth:

```http
Authorization: DeviceRefresh <device_refresh_token>
```

Token не может:

```text
создать Device B
заменить Device A
изменить Entitlement binding
```

Даже при краже token wrapped ACK остаётся HPKE-bound к Device A private key.

---

# 16. Device key encoding

Device key:

```text
X25519
raw public key = 32 bytes
RFC 7748 little-endian u-coordinate
```

API encoding:

```text
RFC 4648 standard Base64
canonical padding
exactly 44 chars
ends with "="
```

Не base64url.

Backend должен strict-decode, re-encode и требовать exact textual equality.

Reject:

```text
noncanonical coordinate
invalid/low-order/all-zero DH cases
wrong length
alternate Base64 form
```

Device private key никогда не приходит Backend.

---

# 17. Device License — 72h offline model

Signed license payload `P` содержит минимум authoritative поля из `docs/API.md §9.4`:

```text
version
key_id
license_id
entitlement_id
archive_id
archive_fingerprint
buyer_wallet
device_public_key
status = active
issued_at
offline_valid_until
request_nonce
rights
```

Offline contract:

```text
offline_valid_until
=
issued_at + exactly 259200 seconds
=
72 hours
```

До deadline Viewer может открыть архив без Backend.

После deadline:

```text
новый unlock требует successful Backend refresh
```

Backend unavailable после expiry:

```text
deny until refresh succeeds
```

Revocation во время offline window может быть замечена не позднее следующего
mandatory refresh.

Это сознательный practical/best-effort DRM tradeoff.

---

# 18. Rights

MVP signed rights:

```json
{
  "open": true,
  "export": false,
  "max_devices": 1,
  "watermark_enabled": true
}
```

Backend не должен выдавать license, которая ослабляет эти значения.

---

# 19. License canonicalization/signature

Crypto JSON:

```text
RFC 8785 JCS
```

Reject:

```text
duplicate fields
unknown fields
missing fields
invalid Unicode
unexpected nulls
unsupported literal values
```

License construction order:

```text
P
→ L = JCS(P)
→ HPKE wrap ACK => W
→ Q = JCS({
     "payload": P,
     "wrapped_content_key": W
   })
→ Ed25519 signature
```

License signature:

```text
pure Ed25519
separate license-role key
domain = SolArch/license-signature/v1 + NUL
```

Signature authenticates:

```text
P + complete W envelope
```

Backend must not sign only the license metadata while leaving wrapped key unsigned.

Archive-role and license-role signing keys are separate.

---

# 20. Wrapped Content Key / ACK

ACK:

```text
32 random bytes
```

Plaintext ACK никогда не помещается в `.slr`.

Device wrapping:

```text
RFC 9180 HPKE Base mode
DHKEM(X25519, HKDF-SHA256) kem_id=32
HKDF-SHA256 kdf_id=1
AES-256-GCM aead_id=2
```

Exact W:

```text
version = 1
kem_id = 32
kdf_id = 1
aead_id = 2
enc = standard padded Base64 of 32 bytes
ciphertext = standard Base64 of 48 bytes
```

Exact info/AAD/domain rules — `docs/API.md §9.6`.

Каждый response:

```text
fresh ephemeral KEM key
fresh HPKE context
exactly one Seal
discard context after use
```

Не создавать собственный X25519/HKDF wrapping protocol.

---

# 21. 72-hour refresh

Refresh возвращает:

```text
fresh signed P
fresh HPKE W
fresh issued_at
fresh offline_valid_until = issued_at + 72h
```

Refresh token в v1 не ротируется самим refresh response.

Backend должен проверить:

```text
token valid
exact license
exact Entitlement
exact archive
exact Device A
max_devices=1
archive state
license state
Entitlement state
request_nonce replay
```

Wrong device:

```text
deny
```

---

# 22. Request nonce replay protection

Activation/refresh используют fresh 32-byte request nonce.

API encoding:

```text
standard padded Base64
44 chars
```

Backend хранит:

```text
SHA256(raw request_nonce)
```

с mandatory unique constraint:

```text
(credential_record_id, request_nonce_hash)
```

Duplicate/concurrent replay:

```text
409 REQUEST_NONCE_REPLAY
```

До:

```text
signing
wrapping
token side effects
```

---

# 23. Trust anchors / signing keys

Backend владеет отдельными private keys:

```text
archive signing key
license signing key
```

Viewer доверяет public keys из authenticated SolArch Viewer release/config.

Нельзя:

```text
доверять verification key из .slr
доверять key, пришедшему в license response
```

`key_id` выбирает уже trusted role-specific key.

Production keys:

```text
не в Git
не в test fixtures
не в Viewer
не в logs
```

---

# 24. Backend ↔ `solarch-core` archive creation

Backend НЕ реализует `.slr` encryption/serialization на TypeScript.

Используется:

```text
solarch-core
/
solarch-cli
```

Backend создаёт fresh 32-byte ACK на каждую build attempt.

Archive signing private key остаётся Backend-side.

Normative integration:

```text
docs/INTEGRATION.md §5
```

Future production CLI command:

```bash
solarch create \
  --input-dir <path> \
  --metadata <path> \
  --output <path> \
  --signing-key-id <id> \
  --signing-public-key <B64>
```

Все argv non-secret.

ACK передаётся binary pipe/stdin protocol:

```text
SLRKEY01 || 32-byte ACK
```

Никаких plaintext ACK:

```text
argv
env
JSON stdout
logs
sidecar
.slr
```

Archive signer подписывает только trusted/verifed pending build согласно exact
`docs/INTEGRATION.md §§5.2–5.3`.

Backend не должен превращать signing service в arbitrary signing oracle.

---

# 25. Archive fingerprint

Production fingerprint:

```text
SHA-256
```

Coverage:

```text
EVERY byte of finalized signed .slr
including final signature
```

Wire/API representation:

```text
32 raw digest bytes
→ exactly 64 lowercase hex chars
```

Fingerprint отсутствует в PublicHeader, чтобы избежать recursion.

Backend, Core и Viewer должны получать один и тот же fingerprint для одного файла.

---

# 26. Resource limits

`.slr v1` limits уже frozen.

Основные:

```text
max finalized .slr = 1 GiB
max protected plaintext total = 512 MiB
max single protected file = 512 MiB
max files = 10,000
chunk size = fixed 1 MiB per-file chunks
max chunks = 16,384
```

Остальные metadata/path limits:

```text
docs/SLR_FORMAT.md
```

Не подменять format limits временным 64 MiB in-memory foundation builder limit.

---

# 27. Deterministic interoperability vectors

Перед cross-branch integration Backend должен независимо воспроизвести vectors из:

```text
docs/INTEGRATION.md §15
```

Векторы включают:

```text
container signature
finalized .slr bytes
archive fingerprint
X25519 device key
JCS license payload
HPKE wrapped ACK
license Ed25519 signature
TOKEN32 examples
```

Synthetic vector values:

```text
НЕ production secrets
НЕ trust anchors
```

Backend и Rust должны byte-for-byte совпадать.

---

# 28. Минимальные Backend tests после реализации

Нужны минимум:

## Payment

```text
Device A bound before payment
fresh Solana Pay transaction request
same-account issuance idempotence
no concurrently payable variants
95/5 exact USDC economics
SolArch fee payer
wrong mint rejected
wrong recipient rejected
wrong amount rejected
modified message rejected
unissued transaction rejected
late transaction rejected
replay rejected
```

## Finality

```text
processed -> no Entitlement
confirmed -> awaiting_finality only
finalized + failed meta -> no Entitlement
finalized + full verification -> one Payment + one Entitlement
pre-expiry landed tx may finalize after intent expiry
DB failure after chain finality remains retryable
concurrent reconciliation creates exactly one result
```

## Device

```text
Device A works
Device B denied
post-payment key substitution denied
intent credential cannot change device
refresh credential cannot change device
max_devices=1 enforced atomically
```

## License

```text
canonical P
wrong JCS/signature rejected by Rust fixture
wrong device HPKE fails
modified W fails
modified P fails
request nonce replay rejected
72-hour timestamps exact
revoked/blocked/expired state denied
```

## Cross-language

```text
Node/Backend vector
==
Rust/Core vector
```

---

# 29. Real E2E expectation

Перед hackathon final acceptance необходимо пройти:

```text
Device A opens .slr
→ Locked
→ Solana Pay QR
→ real USDC purchase
→ transaction reaches finalized
→ Backend full verification
→ Payment
→ Entitlement bound to Device A
→ activation
→ signed license + wrapped ACK
→ Viewer decrypts protected content
→ watermark visible
→ repeat open works offline inside 72h
→ after required refresh Backend can renew
→ same .slr on Device B fails
```

Mocks не считаются доказательством real USDC flow.

---

# 30. Что Backend НЕ должен реализовывать

Не добавлять без отдельного решения:

```text
buyer account
custodial creator wallet
creator balance/withdrawal
wallet login for buyer
wallet signMessage activation
device transfer/reset
offline grace > 72h
more than one device
SOL payment
video/audio/PPTX support
on-chain licenses/NFT
x402
custom crypto primitives
```

---

# 31. Cross-branch conflict rule

Если текущая Backend implementation уже расходится с этим contract:

```text
STOP dependent implementation
→ указать конкретный конфликт
→ сверить source-of-truth docs
→ согласовать изменение
→ обновить shared docs/fixtures
→ только потом менять protocol implementation
```

Нельзя тихо выбирать:

```text
другую Base64
другой HPKE profile
другой license JSON
confirmed вместо finalized
другой fingerprint coverage
другой device-binding flow
```

---

# 32. Backend implementation checklist

Перед объявлением Backend integration готовой:

- [ ] прочитаны актуальные source-of-truth docs;
- [ ] Payment Intent immutable bound to Device A;
- [ ] TOKEN32 intent credential реализован безопасно;
- [ ] Solana Pay GET/POST transaction-request реализован;
- [ ] `getLatestBlockhash` использует `confirmed`;
- [ ] SolArch fee payer реализован;
- [ ] USDC 95/5 exact transaction реализована;
- [ ] production authorization требует `finalized`;
- [ ] `processed`/`confirmed` не создают Entitlement;
- [ ] full transaction verification реализован;
- [ ] buyer_wallet выводится Backend из transaction;
- [ ] Payment + Entitlement commit атомарный/idempotent;
- [ ] max_devices=1 enforced на уровне persistence/concurrency;
- [ ] initial activation принимает только exact Device A;
- [ ] device refresh TOKEN32 реализован;
- [ ] JCS license payload byte-compatible с Rust;
- [ ] Ed25519 license signing byte-compatible с Rust;
- [ ] RFC9180 HPKE byte-compatible с Rust;
- [ ] request nonce replay protection реализован;
- [ ] 72-hour offline timestamps выдаются точно;
- [ ] signing/trust keys разделены по ролям;
- [ ] ACK custody encrypted Backend-side;
- [ ] Core/CLI integration не дублируется на TypeScript;
- [ ] deterministic vectors reproduced independently;
- [ ] real USDC E2E запланирован/пройден перед финальным demo.

---

# 33. Что делает Archive Core / Viewer команда

Backend-разработчику не нужно реализовывать вместо Archive/Core/Viewer команды:

```text
.slr parser/serializer
chunk encryption/decryption
container verification
ArchiveBuilder implementation
Windows device private-key generation/storage
local license signature validation
HPKE Open
internal PDF/image/DOCX/XLSX viewers
watermark rendering
Windows .slr file association
```

Backend должен предоставить exact shared contract data, а не дублировать эти
компоненты.

---

# 34. Current integration status

После `INTEGRATION_GATE_01`:

```text
shared documentation contract = FROZEN / REVIEWED
production Backend implementation = NOT implied complete
production Archive Core create/verify = still to be implemented
Part 02 Viewer identity/license implementation = not yet completed
real USDC Device A/B E2E = not yet verified
```

Следующий шаг для Archive Core/Viewer команды — завершить production
implementation Part 01 по уже frozen contract.

Backend-команда может использовать обновлённые source-of-truth docs для своей
совместимой реализации и не должна самостоятельно переопределять protocol.
