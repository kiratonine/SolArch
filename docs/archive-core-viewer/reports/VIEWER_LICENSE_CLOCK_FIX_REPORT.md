# Viewer License Response Clock Fix

Date: 2026-09-22  
Status: VERIFIED FOR REVIEW

## Root cause

The Viewer sampled `ProcessClockSample` before the Backend activation or refresh request and reused that stale sample to validate the newly returned signed grant. A grant issued during the request could therefore have `issued_at` one or two seconds later than the validation context, correctly triggering the existing fail-closed `now < issued_at` rejection.

`docs/API.md` and `docs/SECURITY.md` require strict license time validation. This fix does not add clock tolerance, alter `issued_at`, or change the 72-hour signed window.

## Changes

- `apps/viewer/src-tauri/src/clock.rs`
  - added an injectable `ClockSource`; production delegates to the existing `process_clock_sample()` implementation.
- `apps/viewer/src-tauri/src/payment_service.rs`
  - activation and refresh sample the clock only after a successful Backend response;
  - the same fresh sample is used for grant validation, rollback high-water reset, and returned to the application state;
  - deterministic fixed/sequence clock sources keep tests independent of the execution date;
  - added activation and refresh regressions where the Backend issues the signed grant two seconds after the request-start time.
- `apps/viewer/src-tauri/src/lib.rs`
  - `open_archive_flow`, activation, and refresh use the returned post-response sample for `unlocked_snapshot` instead of the pre-request sample.

No Backend/API/`.slr`/crypto/payment/license-policy changes were made. `PUBLIC_API_ORIGIN` and `SOLARCH_BACKEND_ORIGIN` were not changed, and no local license data was removed.

## Verification

- `rtk cargo fmt --check` — PASS.
- `rtk cargo test --workspace` — PASS, 131 tests across 7 suites.
- `rtk cargo clippy --workspace --all-targets -- -D warnings` — PASS, no issues.
- `rtk pnpm --filter @solarch/viewer lint` — PASS.
- `rtk pnpm --filter @solarch/viewer test` — PASS, 54 tests in 5 files.
- `rtk pnpm --filter @solarch/viewer build` — PASS.
- Targeted activation regression — PASS.
- Targeted refresh regression — PASS.

The full Rust suite retains the existing fail-closed coverage for expired/revoked grants, rollback state, wrong device, forged signatures, and wrong/outstanding nonce handling.

## Limitations

No new Windows installer was built, as requested. This verification covers the Rust boundary and Viewer frontend in the current WSL checkout; the live Windows Backend refresh should be repeated after review using the existing ngrok configuration.
