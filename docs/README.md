<a id="solarch--общая-документация-проекта"></a>

# SolArch — Shared Project Documentation

This directory contains the SolArch team's shared agreements. These documents apply to all three development branches and define the shared interfaces between Archive Core/Viewer, Marketplace Frontend and Marketplace Backend.

<a id="1-проект"></a>

## 1. Project

**Name:** SolArch  
**Protected container format:** `.slr`  
**Primary use case:** protected digital content can be freely downloaded and shared, but can be opened only after confirmed payment, an Entitlement and activation of a device-bound license.

Core flow:

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

<a id="2-командные-ветки"></a>

## 2. Team branches

```text
feat/archive-core-viewer
feat/marketplace-frontend
feat/marketplace-backend
```

Responsibilities are defined in the team's individual role files.

<a id="3-общие-документы"></a>

## 3. Shared documents

Read in this order:

1. `SPEC.md` — approved product and MVP scope.
2. `ARCHITECTURE.md` — components, trust boundaries and relationships.
3. `API.md` — Marketplace Frontend and Viewer contracts with Backend.
4. `SLR_FORMAT.md` — the `.slr` format and container requirements.
5. `DATA_MODEL.md` — shared PostgreSQL model.
6. `PAYMENTS.md` — USDC payment flow, 95/5 split, fee sponsorship and ATA.
7. `SECURITY.md` — security rules and threat model.
8. `INTEGRATION.md` — integration points between the three branches.
9. `TESTING.md` — required unit, integration and end-to-end checks.

<a id="4-приоритет-документов"></a>

## 4. Document precedence

If a local decision in one branch conflicts with these shared documents, the developer must not silently change the shared contract.

Procedure:

```text
1. Document the conflict.
2. Agree on a resolution with the entire team.
3. Update the relevant shared document.
4. Only then change the implementation.
```

<a id="5-неизменяемые-продуктовые-решения-mvp"></a>

## 5. Immutable MVP product decisions

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

<a id="6-главный-definition-of-done-проекта"></a>

## 6. Project Definition of Done

The project is ready for a hackathon demo when the team can demonstrate one real A-to-Z flow:

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
