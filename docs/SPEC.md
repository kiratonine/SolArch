# SolArch — Product & MVP Specification

**Status:** shared team specification  
**Scope:** Solana hackathon MVP  
**Product:** SolArch  
**Container:** `.slr`

---

## 1. Product statement

SolArch is a platform for creating, distributing, selling and securely opening digital content.

Core idea:

> An `.slr` can be freely downloaded and shared. The file itself is not a purchase. A purchase grants access rights; content opens in SolArch Viewer only after confirmed USDC payment, an Entitlement and a device-bound license.

SolArch is not positioned as a conventional ZIP/RAR archive or a simple paywall for a link.

Core value:

```text
protected portable container
+ Solana payment proof
+ Entitlement
+ device-bound license
+ controlled desktop viewing
```

---

<a id="2-пользовательские-роли"></a>

## 2. User roles

<a id="21-посетитель--покупатель"></a>

### 2.1 Visitor / buyer

Without registration, a visitor can:

- open Marketplace;
- browse published archives;
- view the public description;
- view the public file listing;
- view the price;
- view public metrics;
- download `.slr`;
- download/open SolArch Viewer.

After opening `.slr`, the buyer:

- sees the locked state;
- sees the price and access rules;
- pays in USDC;
- receives access after backend verification and device activation.

<a id="22-автор"></a>

### 2.2 Creator

After authentication, a creator can:

- create an archive;
- upload a ZIP or individual files;
- set metadata;
- specify their own Solana payout wallet;
- set the price in USDC;
- view the 95/5 split;
- configure the permitted license policy;
- wait for `.slr` generation;
- preview the public card;
- publish/unpublish;
- obtain a public link;
- download their own `.slr`;
- view analytics.

<a id="23-администратор"></a>

### 2.3 Administrator

The MVP requires minimal moderation capabilities:

- hide/block a listing;
- change moderation status;
- prevent public downloads of a blocked archive.

A full admin platform is not required.

---

<a id="3-утверждённая-экономика"></a>

## 3. Approved economics

```text
Payment asset = USDC only
Platform fee = 5%
Creator share = 95%
```

Example:

```text
Archive price:       10.00 USDC
Buyer pays:          10.00 USDC
Creator receives:     9.50 USDC
SolArch receives:     0.50 USDC
Network fees:        paid by SolArch
```

### 3.1 Non-custodial

SolArch does not create a custodial wallet for the creator.

The creator specifies their own Solana wallet.

SolArch does not store:

- creator seed phrase;
- creator private key;
- custodial creator balance.

The MVP has no withdrawal/payout subsystem.

### 3.2 Price immutability

The price is set at archive creation and does not change after creation.

Immutable:

```text
price_amount
price_currency
platform_fee_bps
```

If the creator wants a different price, they create a new archive.

---

<a id="4-поддерживаемый-контент-mvp"></a>

## 4. Supported MVP content

Protected internal viewing:

```text
PDF
PNG
JPG / JPEG
WebP
DOCX
XLSX
```

Excluded:

```text
video
audio
PPTX
legacy DOC
legacy XLS
specialized CAD/PSD/3D
```

DOCX/XLSX must not open in external Microsoft Office during protected viewing.

---

## 5. `.slr` distribution model

`.slr` v1 is a self-contained encrypted container.

It must contain the encrypted file data required for local protected viewing after obtaining the content key.

Two distribution flows are supported:

```text
Marketplace-first:
Marketplace → Download .slr → Viewer

File-first:
Telegram / Discord / email / Drive / USB → .slr → Viewer
```

---

## 6. Marketplace MVP

<a id="61-публичные-функции"></a>

### 6.1 Public features

Required:

- landing/catalog;
- archive cards;
- public archive page;
- public file listing;
- price;
- access rules;
- public metrics;
- guest `.slr` download;
- Viewer download link;
- sorting.

### 6.2 Public metrics

Every visitor sees:

```text
views
downloads
paid unlocks
```

### 6.3 Creator analytics

The creator sees:

```text
views
downloads
confirmed payments / paid unlocks
gross revenue
creator revenue
platform fees
view → download conversion
download → purchase conversion
```

Recommended periods:

```text
7 days
30 days
all time
```

---

## 7. Viewer MVP

The Viewer must:

- launch when an `.slr` is opened;
- read the public header;
- display the locked state;
- display the current price/policy;
- display the payment QR;
- use the backend payment flow;
- generate and store the device key;
- activate a device-bound license;
- reopen the archive on the same device;
- render supported types inside the application;
- display the buyer/license watermark;
- provide no standard Extract All / Save As / Open External for protected content.

---

### 7.1 Viewer localization

SolArch Desktop Viewer for the hackathon/MVP must support two interface languages:

```text
Russian
English
```

The Windows installer must present an explicit language choice before installation:

```text
Русский
English
```

The selected installer language becomes the initial SolArch Viewer language.

All Desktop Viewer system elements must be localized, including:

- installer;
- first-run UI;
- locked/unlocked states;
- archive information UI;
- payment UI and payment states;
- device activation UI;
- license states;
- error/loading/success states;
- PDF/image/DOCX/XLSX viewer controls;
- settings;
- dialogs and Viewer user notifications.

The selected language must persist across application restarts.

The user must be able to change the language later:

```text
Russian ↔ English
```

in Viewer settings without reinstalling the application.

Protected content and creator-provided metadata are not translated automatically.

This includes:

- PDF/DOCX/XLSX content;
- images;
- archive title, if provided by the creator;
- archive description, if provided by the creator;
- file names and paths.

All Viewer system UI strings must use a shared localization/i18n layer. Production UI must not contain duplicate Russian/English components or hard-coded user-facing strings outside localization resources.

---

## 8. Licensing model

Keep strictly separate:

```text
Payment
Entitlement
Device License
Content Key
```

Definitions:

- **Payment** — a confirmed on-chain payment.
- **Entitlement** — the buyer's access right to a specific archive.
- **Device License** — activation of an Entitlement for a specific device public key.
- **Content Key** — the key used to decrypt protected content.

For the MVP:

```text
max_devices = 1
```

---

## 9. Marketplace sorting

Required:

```text
popular_week
popular_month
most_downloaded
price_asc
price_desc
```

The following formula is acceptable for the first version:

```text
popular_week/month:
confirmed_payments DESC
downloads DESC as secondary sort
```

with events filtered by the relevant period.

---

## 10. Out of scope

Do not implement in the hackathon MVP:

- SOL pricing;
- dynamic FX;
- other SPL assets;
- x402;
- subscriptions;
- ratings/reviews;
- referrals;
- promocodes;
- creator balances;
- withdrawals;
- custodial wallets;
- refunds;
- escrow;
- NFT licenses;
- on-chain license registry;
- secondary sales;
- mobile app;
- video/audio;
- advanced DRM promises;
- advanced recommendation engine;
- advanced analytics attribution;
- complex admin portal.

---

## 11. Acceptance Criteria

### AC-01

A guest opens Marketplace without login and sees published archives.

### AC-02

A guest opens the archive page and sees the title, description, price, file listing, access rules and public metrics.

### AC-03

A guest downloads `.slr` without registration or payment.

### AC-04

Marketplace never exposes the original ZIP/raw protected files to a guest.

### AC-05

When an unpaid `.slr` is opened, the Viewer displays the locked state and payment flow.

### AC-06

The buyer pays only the USDC archive price.

### AC-07

One confirmed transaction distributes 95% to the creator and 5% to SolArch.

### AC-08

SolArch pays the network fee.

### AC-09

An Entitlement is created after complete backend verification.

### AC-10

Device A activates and opens the archive.

### AC-11

Device B is rejected if `max_devices = 1`.

### AC-12

PDF/image/DOCX/XLSX open inside the Viewer.

### AC-13

Protected content has a visible watermark.

### AC-14

The archive price cannot be changed after creation.

### AC-15

If the creator USDC ATA is missing, SolArch creates it automatically.

### AC-16

Public metrics correctly display views, downloads and paid unlocks.

### AC-17

`paid unlocks` increases only after blockchain-verified payment.

### AC-18

When the Windows installer starts, the user can explicitly choose `Русский` or `English`; the selected language is used by the installer and becomes the initial SolArch Viewer language.

### AC-19

The selected language persists across Viewer restarts, and the user can switch `Russian ↔ English` in Settings without reinstalling the application.

### AC-20

Viewer system UI is localized in Russian and English, while protected content, creator-provided title/description and file names are not translated automatically.

---

## 12. Product limitation

SolArch uses practical DRM and traceability.

Do not claim absolute prevention of:

- screen recording;
- screenshots;
- memory extraction;
- reverse engineering;
- photographing the screen.

Correct wording:

> SolArch reduces the risk of unauthorized distribution and separates the transfer of a protected file from the right to open it, but does not guarantee absolute DRM protection after content is displayed to the user.
