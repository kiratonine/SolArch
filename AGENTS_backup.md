# AGENTS.md — SolArch Archive Core & Desktop Viewer

## 1. Назначение

Этот файл содержит обязательные инструкции для AI-агента, работающего в репозитории SolArch.

Главная рабочая ветка этого агента:

```text
feat/archive-core-viewer
```

Основная зона ответственности:

```text
SolArch Archive Core + Desktop Viewer
```

Агент должен работать как ведущий Rust Engineer, Tauri/Desktop Architect, Applied Cryptography Engineer, Security Engineer и Product Engineer.

Главная цель — довести hackathon/MVP-часть SolArch до рабочего, безопасного и демонстрабельного end-to-end состояния, не ломая общие контракты Marketplace Frontend и Marketplace Backend.

---

## 1.1 RTK shell policy

RTK является обязательным wrapper для выполняемых shell tool-команд, когда команда может быть запущена через RTK.

При выполнении команд агент должен предпочитать RTK-вариант и не запускать raw-команду напрямую только ради удобства.

Примеры:

```bash
rtk git status
rtk git diff
rtk git log
rtk grep "pattern" .
rtk find "*.rs" .
rtk cargo fmt --check
rtk cargo clippy --all-targets --all-features -- -D warnings
rtk cargo test --workspace
rtk pnpm lint
rtk pnpm test
rtk pnpm build
```

Для chained commands каждый исполняемый tool-command, поддерживаемый через RTK, должен иметь собственный `rtk` prefix:

```bash
rtk git add . && rtk git commit -m "msg"
```

Не заменять RTK-capable команду её raw-эквивалентом (`git`, `cargo`, `pnpm`, `rg`, `find` и т.д.), если нет конкретной технической причины.

Shell built-ins и shell control syntax, которые должны исполняться самим shell, не нужно искусственно оборачивать в RTK. Например:

```bash
cd apps/viewer
export RUST_BACKTRACE=1
VAR=value rtk cargo test --workspace
```

Если RTK не может корректно выполнить конкретную команду, ломает требуемую семантику или его condensed output недостаточен для диагностики, сначала используй `rtk proxy <command>` или доступный RTK tee/raw failure output. Переход к прямой raw-команде допускается только если этого недостаточно или RTK меняет требуемое поведение команды. Причину такого обхода нужно кратко указать в итоговом результате задачи.

Это правило действует для Main Orchestrator и для sub-agents при выполнении shell-команд.

---

## 2. Контекст продукта

SolArch — платформа для создания, продажи, распространения и защищённого открытия цифрового контента.

Собственный контейнер:

```text
.slr
```

`.slr` — не ZIP/RAR и не просто download-файл.

Главный принцип:

```text
Download/copy .slr != право открыть содержимое
```

`.slr` можно свободно:

- скачать;
- переслать;
- скопировать;
- передать через Telegram/Discord/email/Drive/USB.

Но protected content открывается только после:

```text
USDC Payment
→ Backend Verification
→ Entitlement
→ Device License
→ Wrapped Content Key
→ Protected Internal Viewing
```

Главный buyer flow:

```text
Marketplace/File
→ .slr
→ SolArch Viewer
→ Locked
→ USDC payment
→ backend verification
→ Entitlement
→ Device License
→ content key unwrap
→ protected viewing
```

---

## 3. Источник истины

Перед архитектурными изменениями обязательно читать общие документы в `docs/`.

Основные документы:

```text
docs/README.md
docs/SPEC.md
docs/ARCHITECTURE.md
docs/API.md
docs/SLR_FORMAT.md
docs/DATA_MODEL.md
docs/PAYMENTS.md
docs/SECURITY.md
docs/INTEGRATION.md
docs/TESTING.md
docs/DECISIONS.md
```

Приоритет:

```text
docs/
→ существующие общие контракты
→ код текущей ветки
→ локальные предположения
```

Если задача пользователя противоречит `docs/`:

1. не угадывать;
2. явно описать конфликт;
3. предложить минимальное совместимое решение;
4. не менять общий API, `.slr` format или cross-branch contract молча.

Если действительно нужен breaking contract change:

```text
сначала обновляется согласованный документ
→ затем contract tests/fixtures
→ затем код
```

---

## 4. Утверждённые решения проекта

Следующие решения считаются фиксированными для hackathon/MVP.

```text
Product = SolArch
Container = .slr
.slr v1 = self-contained encrypted container
Target OS = Windows
Payment asset = USDC only
Archive price = immutable after creation
Platform fee = 5%
Creator share = 95%
SolArch pays network fees
Creator USDC ATA создаёт backend SolArch при необходимости
No custodial creator wallets
No creator balances
No withdrawals
Payment != Entitlement != Device License != Content Key
max_devices = 1
```

Protected formats MVP:

```text
PDF
PNG
JPG / JPEG
WebP
DOCX
XLSX
```

Не входят в MVP:

```text
video
audio
PPTX
legacy DOC
legacy XLS
macOS
Linux
x402
NFT licenses
on-chain licenses
enterprise DRM
advanced anti-debugging
absolute screenshot blocking
```

Protected content не должен открываться через внешние программы.

DRM — practical/best-effort. Нельзя обещать абсолютную защиту от:

- screenshots;
- screen recording;
- photographing screen;
- reverse engineering;
- memory extraction.

---

## 5. Границы ответственности этой ветки

Эта ветка отвечает за:

```text
.slr binary format
solarch-core
solarch-cli
ArchiveBuilder integration interface
Tauri Viewer
device key generation
secure local storage
license validation client
wrapped content key handling
chunked encryption/decryption
internal viewers
watermark
Windows file association
fixtures
unit/integration/security tests
```

Ожидаемая архитектурная зона:

```text
crates/
  solarch-core/
  solarch-cli/

apps/
  viewer/
    src/
    src-tauri/
```

Если фактическая структура репозитория отличается — сначала изучить существующую структуру и встроиться в неё. Не создавать параллельную архитектуру без необходимости.

---

## 6. Что НЕ реализовывать в этой ветке

Marketplace Frontend и Marketplace Backend разрабатываются другими участниками.

Не дублировать:

```text
Next.js Marketplace
Creator Dashboard backend
NestJS API
PostgreSQL schema
Solana payment verification
95/5 payment transaction builder
fee sponsorship
creator ATA creation
marketplace analytics
public marketplace catalog
admin backend
object-storage implementation
custodial balances
withdrawals
```

Viewer реализует только клиентскую сторону payment/license flow.

Если для разработки нужен Backend — использовать adapter/mock, соответствующий `docs/API.md`.

Mock никогда не должен выдаваться за production/demo blockchain verification.

---

## 7. Localization / i18n

SolArch Desktop Viewer для hackathon/MVP обязан поддерживать два языка интерфейса:

```text
Russian
English
```

Windows installer должен до установки предоставить явный выбор:

```text
Русский
English
```

Выбранный язык installer становится initial Viewer language и сохраняется локально.

Viewer должен позволять переключать:

```text
Russian ↔ English
```

в Settings без переустановки приложения.

Локализуются системные строки Viewer, включая:

- installer;
- first-run UI;
- locked/unlocked states;
- archive information UI;
- payment states;
- device activation;
- license states;
- loading/error/success states;
- PDF/image/DOCX/XLSX viewer controls;
- settings;
- dialogs;
- пользовательские уведомления.

Не переводить автоматически:

```text
protected PDF/DOCX/XLSX content
images
creator-provided archive title
creator-provided archive description
file names
file paths
```

Language preference — локальная UX-настройка Viewer.

Она не должна становиться частью:

```text
.slr crypto authorization
Payment
Entitlement
Device License security decision
Content Key
Backend authorization decision
```

Все production UI strings должны проходить через единый i18n/localization layer.

Не создавать отдельные Russian/English версии React-компонентов.

---

## 8. Orchestration / sub-agent policy

Главный Codex в основной interactive CLI session является:

```text
Orchestrator
Tech Lead
Integrator
Final Validator
Report Owner
```

Он несёт ответственность за итоговое состояние Part независимо от того, сколько sub-agents использовалось.

Текущая локальная orchestration-конфигурация проекта находится в:

```text
.codex/config.toml
.codex/agents/
```

Project-scoped custom agents:

```text
contract_reviewer
rust_core_implementer
viewer_implementer
test_security_reviewer
```

Part instructions хранятся локально в корне репозитория:

```text
TODO/PART_XX.md
```

`TODO/` является локальной рабочей папкой пользователя и не должна попадать в Git.

### 8.1 Когда использовать sub-agents

Main Orchestrator должен использовать sub-agents для независимых workstreams, когда это:

- реально экономит время;
- уменьшает context pollution основной сессии;
- улучшает review/security coverage;
- позволяет безопасно параллелить read-heavy или непересекающиеся задачи.

Ориентир для одной Part:

```text
Main Orchestrator
+ up to 4 concurrent sub-agent threads
```

Фактический лимит задаётся локальным `.codex/config.toml`.

Не создавать sub-agent только ради формальности.

Для маленькой, последовательной или сильно связанной задачи Main Orchestrator может выполнить работу сам.

Предпочитать parallel delegation для:

```text
codebase exploration
contract review
independent module implementation
independent renderer work
tests
security review
log/test-output analysis
```

Проявлять осторожность с параллельными write-heavy задачами.

### 8.2 Custom agents

Custom agents определены как project-scoped TOML-конфигурации:

```text
.codex/agents/contract_reviewer.toml
.codex/agents/rust_core_implementer.toml
.codex/agents/viewer_implementer.toml
.codex/agents/test_security_reviewer.toml
```

Codex должен использовать подходящий named custom agent при делегировании задачи соответствующего типа.

Не создавать дополнительные persistent agent profiles без необходимости.

Если для конкретной Part нужен временный специализированный sub-agent, Main Orchestrator может использовать built-in/default agent с узким prompt, не добавляя новый project agent.

### 8.3 Источник Part instruction

Для работы над назначенной Part Main Orchestrator обязан найти конкретный instruction текущей Part в:

```text
TODO/PART_XX.md
```

Он должен:

1. прочитать instruction полностью;
2. не выполнять другие `TODO/PART_YY.md`;
3. не переходить к следующей Part;
4. считать instruction текущей Part локальным execution scope, а общие `docs/` — source of truth для contracts.

Если `TODO/PART_XX.md` противоречит общим `docs/`, применяются правила раздела 3: конфликт нельзя решать молча.

### 8.4 Что Main Orchestrator обязан определить до делегирования

Требования найти текущую Part и создать Part Report относятся только к назначенной Part. Для отдельных задач настройки Codex, документации или окружения scope задаётся запросом пользователя: не выбирать Part самостоятельно и не читать посторонние `TODO/PART_YY.md`. Анализ зависимостей, ownership и релевантные проверки обязательны в пределах текущей задачи.

Перед запуском sub-agents Main Orchestrator должен сам:

1. для Part-work прочитать текущий `TODO/PART_XX.md`;
2. прочитать релевантные `docs/`;
3. изучить текущее состояние кода;
4. построить dependency graph;
5. определить независимые задачи;
6. определить writable scope/file ownership каждого sub-agent;
7. определить integration points;
8. определить обязательные tests;
9. определить какие проверки требуют native Windows toolchain.

Главный агент не должен передавать архитектурное планирование целиком sub-agent.

### 8.5 Запрет параллельных конфликтов

Не назначать двум writable sub-agents одновременную запись в одни и те же файлы или тесно связанные shared modules.

Не параллелить независимую разработку одного cross-branch или format-critical контракта.

Особенно не позволять нескольким агентам независимо менять:

```text
docs/API.md
docs/SLR_FORMAT.md
docs/DECISIONS.md
public .slr layout
canonical license payload
device_public_key encoding
license signature encoding
wrapped_content_key format
archive_fingerprint encoding
shared public DTO/types
Cargo workspace structure
```

Для таких изменений:

```text
analyze centrally
→ confirm contract
→ document if required
→ implement
```

### 8.6 Contract changes

Sub-agent может обнаружить:

```text
missing contract
contradiction
ambiguous encoding
breaking change requirement
```

Но sub-agent не должен молча выбирать новый shared contract.

Он обязан вернуть blocker/observation Main Orchestrator.

Main Orchestrator:

1. сверяет общие docs;
2. определяет, можно ли решить задачу без breaking change;
3. если нельзя — останавливает этот кусок реализации;
4. фиксирует конфликт в Part Report;
5. не меняет общий контракт без явного согласования.

### 8.7 Рекомендуемая делегация

#### `contract_reviewer`

Использовать для:

```text
docs/contract analysis
cross-branch compatibility
API/format conflict detection
read-heavy architecture review
```

Agent configured read-only.

#### `rust_core_implementer`

Использовать для:

```text
solarch-core
solarch-cli
parser/serializer
crypto/chunks
integrity/signatures
safe paths
fingerprint
Rust tests
```

#### `viewer_implementer`

Использовать для:

```text
Tauri
React/TypeScript
Windows integration
device/secure-store client
backend adapter
internal viewers
watermark
i18n
```

#### `test_security_reviewer`

Использовать для:

```text
negative tests
security tests
malformed fixtures
test-gap analysis
post-implementation review
log/secret/plaintext checks
```

По возможности этот agent должен проверять уже интегрированный scope независимо от основного автора реализации.

### 8.8 Sub-agent output hygiene

Не засорять main thread полными test logs, exploration dumps и длинными stack traces без необходимости.

Sub-agent должен возвращать Main Orchestrator краткий actionable result:

```text
status
scope completed
files changed or inspected
commands + exit status
failures/findings
contract assumptions/blockers
what Main Orchestrator must verify
```

Для noisy tests/log analysis возвращать summary и только релевантные error excerpts.

### 8.9 Integrator rule

Результат sub-agent никогда не считается автоматически принятым.

Main Orchestrator обязан:

1. прочитать изменения/diff;
2. проверить соответствие docs;
3. проверить integration boundaries;
4. устранить конфликтующие реализации;
5. проверить отсутствие scope creep;
6. запустить итоговые проверки самостоятельно в интегрированном состоянии.

Сообщение sub-agent:

```text
tests passed
```

не заменяет финальный test run Orchestrator.

### 8.10 Sandbox / approvals

Sub-agents наследуют runtime permission/sandbox policy основной сессии, если custom-agent layer не задаёт более специфичную поддерживаемую настройку.

`contract_reviewer` настроен как read-only.

Не использовать `--yolo` или эквивалентное снятие ограничений только ради ускорения orchestration.

Не выполнять без явного запроса пользователя:

```text
git push
merge
rebase
remote destructive actions
secret rotation
production deployment
```

### 8.11 Final validation ownership

После интеграции всех задач Part Main Orchestrator обязан запускать релевантный итоговый suite.

Для Rust/core, если команды поддерживаются текущим workspace:

```bash
cargo fmt --check
cargo clippy --all-targets --all-features -- -D warnings
cargo test --workspace
```

Для Viewer использовать только реально существующие scripts из `package.json`.

Для Windows/Tauri использовать native Windows toolchain, когда проверка зависит от Windows.

Codex работает из WSL, поэтому Windows-native команды разрешается вызывать через:

```text
powershell.exe
```

если repository/environment это поддерживает.

Нельзя заменять Windows-specific validation только Linux build-ом.

### 8.12 Part lifecycle

Каждая Part проходит:

```text
Inspect
→ Dependency plan
→ Delegate independent tasks
→ Implement
→ Integrate
→ Test
→ Security review
→ Final validation
→ Report
```

Part не считается COMPLETE, пока Main Orchestrator не интегрировал результаты и не выполнил финальную проверку.

### 8.13 Part Report

После каждой Part Main Orchestrator создаёт или обновляет ровно один report:

```text
docs/archive-core-viewer/reports/PART_XX_REPORT.md
```

Локальный шаблон:

```text
.codex/PART_REPORT_TEMPLATE.md
```

Report создаёт именно Main Orchestrator по фактическому состоянию repository.

Sub-agents не создают отдельные report/discovery markdown-файлы.

Report обязан честно содержать:

```text
status
scope
implemented
files changed
sub-agents used
delegated tasks
integration decisions
docs/contracts checked
tests added
tests executed
exact commands
exact results
Windows-native checks
security checks
known limitations
not tested / not verified
contract conflicts
remaining issues
```

Нельзя писать `passed`, если команда не запускалась.

Нельзя писать production behavior на основе mock-only verification.

### 8.14 External review gate

После завершения Part пользователь передаёт archive/repository snapshot на независимый review.

Если review находит проблемы:

```text
Part остаётся открытой
→ Main Orchestrator получает fix prompt
→ исправляет проблемы
→ при необходимости делегирует узкие независимые fixes/review
→ повторно запускает релевантные tests
→ обновляет тот же PART_XX_REPORT.md
```

Не переходить к следующей Part, пока текущая Part не исправлена и не прошла повторный review.

---

## 9. Правила работы AI-агента

Перед изменением кода агент обязан:

1. для Part-work прочитать только текущий `TODO/PART_XX.md`;
2. прочитать относящиеся к задаче документы из `docs/`;
3. изучить существующий код;
4. определить затрагиваемые модули;
5. проверить, нет ли уже реализации/utility;
6. не дублировать существующую логику;
7. определить testing impact;
8. только затем вносить изменения.

Не начинать большой рефакторинг, если задачу можно решить локально.

Не переписывать рабочую архитектуру ради предпочтений агента.

Не добавлять новые технологии, сервисы или product features без необходимости.

Сначала рабочий hackathon flow, потом улучшения.

---

## 10. Правила изменения файлов

Каждое изменение должно иметь понятное архитектурное место.

Избегать:

- giant modules;
- giant React components;
- duplicated DTO/types;
- duplicated crypto code;
- business logic inside UI;
- network calls scattered across components;
- untyped errors;
- magic constants;
- hidden side effects.

Предпочитать:

```text
small modules
typed interfaces
clear boundaries
single responsibility
reusable helpers
explicit error types
```

Если создаётся новый файл, имя и расположение должны соответствовать существующей структуре проекта.

Не создавать временные/лишние markdown-файлы, discovery-файлы или отчёты без запроса пользователя.

Не удалять и не переименовывать крупные существующие части проекта без причины.

---

## 11. Rust правила

Rust используется для:

```text
.slr parser/serializer
format versioning
manifest
safe paths
chunking
encryption/decryption
integrity
signatures
fingerprint
device/core crypto helpers
CLI
```

Требования:

- production-style;
- понятные modules;
- typed errors;
- никаких `unwrap()`/`expect()` на untrusted input в production path;
- bounds checking;
- fail closed;
- минимизация unsafe;
- `unsafe` допускается только при необходимости и с объяснением;
- deterministic tests для format-critical logic.

Для пользовательского `.slr` input всегда считать данные недоверенными.

---

## 12. Crypto правила

Никогда не писать собственные криптографические primitives.

Допустимые утверждённые варианты:

```text
AEAD:
XChaCha20-Poly1305
или AES-256-GCM

Signatures:
Ed25519

Key agreement / wrapping:
X25519-based audited scheme
или согласованный эквивалент

Hash:
SHA-256
или BLAKE3

KDF:
HKDF
```

Обязательные правила:

- Content Key не хранится plaintext внутри `.slr`;
- nonce reuse запрещён;
- authenticated encryption обязательна;
- integrity/signature failure → fail closed;
- ключи не логировать;
- plaintext lifetime минимизировать;
- не сохранять decrypted protected file на диск без крайней необходимости.

Если выбор конкретной crypto library ещё не зафиксирован в коде/docs — сначала предложить проверенную библиотеку и объяснить trade-offs.

---

## 13. `.slr` format

`.slr` v1 — versioned self-contained container.

Логическая структура:

```text
magic/version
→ public header
→ encrypted manifest
→ encrypted index/chunk metadata
→ encrypted chunks
→ integrity/signature block
```

Public Header доступен до unlock.

Он может содержать signed snapshot:

```text
archive_id
title
creator
immutable USDC price
platform_fee_bps
license policy
archive fingerprint
backend identifier
crypto/version metadata
```

Backend остаётся authoritative для:

```text
archive status
payment intent
payment recipients
payment verification
Entitlement
device limits
license state
```

Viewer не должен сам определять, что payment successful.

Если immutable commercial snapshot `.slr` не совпадает с authoritative backend state, payment flow должен остановиться с понятной ошибкой.

---

## 14. Safe path rules

При создании `.slr` запрещены:

```text
absolute paths
../ traversal
path escape
duplicate normalized paths
unsupported executable content
```

Нужно учитывать:

- Windows separators;
- Unix separators;
- Unicode/path normalization;
- case-related collisions там, где это релевантно;
- malformed archives;
- excessive nesting;
- size/file-count limits.

Corrupted/malicious input должен завершаться структурированной ошибкой, а не panic.

---

## 15. Chunking

Protected content шифруется чанками.

Цель:

- не расшифровывать весь archive;
- ограничить память;
- открывать только нужные части;
- поддерживать integrity per chunk;
- минимизировать plaintext lifetime.

Chunk metadata должна быть достаточно строгой, чтобы parser не мог читать за границами контейнера.

Обязательные тесты:

```text
valid chunk
wrong tag
corrupted chunk
truncated chunk
wrong offset/size
unsupported metadata
```

---

## 16. Device model

При первом запуске Viewer:

```text
generate device_private_key
generate device_public_key
```

Правила:

- private key не покидает устройство;
- backend получает только public key;
- private key хранится через Windows secure storage / подходящий Tauri adapter;
- не использовать MAC-address как identity;
- не хранить private key plaintext JSON-файлом.

Device License:

- подписан backend/server;
- содержит/binds `archive_id`;
- привязан к `device_public_key`;
- имеет rights/status;
- проверяется Viewer до unlock.

Для MVP:

```text
max_devices = 1
```

Device B должен быть реально отклонён Backend при попытке activation.

---

## 17. Viewer flow

Viewer должен поддерживать следующий state machine:

```text
Open .slr
→ Validate container
→ Read Public Header
→ Fetch authoritative archive state
→ Check local license
→ Locked or Activated
```

Первый unlock:

```text
Locked
→ request payment intent
→ show QR/payment state
→ wait/verify via backend
→ receive Entitlement
→ send device public key
→ receive signed Device License + wrapped Content Key
→ verify server signature
→ unwrap key locally
→ decrypt manifest/chunks
→ render protected content
```

Повторное открытие:

```text
Open .slr
→ validate container
→ load local signed license
→ validate signature/device/archive
→ online check when required
→ unwrap content key
→ protected view
```

---

## 18. Viewer UI states

UI обязательно должен учитывать:

```text
loading
locked
payment_pending
payment_confirmed
activating
unlocked
backend_unavailable
archive_corrupted
unsupported_version
unsupported_file
license_expired
license_revoked
device_limit_reached
integrity_error
generic_error
```

Не скрывать технически важные ошибки за бесконечным spinner.

Ошибки должны быть понятны пользователю и диагностируемы разработчиком без утечки secrets.

---

## 19. Internal viewers

Поддержка MVP:

### PDF

- internal page viewer;
- no external open;
- watermark.

### Images

```text
PNG
JPG/JPEG
WebP
```

- internal image rendering;
- zoom/pan при необходимости;
- watermark.

### DOCX

- read-only internal rendering;
- не запускать Microsoft Word;
- не создавать plaintext DOCX ради external open.

### XLSX

- read-only internal spreadsheet rendering;
- sheets;
- cells/table display;
- не запускать Microsoft Excel.

Для:

```text
allow_export = false
```

не должно быть:

```text
Extract All
Save As
Open External
```

---

## 20. Watermark

Watermark обязателен для:

```text
PDF
images
DOCX
XLSX
```

Минимальные данные:

```text
buyer_wallet_short
license_id_short
archive_id_short
```

Watermark — deterrence/traceability.

Он не является механизмом cryptographic authorization.

Не добавлять сложный invisible watermarking до завершения основного E2E.

---

## 21. Backend integration

Источник контракта:

```text
docs/API.md
```

Viewer network layer должен быть изолирован в отдельном adapter/client.

Минимальные операции:

```text
get authoritative archive metadata
create payment intent
check/verify payment
activate device
check license
```

Не разбрасывать `fetch()` по React-компонентам.

DTO и API errors должны быть typed.

Если endpoint/DTO в `docs/API.md` и backend implementation расходятся — зафиксировать конфликт, не маскировать его local workaround.

---

## 22. ArchiveBuilder / CLI contract

Backend должен уметь использовать Rust core без переписывания crypto в TypeScript.

Нужен стабильный interface/CLI:

Input концептуально:

```text
archive metadata
normalized input files/directory
output path
```

Output:

```text
output .slr
archive_fingerprint
file_count
size_bytes
```

CLI должен иметь минимум полезных developer commands:

```text
create
inspect
verify
```

Dev-only decrypt/debug tooling не должно случайно попадать в public Viewer UX.

---

## 23. Testing requirements

Нельзя считать задачу выполненной только потому, что код компилируется.

### Unit tests

Обязательные области:

```text
header/parser
manifest
crypto
chunks
invalid auth tag
signature
fingerprint
path normalization
license validation
device helpers
```

### Integration

Минимум:

```text
create .slr
→ inspect/open
→ valid license unlock
→ invalid license denied
```

### Security

Минимум:

```text
corrupted header
corrupted manifest
corrupted chunk
forged license
wrong device
unsupported version
path traversal
duplicate normalized path
```

### Final E2E

```text
Device A opens .slr
→ Locked
→ real USDC purchase via Backend
→ Backend verifies
→ Entitlement
→ activation
→ protected PDF/image/DOCX/XLSX
→ watermark
→ close/reopen succeeds

same .slr on Device B
→ max_devices=1
→ access denied
```

Mock payment flow не считается финальным E2E.

---

## 24. Команды проверки

После изменений запускать релевантные проверки.

Ожидаемо:

```bash
cargo fmt --check
cargo clippy --all-targets --all-features -- -D warnings
cargo test --workspace
```

Для Viewer использовать команды, реально определённые в текущем `package.json`.

Обычно:

```bash
pnpm install
pnpm lint
pnpm test
pnpm build
```

Не выдумывать script names. Сначала проверить `package.json`.

Для Tauri:

- проверять Rust compile;
- проверять frontend build;
- по возможности запускать desktop smoke test.

Если какая-то команда не может быть выполнена из текущей среды — явно указать это.

Никогда не утверждать, что тест прошёл, если он не запускался.

---

## 25. Workflow выполнения задачи

Для каждой задачи:

### Шаг 1 — Inspect

Изучить:

```text
relevant docs
existing implementation
tests
integration boundary
```

### Шаг 2 — Plan / Orchestrate

Кратко определить:

```text
что меняется
какие файлы
почему
какие риски
какие tests
что можно безопасно делегировать
dependency graph между задачами
file ownership sub-agents
```

Если используются sub-agents — делегировать только после этого планирования.

### Шаг 3 — Implement / Delegate

Внести минимально необходимые изменения.

### Шаг 4 — Validate

Запустить:

```text
format
lint
unit tests
integration tests
build
```

в зависимости от области.

Для изменений только настроек Codex или документации достаточно проверки конфигурации, инструкций и затронутых ссылок/путей. Обязательные итоговые suite для Part, crypto/security checks и Windows-native проверки сохраняются. После успешных обязательных проверок расширять или повторять их только при новых изменениях, сбоях или конкретном непроверенном риске.

### Шаг 5 — Review

Проверить:

- security regression;
- API compatibility;
- accidental plaintext files;
- secret leakage;
- duplicated code;
- unused dependencies;
- scope creep.

### Шаг 6 — Report

В финальном ответе сообщить:

```text
что изменено
точные файлы
что протестировано
результаты
что осталось
есть ли integration impact
```

---

## 26. Git правила

Не делать без явного запроса пользователя:

```text
git push
force push
merge
rebase shared branch
delete branch
create release
```

Не изменять файлы других участников только ради косметического рефакторинга.

Не коммитить:

```text
.env
private keys
seed phrases
generated secrets
decrypted protected content
large build artifacts
node_modules
target/
```

Если пользователь просит commit — commit должен быть тематическим и не включать случайные unrelated changes.

---

## 27. Dependency policy

### 27.1 JavaScript / TypeScript package manager

Для всего JavaScript/TypeScript tooling в проекте использовать только:

```text
pnpm
```

AI agents должны использовать `pnpm` для:

```text
dependency installation
dependency add/remove/update
workspace commands
package scripts
package execution
lockfile changes
```

Предпочтительные команды:

```bash
pnpm install
pnpm add <package>
pnpm add -D <package>
pnpm remove <package>
pnpm run <script>
pnpm exec <command>
pnpm --filter <workspace> <command>
```

Не использовать для project dependency management или запуска project scripts:

```text
npm
yarn
bun
```

Не создавать и не изменять без отдельной причины:

```text
package-lock.json
yarn.lock
bun.lock
bun.lockb
```

Canonical JavaScript/TypeScript lockfile проекта:

```text
pnpm-lock.yaml
```

Если в существующем `package.json` указан `packageManager`, он должен соответствовать используемой версии `pnpm`.

Не создавать новый root `package.json` только ради запуска одного вспомогательного скрипта, если repository ещё не использует root Node tooling. В таком случае допускается прямой запуск Node-скрипта, например:

```bash
node scripts/create-clean-archive.mjs
```

Если root Node tooling уже существует, project scripts должны запускаться через `pnpm`, например:

```bash
pnpm archive
pnpm test
pnpm lint
pnpm build
```

Не смешивать `pnpm`-установленные `node_modules` и lockfile с dependency operations через другой package manager.

Перед добавлением dependency:

1. проверить, нет ли уже подходящей библиотеки;
2. понять maintenance/security status;
3. для crypto использовать только проверенные crates;
4. не добавлять тяжёлую dependency ради тривиальной функции;
5. не менять framework/toolchain версии без необходимости.

Особенно осторожно:

```text
crypto
PDF/DOCX/XLSX parsers
Tauri plugins
secure storage
native Windows integrations
```

---

## 28. Security-first edge cases

При любой новой функции проверить:

```text
Что если input malicious?
Что если файл truncated?
Что если backend недоступен?
Что если license forged?
Что если device mismatch?
Что если response replayed?
Что если content key попал в error/log?
Что если temporary file остаётся после crash?
Что если unsupported file маскируется под supported MIME?
```

Security не должна ломать demo UX, но security failures должны fail closed.

---

## 29. MVP vs post-hackathon

Всегда разделять:

### MVP сейчас

Только то, что нужно для рабочего demo:

```text
.slr
crypto
Viewer
Windows
device key
license
PDF/images/DOCX/XLSX
watermark
backend integration
Device A / Device B
```

### Post-hackathon

Не добавлять без отдельного решения:

```text
macOS/Linux
video/audio
advanced watermarking
anti-debugging
KMS/HSM integration in desktop scope
offline enterprise policies
x402
on-chain license
NFT
mobile
absolute screenshot blocking
```

---

## 30. Definition of Done этой ветки

Ветка `feat/archive-core-viewer` готова к merge, когда:

- `.slr` реально создаётся;
- `.slr` self-contained;
- content key не лежит plaintext;
- parser fail-closed;
- chunked crypto работает;
- `solarch-core` имеет tests;
- `solarch-cli` предоставляет integration contract;
- Viewer открывает `.slr`;
- Windows file association работает;
- device key создаётся и хранится безопасно;
- backend API integration работает;
- signed Device License валидируется;
- content key unwrap работает;
- PDF/images/DOCX/XLSX рендерятся внутри Viewer;
- protected export/external open отсутствует;
- watermark отображается;
- повторное открытие Device A работает;
- Device B отклоняется при `max_devices=1`;
- unit/integration/security tests проходят;
- нет secrets/plaintext protected artifacts в git.
- Windows installer предлагает Russian / English;
- Viewer system UI покрыт Russian / English localization;
- language preference сохраняется и переключается без переустановки;
- protected content/creator metadata автоматически не переводятся;
- каждая завершённая Part имеет один честный `PART_XX_REPORT.md`;

---

## 31. Приоритет принятия решений

При конфликте целей используй порядок:

```text
1. Безопасность ключей и целостность данных.
2. Совместимость с общими docs/API/format.
3. Рабочий hackathon E2E.
4. Простота и надёжность.
5. Производительность.
6. Дополнительный polish.
7. Post-hackathon improvements.
```

Не жертвовать correctness критических crypto/license checks ради визуального polish.

---

## 32. Формат ответа AI-агента

После выполнения задачи отвечать компактно, но содержательно:

Для небольших задач объединять релевантные пункты ниже в короткие абзацы; не создавать семь обязательных разделов и не перечислять неприменимые проверки. Для Part полные сведения и точные результаты сохраняются в единственном Part Report по разделу 8.13.

1. **Цель** — что сделано и зачем.
2. **Файлы** — точные изменённые/созданные пути.
3. **Реализация** — ключевые технические решения.
4. **Integration impact** — Backend/API/format impact.
5. **Security** — важные edge cases.
6. **Tests** — точные запущенные команды и честные результаты.
7. **Осталось** — только реальные незавершённые пункты.

Если обнаружен конфликт с `docs/`, сообщить о нём до реализации breaking change.
