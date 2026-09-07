# SolArch — Architecture & Product Decisions

Этот файл фиксирует решения, которые нельзя менять в одной ветке без согласования команды.

---

## ADR-001 — Название и формат

```text
Product = SolArch
Container extension = .slr
```

---

## ADR-002 — Self-contained container

`.slr` v1 хранит encrypted protected content внутри самого файла.

Причина: file-first distribution является ключевой ценностью.

---

## ADR-003 — USDC only

Hackathon/MVP принимает только USDC.

Не добавляем SOL price/FX, чтобы избежать oracle/quote/slippage complexity.

---

## ADR-004 — Immutable price

Цена archive фиксируется при создании.

Изменение цены требует нового archive.

---

## ADR-005 — Non-custodial creator payout

Creator предоставляет собственный Solana payout wallet.

SolArch не создаёт custodial creator wallet и не хранит creator balance.

---

## ADR-006 — 5% platform fee

```text
Creator = 95%
SolArch = 5%
```

Fee snapshot фиксируется при archive create.

---

## ADR-007 — Atomic split payment

Одна purchase transaction включает creator и platform USDC transfers.

Purchase подтверждается только при полном успешном 95/5 split.

---

## ADR-008 — SolArch pays network fees

SolArch является fee payer.

Buyer pays archive price only.

---

## ADR-009 — Automatic creator ATA

Если creator USDC ATA отсутствует, SolArch создаёт его автоматически и покрывает associated network/rent cost.

Prefer creation before publication.

---

## ADR-010 — Payment → Entitlement → Device License

Эти сущности не объединяются.

```text
Payment
→ Entitlement
→ Device License
→ Content Key access
```

---

## ADR-011 — Device key instead of MAC

Viewer генерирует asymmetric device key pair.

Private key remains local.

---

## ADR-012 — MVP max devices

```text
max_devices = 1
```

Это обязательно демонстрируется на Device A / Device B.

---

## ADR-013 — Supported protected formats

```text
PDF
PNG/JPG/WebP
DOCX
XLSX
```

No video/audio.

---

## ADR-014 — Internal protected rendering

Protected files не открываются через external applications.

Viewer renders supported formats internally.

---

## ADR-015 — Public Marketplace metrics

Visible to all:

```text
views
downloads
paid_unlocks
```

Author receives extended analytics.

---

## ADR-016 — Backend authoritative security decisions

Frontend/Viewer cannot self-confirm:

```text
price
payment
entitlement
device limit
```

---

## ADR-017 — No absolute DRM claim

SolArch provides practical DRM + device licensing + watermark.

It does not guarantee prevention of screenshots, recording, reverse engineering or photographing the screen.

---

## ADR-018 — Desktop Viewer localization

Hackathon/MVP версия SolArch Desktop Viewer поддерживает два языка:

```text
Russian
English
```

Windows installer обязан предоставить пользователю явный выбор `Русский` / `English` до установки.

Выбранный язык installer становится начальной locale Viewer и сохраняется как локальная пользовательская настройка.

Viewer должен позволять переключать язык между Russian и English после установки без переустановки приложения.

Localization распространяется на системный UI SolArch Viewer:

- locked/payment/license states;
- errors;
- dialogs;
- settings;
- internal viewer controls;
- application notifications.

Localization не изменяет protected content или creator-provided metadata.

SolArch не выполняет автоматический перевод:

```text
PDF/DOCX/XLSX content
archive title
archive description
file names
file paths
```

Language preference является локальной настройкой Desktop Viewer и не является частью `.slr` crypto format, Entitlement, Device License или Backend security decision.

Все production UI strings Viewer должны проходить через единый localization/i18n layer.
