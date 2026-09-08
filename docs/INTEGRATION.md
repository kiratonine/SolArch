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
refresh device license after 72-hour offline window
```

До готового Backend:

- mock API;
- deterministic test entitlement/license;
- fake payment status only inside development test adapter.

Production/demo adapter не должен принимать client-side fake success.

---

## 5. Backend ↔ `solarch-core`

### 5.1 Ownership and lifecycle

Backend owns archive generation, the fresh 32-byte ACK and two separate Ed25519 signing keys (archive and license roles). Generate ACK using OS CSPRNG for every build attempt, including retries. Core encrypts/serializes and computes the signature preimage; **archive signing private key stays in Backend**, not in the child process. An in-process ArchiveBuilder receives a borrowed ACK and a signer callback implementing the same signed-message contract; it does not invent TypeScript `.slr` encryption.

Backend retains ACK in memory until a successful build is verified and encrypted key custody is committed. Persist only `content_key_ref` and authenticated encrypted key material under a Backend-only key-encryption key/secret-store boundary, separate from public storage and DB data credentials. Bind the protected record to archive ID and final fingerprint and validate that association before device wrapping. The encrypted storage encoding is Backend-private (not a `.slr`/API wire format); it must use a vetted authenticated secret-store/envelope API with nonce uniqueness, tamper rejection, access controls and rotation. Provider choice is an infrastructure decision, not permission to persist plaintext. Backups must not co-locate plaintext KEKs and their encrypted records.

Do not mark archive `ready`/publish until encrypted custody and verified finalized bytes are durable and linked atomically at the service level. Crash/failure before that point leaves no publishable artifact: discard the attempt and use a new ACK. ACK is later unsealed only in an authorized Backend wrapping operation and supplied as the 32-byte HPKE plaintext from [API.md](API.md#96-wrapped-content-key-w). Builder and Backend minimize/zeroize buffers best-effort; managed runtime copies cannot be guaranteed erased. No ACK/signing secret in argv, environment, logs, ordinary JSON stdout, `.slr`, repository or plaintext sidecar.

### 5.2 Production CLI handoff — protocol version 1

The intended command is `solarch create --input-dir <path> --metadata <path> --output <path> --signing-key-id <id> --signing-public-key <B64>`; all arguments are nonsecret. Metadata file is exactly the public header JCS schema; input files/manifest are discovered and validated by Core. Signing public key is canonical B64 of 32 Ed25519 bytes from trusted Backend config, never source uploads. This is the **future** CLI contract, not a claim the foundation command currently works.

Node launches the known local binary directly (`spawn`, `shell:false`) under a trusted service account with private piped stdin/stdout and bounded captured stderr. Do not use shell interpolation, inherited secret-bearing environment or process transcripts. Input/output directories are owned by the job, not attacker-selected server paths. Private ACLs/permissions apply to source uploads; builder scratch files contain only encrypted container bytes. Do not publish an incomplete output.

Exact sequential binary protocol, no newline between binary frames:

1. Parent writes to child stdin ASCII `SLRKEY01` (8 bytes) || ACK (32 bytes): **40 bytes**. It keeps stdin open for step 4. Child reads exactly this frame; there is no key string/JSON conversion.
2. Child prepares a private encrypted pending file at its output job location, with final 96-byte prelude, all encrypted sections and the first 40 bytes of the signature block. No signature yet. It flushes/closes writes for signing, computes `T = SHA256(pending bytes)` according to SLR_FORMAT, and sends stdout ASCII `SLRSIGN1` (8 bytes) || T (32 bytes): **40 bytes**, exclusively a public signing request. Pending filename is the output path plus `.pending`; create exclusively, no symlinks/overwrite. Parent and child prohibit external mutation under job-directory ACLs.
3. Backend validates that pending file using the independent trusted Core verification invocation in §5.3, supplying the original job ACK and stable authorized source/metadata. This checks AEAD, full file hashes, manifest/index/chunk coverage, header and source equality as well as structure. Physical size must be exactly prelude-declared final size minus 64, ending at S+40; this exception is only for trusted signing IPC, never normal `.slr` parsing. Backend independently recomputes T under the same no-mutation discipline and requires equality with both verifier output and the builder signing request. Only this authorized build can use the archive signer; it is not a generic remote signing oracle. Backend signs `D("SolArch/slr-signature/v1") || T` with pure Ed25519 using the configured archive-role key. Wrong digest/header/job or file mutation aborts.
4. Parent writes exactly **64 raw signature bytes** to stdin, then closes it. Child rejects early EOF/extra bytes, verifies the signature with the trusted configured public key, appends the 64 bytes, re-verifies the finalized file and computes its final full-file fingerprint. No re-encryption or header/offset rewrite after the signing request.
5. Child atomically renames the pending file to the output path without replacing an existing output, then writes one UTF-8 JCS success object followed by LF to stdout (after the earlier 40-byte binary frame), at most 4096 bytes including LF: `{ "success": true, "output_path": <exact output argument>, "archive_fingerprint": <64 lowercase hex>, "file_count": <integer>, "size_bytes": <integer> }`. Output paths must fit this bound. Exit code 0 means completed; all other exits mean failure.

Parent checks frame magic/length, final JSON schema, exit code, independent final fingerprint/signature and job linkage before custody/publish. No output key is returned. Overall job deadline is 900 seconds; verification/signature exchange after step 2 is bounded to 300 seconds. Parent concurrently drains stderr with a 16384-byte cap and accepts only sanitized diagnostic codes, not source/plaintext dumps. On protocol error, timeout, broken pipe, crash or nonzero exit, kill/reap child, zeroize secret buffers best-effort and remove incomplete encrypted job artifacts. Never retry signing/building by reusing ACK. Binary read/write fragmentation is allowed; frame boundaries are defined by exact lengths, not pipe packets.

An implementation unable to stream the format limits must fail explicitly with an implementation-limit error, not emit a different format. Current 64 MiB builder is temporary; production create/verify and this duplex protocol remain unimplemented until external review and user authorization.

### 5.3 Trusted pending-build verification boundary

Before signing, Parent invokes a fresh trusted `solarch verify --pending-build <pending-path> --input-dir <authorized-source-dir> --metadata <authorized-header-file> --signing-key-id <id>` process, with `shell:false` and private bounded pipes. Send exactly the same 40-byte `SLRKEY01 || ACK` frame then EOF; no signature follows in this verifier mode. This is another read-only use of the same attempt's ACK, not ACK reuse for encryption. The builder cannot provide a replacement ACK, source inventory, metadata file, executable or verification result. Backend owns and pins the input files/metadata and denies builder writes to them throughout the job. Verify the pending file through a stable handle and prohibit mutation until signing/finalization.

Verifier checks exact header/JCS equality to job metadata, signature prefix/key_id, signed-layout/resource rules with the sole pending-length exception, decrypts/authenticates manifest/index/every chunk using the job ACK, validates all schemas/cross-references/full file hashes, and independently traverses/hashes the stable authorized source directory to require exact normalized file inventory, MIME, sizes and hashes. No plaintext protected files are emitted. This catches wrong ACK, omitted/added/substituted content and inconsistent signed metadata; a structural-only success is insufficient.

Only after every check, stdout emits one JCS object plus LF, at most 4096 bytes: `{ "success": true, "signing_digest": <64 lowercase hex SHA256 of pending bytes>, "file_count": <integer>, "size_bytes": <declared finalized size including future signature> }`; exit code 0. Failure is nonzero, no success object, bounded sanitized stderr. Same 16384-byte stderr cap and enclosing 300-second verification/signature deadline apply; parent kills/reaps on timeout and never signs on partial output. A trusted in-process Core verifier may implement the identical validation and typed result instead of this CLI boundary. Ordinary `verify` on a finalized archive never accepts a missing signature or this exception.

This verifier is a contract for future Rust Core/CLI implementation, not TypeScript crypto and not implemented by this gate. Separate verification is correctness/defense in depth; a compromised trusted Core binary or Backend administrator already has access to ACK/plaintext and is not made safe by invoking the same compromised software twice.

## 6. Backend ↔ Viewer cryptographic contract

Normative ownership is [SLR_FORMAT.md](SLR_FORMAT.md) for container bytes/signature/fingerprint, [API.md](API.md#9-device-activation-and-cryptographic-wire-profile) for license/device/HPKE DTOs, and [SECURITY.md](SECURITY.md#17-trust-anchors-and-key-custody) for trust/custody. No branch may choose alternate encodings.

License construction order is P → JCS(P) → HPKE W → JCS({payload:P,wrapped_content_key:W}) → Ed25519 signature. Device/HPKE/API signature byte strings use canonical padded standard Base64; fingerprints/file hashes use lowercase SHA-256 hex, while container signatures remain raw binary. No final fingerprint in PublicHeader. Unknown versions/fields/key roles fail closed.

Payment/license authorization is device-first. Viewer supplies its canonical
X25519 key when creating the Payment Intent; Backend immutably binds it before
payment. The response carries an exact public Solana Pay transaction-request URL
and a separate private intent credential; the credential is absent from the QR.
Wallet POST `account` is construction input only. Backend creates a current
recent-blockhash transaction when no valid issuance exists, preserves immutable
95/5 economics/reference and stops issuance at the 30-minute intent deadline. An
issuance landed within its own blockhash validity is tracked through finality even
after that deadline. Full authoritative verification derives `buyer_wallet` and creates an
Entitlement whose sole Device A is that original key. Initial activation uses the
private intent credential; later refresh uses the separate device-bound refresh
token. Neither wallet proof/account/session nor opaque IDs authorize Viewer.
Exact endpoints, token handling, 72-hour offline behavior and errors are in API
§§7–10.

Library interoperability candidates: RustCrypto `chacha20poly1305`, `hkdf`, `sha2`, `ed25519-dalek`, and the Rust [`hpke` crate](https://docs.rs/hpke/latest/hpke/); Node [`@hpke/core` + `@hpke/dhkem-x25519`](https://github.com/dajiaji/hpke-js) with platform Ed25519 support and an RFC 8785 implementation. These are protocol-compatible candidates, not a claim every release/dependency has been independently audited. Pin/review versions before production implementation. HPKE sender contexts are one-shot; reject releases affected by [GHSA-73g8-5h73-26h4](https://github.com/dajiaji/hpke-js/security/advisories/GHSA-73g8-5h73-26h4) (`@hpke/core <=1.7.4`, fix 1.7.5). Vector tooling versions/results are recorded in the gate report; no project dependency is added by this gate.

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
awaiting_finality
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
- offline reopen before `offline_valid_until` works without Backend;
- device-token refresh after the deadline works only for Device A;
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


## 15. Deterministic interoperability vectors

**SYNTHETIC / TEST ONLY. ALL PRIVATE VALUES HERE ARE PUBLIC TEST MATERIAL.** They are arithmetic byte sequences, deliberately nonsecret; never import these keys into production trust maps, generate real archives with them, or reuse deterministic HPKE randomness. The timestamp is fixed test time; the license is valid only in a test clock window and does not grant real access/payment entitlement. Wallet `11111111111111111111111111111111` is a shape-valid placeholder, not a real paid buyer/creator. File is a synthetic 1×1 PNG with validated PNG chunk CRCs.

This section fixes one complete 1166-byte v1 encrypted container and its corresponding license/HPKE response. Values are exact (no omitted bytes); code-block line terminators are not data. JCS lines are UTF-8 without newline. Base64 is standard padded; hex is lowercase. `D`, U32/U64 and encryption/signature recipes are defined in SLR_FORMAT.md. Hex seeds are exactly 32 bytes, not expanded 64-byte Ed25519 secret-key formats.

### 15.1 Test inputs and public keys

| Input | Exact value |
|---|---|
| ACK hex | `a0a1a2a3a4a5a6a7a8a9aaabacadaeafb0b1b2b3b4b5b6b7b8b9babbbcbdbebf` |
| Archive Ed25519 seed hex (arc-test-01) | `000102030405060708090a0b0c0d0e0f101112131415161718191a1b1c1d1e1f` |
| License Ed25519 seed hex (lic-test-01) | `404142434445464748494a4b4c4d4e4f505152535455565758595a5b5c5d5e5f` |
| Recipient HPKE DeriveKeyPair IKM hex | `202122232425262728292a2b2c2d2e2f303132333435363738393a3b3c3d3e3f` |
| Sender HPKE DeriveKeyPair IKM hex | `606162636465666768696a6b6c6d6e6f707172737475767778797a7b7c7d7e7f` |
| Resulting recipient raw X25519 private key hex | `3caa61bc13e56473e913a85c33cf4d603ac99a517eea95ed4573e772b64435f7` |
| Device public key B64 | `aTZYJUYw9zrY2nj7Mxv5ds1C+Q4OnJ6D9AxRBypvdBc=` |
| Archive verification key B64 | `A6EHv/POEL4dcN0Y50vAmWfk1jCbpQ1fHdyGZBJVMbg=` |
| License verification key B64 | `JUO5L/EJVRFHatyDadtt3JM2ZaEZeN2hQE7hBmypVZ0=` |
| Synthetic intent client secret TOKEN32 (bytes 00..1f) | `AAECAwQFBgcICQoLDA0ODxAREhMUFRYXGBkaGxwdHh8` |
| Synthetic device refresh token TOKEN32 (bytes e0..ff) | `4OHi4-Tl5ufo6err7O3u7_Dx8vP09fb3-Pn6-_z9_v8` |

Recipient and ephemeral test key pairs are generated with RFC 9180 DHKEM(X25519, HKDF-SHA256) `DeriveKeyPair(ikm)` (including the RFC clamping behavior); the listed IKM is **not** directly the X25519 private scalar. Production uses fresh CSPRNG randomness. HPKE JS vector generation supplies sender IKM through its test-only `ekm` parameter; receiver uses the resulting raw private key. Request nonce is bytes 80 through 9f hexadecimal, encoded in P. Synthetic `issued_at` is 2026-09-07T00:00:00Z and `offline_valid_until` is exactly 72 hours later.

Plain file `a.png`, Base64:

```text
iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+ip1sAAAAASUVORK5CYII=
```

Exact header JCS:

```json
{"archive_id":"arc_test_01","backend":{"archive_api_id":"arc_test_01"},"commercial_snapshot":{"platform_fee_bps":500,"price_amount":"10.000000","price_currency":"USDC"},"created_at":"2026-09-07T00:00:00Z","creator_wallet":"11111111111111111111111111111111","crypto":{"chunk_size":1048576,"content_algorithm":"XChaCha20-Poly1305","kdf":"HKDF-SHA-256"},"format":"solarch","license_snapshot":{"allow_export":false,"max_devices":1,"watermark_enabled":true},"title":"Test archive","version":"1.0.0"}
```

Exact manifest JCS:

```json
{"archive_id":"arc_test_01","files":[{"chunks":[0],"display_name":"a.png","file_id":"file_000000","hash":"5e3d382db4dd83d59aa5742793ad6b7903409e865c83bcbc54835049f043bc15","mime_type":"image/png","path":"a.png","size_bytes":68,"viewer_policy":{"export_allowed":false,"internal_viewer_only":true,"watermark_required":true}}]}
```

### 15.2 Container bytes, signature and fingerprint

Construct the file as prelude || JCS header || encrypted manifest || encrypted index || ASCII DAT1 || U32(1) || encrypted chunk || signature prefix || raw decoded archive signature. Ciphertext values include tags. The prelude already contains final offsets/lengths; no fixup is performed after signing.

| Component | Exact bytes/encoding |
|---|---|
| Prelude hex | `534f4c415243480001000000000000006000000000000000ee010000000000004e020000000000005401000000000000a2030000000000002800000000000000ca030000000000005c0000000000000026040000000000006800000000000000` |
| Index plaintext hex | `494458310100000008000000000000005400000044000000` |
| Encrypted Manifest B64 | `ee6Ey9bkJlP14qJE3IsofL7fCTOYlvVNlgIUQWbhqRjVhtGedeJM9cB/kcb5aRYzalIPHSmHM6a3jfmcS3wT41SGQGAwEzRn/99QzgpmeLpXQYdMVgsFrIcwJ8azHDOQY5OqZ4v3ypyJxIBJp3YzFw64BzOy4WDM3AEbvl14Rr1SNALEdgUeQj06unz6LU8mDRg3JE1LdCLj6F+mznxEMwTLjTHjeMRM4ZjeUb7R+Q1Li7qZWz95KmK0WzxNC5qvxRUqOxpyrke8eHLnMuQqvECugJNh4duaF7DODKQ+BQzqKaRCbdcWt5rk8RtMZ561B7BvY8uFiafxFPftoQgjV2dLPy+HkJDo5Wvh+lWLumAki/wwJoDg9G1wMtNYjDoSiTwK7Gg5nPY0cAVj4CWH4lhdcCkmF1fHpzEgs+Gek8dDTYKzhZZ7gFfQvGPadHeE/pqDZw==` |
| Encrypted Index B64 | `XfPKiB8y+aQ6h7gJWlUACfSb5juUDNc9NscC8USJ+3AZBO8UIqRpqQ==` |
| Encrypted chunk 0 B64 | `MV0kMlRKC434y2k0ndOkn8TPLc4dgoCdMfn22FCsq2ItIeuenjfvzRo+i8V+TZEl1AafwfPRUR+rHZo4dp2IGX75gOeIpAQtWJkX6vmsiKgbZyv4` |
| 40-byte signature prefix hex | `53494731010001006172632d746573742d3031000000000000000000000000000000000000000000` |
| SHA256 signature preimage T hex | `7acfe5c1f45a80ade61ed480b38db5637be34936f25008845640c0f6eb4f5fbb` |
| Exact archive signed message hex | `536f6c417263682f736c722d7369676e61747572652f7631007acfe5c1f45a80ade61ed480b38db5637be34936f25008845640c0f6eb4f5fbb` |
| 64-byte archive signature B64 | `xKbT/DWqZU8QM05ySQ8lnRzmXV0Soqyi7keMVhvmd4JjGwclejZjbjqyUNly5NwTPlTigDv3xhdpAa5zw9fuBw==` |
| SHA256(header) hex | `a5010b5fd7206692fe71fe28deca70c4d1597b6eeed75027e7597bdfe0731a75` |
| Final archive fingerprint | `57ce84068fdd9b23f8860afa27834151f4fefb038d812c2ac77e8a861b1eecdb` |

Header = 494 bytes; manifest plaintext = 324 bytes; finalized file = 1166 bytes. Final fingerprint includes the raw 64-byte signature. This same fingerprint is bound into P below.

For an independent direct fingerprint check, the **entire finalized file** as Base64 is:

```text
U09MQVJDSAABAAAAAAAAAGAAAAAAAAAA7gEAAAAAAABOAgAAAAAAAFQBAAAAAAAAogMAAAAAAAAoAAAAAAAAAMoDAAAAAAAAXAAAAAAAAAAmBAAAAAAAAGgAAAAAAAAAeyJhcmNoaXZlX2lkIjoiYXJjX3Rlc3RfMDEiLCJiYWNrZW5kIjp7ImFyY2hpdmVfYXBpX2lkIjoiYXJjX3Rlc3RfMDEifSwiY29tbWVyY2lhbF9zbmFwc2hvdCI6eyJwbGF0Zm9ybV9mZWVfYnBzIjo1MDAsInByaWNlX2Ftb3VudCI6IjEwLjAwMDAwMCIsInByaWNlX2N1cnJlbmN5IjoiVVNEQyJ9LCJjcmVhdGVkX2F0IjoiMjAyNi0wOS0wN1QwMDowMDowMFoiLCJjcmVhdG9yX3dhbGxldCI6IjExMTExMTExMTExMTExMTExMTExMTExMTExMTExMTExIiwiY3J5cHRvIjp7ImNodW5rX3NpemUiOjEwNDg1NzYsImNvbnRlbnRfYWxnb3JpdGhtIjoiWENoYUNoYTIwLVBvbHkxMzA1Iiwia2RmIjoiSEtERi1TSEEtMjU2In0sImZvcm1hdCI6InNvbGFyY2giLCJsaWNlbnNlX3NuYXBzaG90Ijp7ImFsbG93X2V4cG9ydCI6ZmFsc2UsIm1heF9kZXZpY2VzIjoxLCJ3YXRlcm1hcmtfZW5hYmxlZCI6dHJ1ZX0sInRpdGxlIjoiVGVzdCBhcmNoaXZlIiwidmVyc2lvbiI6IjEuMC4wIn157oTL1uQmU/XiokTciyh8vt8JM5iW9U2WAhRBZuGpGNWG0Z514kz1wH+RxvlpFjNqUg8dKYczpreN+ZxLfBPjVIZAYDATNGf/31DOCmZ4uldBh0xWCwWshzAnxrMcM5Bjk6pni/fKnInEgEmndjMXDrgHM7LhYMzcARu+XXhGvVI0AsR2BR5CPTq6fPotTyYNGDckTUt0IuPoX6bOfEQzBMuNMeN4xEzhmN5RvtH5DUuLuplbP3kqYrRbPE0Lmq/FFSo7GnKuR7x4cucy5Cq8QK6Ak2Hh25oXsM4MpD4FDOoppEJt1xa3muTxG0xnnrUHsG9jy4WJp/EU9+2hCCNXZ0s/L4eQkOjla+H6VYu6YCSL/DAmgOD0bXAy01iMOhKJPArsaDmc9jRwBWPgJYfiWF1wKSYXV8enMSCz4Z6Tx0NNgrOFlnuAV9C8Y9p0d4T+moNnXfPKiB8y+aQ6h7gJWlUACfSb5juUDNc9NscC8USJ+3AZBO8UIqRpqURBVDEBAAAAMV0kMlRKC434y2k0ndOkn8TPLc4dgoCdMfn22FCsq2ItIeuenjfvzRo+i8V+TZEl1AafwfPRUR+rHZo4dp2IGX75gOeIpAQtWJkX6vmsiKgbZyv4U0lHMQEAAQBhcmMtdGVzdC0wMQAAAAAAAAAAAAAAAAAAAAAAAAAAAMSm0/w1qmVPEDNOckkPJZ0c5l1dEqKsou5HjFYb5neCYxsHJXo2Y246slDZcuTcEz5U4oA798YXaQGuc8PX7gc=
```

### 15.3 License and wrapped key

Exact canonical P (`L = JCS(P)`):

```json
{"archive_fingerprint":"57ce84068fdd9b23f8860afa27834151f4fefb038d812c2ac77e8a861b1eecdb","archive_id":"arc_test_01","buyer_wallet":"11111111111111111111111111111111","device_public_key":"aTZYJUYw9zrY2nj7Mxv5ds1C+Q4OnJ6D9AxRBypvdBc=","entitlement_id":"ent_test_01","issued_at":"2026-09-07T00:00:00Z","key_id":"lic-test-01","license_id":"lic_test_01","offline_valid_until":"2026-09-10T00:00:00Z","request_nonce":"gIGCg4SFhoeIiYqLjI2Oj5CRkpOUlZaXmJmam5ydnp8=","rights":{"export":false,"max_devices":1,"open":true,"watermark_enabled":true},"status":"active","version":1}
```

Exact W:

```json
{
  "version": 1,
  "kem_id": 32,
  "kdf_id": 1,
  "aead_id": 2,
  "enc": "utdi4JhEbLzFizDH6AT4KEe4uREYWZZYKvnye/1Oh18=",
  "ciphertext": "GO7bNoKdgUkCfV0rm1B3O7zAZPDfjLgoajBypokNP5+GsUXCjUMLys2HbagyFi6I"
}
```

HPKE uses recipient public key from §15.1, sender IKM from §15.1, plaintext ACK from §15.1, sequence 0. Exact info hex:

```text
536f6c417263682f636f6e74656e742d6b65792d777261702f696e666f2f763100ed7e4c240d01e8e7fce8605ad64a39c61166cc728192c33f255605658631a375
```

AAD bytes are exactly `D("SolArch/content-key-wrap/aad/v1") || L`; SHA-256(AAD) is `f12f0d131949363df5882be254a1da81e03eecd3917b9f415355a9ea16c4cbe5`. This hash is an expected check, **not** a replacement for AAD.

Exact JCS signature object Q:

```json
{"payload":{"archive_fingerprint":"57ce84068fdd9b23f8860afa27834151f4fefb038d812c2ac77e8a861b1eecdb","archive_id":"arc_test_01","buyer_wallet":"11111111111111111111111111111111","device_public_key":"aTZYJUYw9zrY2nj7Mxv5ds1C+Q4OnJ6D9AxRBypvdBc=","entitlement_id":"ent_test_01","issued_at":"2026-09-07T00:00:00Z","key_id":"lic-test-01","license_id":"lic_test_01","offline_valid_until":"2026-09-10T00:00:00Z","request_nonce":"gIGCg4SFhoeIiYqLjI2Oj5CRkpOUlZaXmJmam5ydnp8=","rights":{"export":false,"max_devices":1,"open":true,"watermark_enabled":true},"status":"active","version":1},"wrapped_content_key":{"aead_id":2,"ciphertext":"GO7bNoKdgUkCfV0rm1B3O7zAZPDfjLgoajBypokNP5+GsUXCjUMLys2HbagyFi6I","enc":"utdi4JhEbLzFizDH6AT4KEe4uREYWZZYKvnye/1Oh18=","kdf_id":1,"kem_id":32,"version":1}}
```

License signed bytes are exactly `D("SolArch/license-signature/v1") || Q`, length **812** bytes; SHA-256 of those bytes is `17ae2291fde9757ddbae9a07913c3c068a246d6b7971041468d2dce2f7ad187a`. Sign the bytes themselves with pure Ed25519; the listed hash is only a diagnostic expected result.

`server_signature` (B64, 64 raw bytes):

```text
wLcOtVg7S0qywsufOSmRTPHACKPxVTO5qYivffQ5Xk0ylSvAjIV7b5u4LlnEycUM++zQ/5d5nMr4tTUaiWg1BA==
```

The complete refresh response is the closed object
`{"license":{"payload":P,"server_signature":the value above},"wrapped_content_key":W}`.
The complete initial-activation response contains those same `license` and
`wrapped_content_key` fields plus
`"device_refresh_token":"4OHi4-Tl5ufo6err7O3u7_Dx8vP09fb3-Pn6-_z9_v8"`.
That synthetic token is outside Q and is not signed. Replace P/W metavariables
with the exact objects/strings above; no other fields. Original property
order/whitespace may vary in HTTPS JSON, but the canonical P/Q bytes must match.

### 15.4 Required independent reproduction

Future Core and Backend fixtures must reproduce every byte above and reject altered header/signature metadata, modified wrapper/signature/AAD/info, wrong device, and noncanonical encodings. A same-library encrypt/decrypt round-trip alone does not demonstrate interoperability. Gate verification used independent Node and Rust implementations as recorded in the report; no production fixture tooling or feature code was installed in this repository. Test-only keys are not deployment trust anchors. Intent/refresh credentials are authorization-layer values and are not inputs to P/W cryptographic vectors.
