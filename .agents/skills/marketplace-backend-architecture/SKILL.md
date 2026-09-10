---
name: marketplace-backend-architecture
description: >-
  Provides architectural standards, data model patterns, safe upload processing,
  and analytics calculation rules for the SolArch NestJS backend.
---

# Marketplace Backend Architecture Skill

This skill documents architectural patterns and operational standards for `apps/api`.

## Service Architecture

- **Framework:** NestJS + TypeScript.
- **ORM / Persistence:** PostgreSQL via Prisma ORM.
- **Security:** Helmet, rate limiting, zero-secret logger, strict DTO validation.

## Upload Security Rules

When handling archive uploads (ZIP):
1. **Zip Slip Prevention:** Check every entry path. If `path.normalize(entryName).startsWith('..')` or contains absolute paths, reject immediately.
2. **Forbidden Files:** Reject executable extensions: `.exe`, `.bat`, `.cmd`, `.sh`, `.bin`, `.msi`, `.dll`, `.so`, `.dylib`, `.vbs`, `.js`.
3. **Supported Formats Only:** `.pdf`, `.png`, `.jpg`, `.jpeg`, `.webp`, `.docx`, `.xlsx`.
4. **Limits:** Enforce maximum file size (512 MiB per file, 1 GiB total).
5. **No Public Raw Access:** Raw uploaded files are kept in private temporary storage and never exposed via public endpoints.

## Analytics Derivations

All calculations are performed server-side based on immutable records:
- `views`: Count of `archive_view` events.
- `downloads`: Count of `archive_download` events.
- `paid_unlocks`: Count of confirmed `payments`.
- `gross`: Sum of immutable archive prices for confirmed payments.
- `creator`: Gross * 0.95.
- `platform`: Gross * 0.05.
- `view_to_download`: `downloads / views` (or 0 if views === 0).
- `download_to_purchase`: `paid_unlocks / downloads` (or 0 if downloads === 0).
Periods supported: `7d`, `30d`, `all`.
