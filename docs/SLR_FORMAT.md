# SolArch — `.slr` Format v1

**Status:** INTEGRATION_GATE_01 contract frozen after external review; Part 01 production Rust Core/CLI implementation complete, Backend/Viewer integration pending.
**Extension:** `.slr`; MIME `application/x-solarch`. Normative v1 profile below replaces the earlier conceptual layout and is implemented by the Part 01 Rust Core/CLI.

## 1. Scope and notation

Self-contained encrypted PDF, PNG, JPG/JPEG, WebP, DOCX and XLSX content; Windows internal viewing, practical DRM. No executable content, export or external open. Payment, Entitlement, Device License and Content Key remain separate.

`||` means byte concatenation; ranges `[a,b)` exclude b. All container integers are unsigned little-endian. `U32(n)` and `U64(n)` encode exactly 4 and 8 bytes. `D(s)` is the ASCII bytes of the quoted string **followed by one byte 00**; no newline. SHA-256 returns 32 raw bytes unless hex is explicitly requested. AEAD ciphertext includes its final 16-byte authentication tag. No compression is performed by the container.

`JCS(x)` is UTF-8 [RFC 8785](https://www.rfc-editor.org/rfc/rfc8785.html) canonical JSON, without BOM/newline. Reject duplicate properties before mapping into objects, unknown/missing properties, invalid Unicode, non-integer numbers and out-of-range values. The schemas below are closed. Header and manifest bytes MUST equal their JCS reserialization. JSON depth is at most 16, counting the root object as depth 1. Canonicalization does not normalize string content; path normalization is an explicit separate rule.

## 2. Prelude and section layout

Prelude is exactly 96 bytes:

| Offset | Bytes | Value |
|---|---:|---|
| 0 | 8 | hex `534f4c4152434800` (`SOLARCH` + NUL) |
| 8 | 2 | major = 1 |
| 10 | 2 | minor = 0 |
| 12 | 4 | reserved = 0 |
| 16 | 16 | Public Header offset u64, length u64 |
| 32 | 16 | Encrypted Manifest offset u64, length u64 |
| 48 | 16 | Encrypted Index offset u64, length u64 |
| 64 | 16 | Encrypted Data offset u64, length u64 |
| 80 | 16 | Signature Block offset u64, length u64 |

Sections are in this exact order and contiguous: first offset = 96; each next offset = previous offset + previous length; signature end = physical file length. No gaps, overlaps, trailing bytes, implicit alignment or extra sections. Check addition overflow before use. Unsupported major/minor/reserved values fail closed. All five sections are nonempty; their minimum/maximum sizes follow their schemas below.

## 3. Public Header

Exact required shape (example values):

```json
{
  "format": "solarch",
  "version": "1.0.0",
  "archive_id": "arc_test_01",
  "created_at": "2026-09-07T00:00:00Z",
  "title": "Test archive",
  "creator_wallet": "11111111111111111111111111111111",
  "commercial_snapshot": {
    "price_amount": "10.000000",
    "price_currency": "USDC",
    "platform_fee_bps": 500
  },
  "license_snapshot": {
    "max_devices": 1,
    "allow_export": false,
    "watermark_enabled": true
  },
  "backend": {"archive_api_id": "arc_test_01"},
  "crypto": {
    "content_algorithm": "XChaCha20-Poly1305",
    "kdf": "HKDF-SHA-256",
    "chunk_size": 1048576
  }
}
```

Literal format/version/crypto/policy/currency/fee values above are mandatory. IDs are ASCII `[A-Za-z0-9_-]{1,128}` and opaque; `backend.archive_api_id` equals `archive_id`. `created_at` is a valid Gregorian UTC time, exactly `YYYY-MM-DDTHH:MM:SSZ`, years 1970–9999, seconds 00–59, no offsets/fractions/leap seconds. Title is 1–1024 UTF-8 bytes, no NUL. Creator wallet is canonical Solana Base58 decoding to 32 bytes (re-encode equality). Header price is positive USDC units with exactly six fractional digits, no sign/exponent/leading integer zero except `0`, and at most 20 digits total excluding decimal point; the integer USDC base-unit amount must not exceed 18446744073709551615. Compare API prices by exact USDC base units, not floating point or textual decimal length.

**No `archive_fingerprint`, key, verification public key or Backend URL is stored in this header.** The final fingerprint includes the signature; embedding it here would create a hash cycle. `public_header_hash` in Backend storage is lowercase hex SHA-256 of the exact header bytes.

Header is a signed snapshot, not authorization. Backend remains authoritative for status, payment recipients, payment verification, Entitlement and license state. Compare archive ID, creator wallet, immutable price/currency/fee, policy and final fingerprint with authenticated Backend metadata before payment/unlock. Title may differ from editable marketplace presentation. Backend origin comes from trusted Viewer configuration, never from container input.

## 4. Manifest and paths

Manifest plaintext is JCS of the following closed schema:

```json
{
  "archive_id": "arc_test_01",
  "files": [{
    "file_id": "file_000000",
    "path": "a.pdf",
    "display_name": "a.pdf",
    "mime_type": "application/pdf",
    "size_bytes": 1,
    "hash": "0000000000000000000000000000000000000000000000000000000000000000",
    "chunks": [0],
    "viewer_policy": {
      "internal_viewer_only": true,
      "export_allowed": false,
      "watermark_required": true
    }
  }]
}
```

This is a schema illustration, not a valid file-hash vector. `archive_id` equals the header. `files` contains 1–10000 entries sorted lexicographically by normalized path UTF-8 bytes. File ID is `file_` plus zero-based ordinal, exactly six decimal digits. `display_name` equals the last path component. `hash` is exactly 64 lowercase hexadecimal characters, SHA-256 of the complete original file bytes. Sizes and chunk IDs are JSON integers within the limits below. Policy literal values above are mandatory.

Each nonempty file is split separately into 1048576-byte plaintext chunks; only its last chunk may be shorter (1–1048576 bytes). Empty files have size 0 and no chunks. Global chunk IDs start at 0 in file order, are contiguous and owned exactly once. Manifest chunk lists preserve file order, cover the whole index exactly once, and their plaintext lengths sum to the file size and global total. No shared, orphaned or duplicate chunks.

Encrypted Manifest is not the Marketplace Public Listing. Public APIs never expose internal chunk maps, ACK, private storage paths or private crypto metadata; public listing fields remain separately owned by Backend.

MIME values are exactly `application/pdf`, `image/png`, `image/jpeg`, `image/webp`, `application/vnd.openxmlformats-officedocument.wordprocessingml.document`, or `application/vnd.openxmlformats-officedocument.spreadsheetml.sheet`. Supported extensions must match type/content validation; an extension alone is not validation for a nonempty file. The explicit size-0 exception in §4 has no content bytes to probe, so its supported extension selects the exact MIME and its hash is SHA-256 of empty bytes.

Builder normalizes separators to `/` and Unicode to NFC (Unicode 15.1). Persisted paths must already be normalized. Reject absolute/drive/UNC paths, empty/`.`/`..` components, NUL/control characters U+0000–001F/U+007F, Windows forbidden characters `< > : " | ? *`, trailing dot/space components, and Windows reserved base names (ASCII case-insensitive `CON`, `PRN`, `AUX`, `NUL`, `COM1`–`COM9`, `LPT1`–`LPT9`, including extensions and superscript ¹/²/³ device digits). Reject symlinks/reparse points in source traversal. Duplicate/collision key is NFC of Unicode 15.1 default full case folding of the NFC path; reject equal keys and file/directory prefix conflicts. Limits apply after normalization; no truncation to fit. Part 01 implements these rules with Unicode and compatibility fixtures.

## 5. Encrypted Index and Data

Index plaintext is binary: ASCII `IDX1` (4 bytes), `U32(chunk_count)`, then exactly `chunk_count` 16-byte records in chunk-ID order. Each record is `U64(offset) || U32(ciphertext_length) || U32(plaintext_length)`. Offsets are relative to the start of Encrypted Data. Ciphertext length = plaintext length + 16; plaintext length is 1–1048576.

Data is ASCII `DAT1` || `U32(chunk_count)` || concatenated chunk ciphertexts. First record offset = 8; every subsequent record immediately follows the previous ciphertext; final record end = data section length. For zero chunks the index is 8 bytes before encryption and data is exactly 8 bytes. Both counts must match manifest references. No unindexed bytes or per-record nonce fields. Authenticate/decode the index before using its offsets; recheck bounds against the signed prelude.

## 6. Content encryption and domain separation

Backend generates a fresh, independent 32-byte random Archive Content Key (ACK) for **every generation attempt**, including retries. Never reuse an ACK to rebuild, edit or re-encrypt an archive. The existing finalized bytes may be copied without re-encryption. Custody/handoff is in [INTEGRATION.md](INTEGRATION.md#5-backend--solarch-core).

Let `H = SHA256(exact Public Header bytes)`. Use [HKDF-SHA-256 (RFC 5869)](https://www.rfc-editor.org/rfc/rfc5869.html): `PRK = HKDF-Extract(salt=H, IKM=ACK)`. Derive separate 32-byte keys with `HKDF-Expand(PRK, info, 32)`:

| Purpose | Exact info (notation D includes final NUL) |
|---|---|
| Manifest | D("SolArch/slr/manifest-key/v1") |
| Index | D("SolArch/slr/index-key/v1") |
| Content chunks | D("SolArch/slr/content-key/v1") |

Encrypt with XChaCha20-Poly1305 (32-byte key, 24-byte nonce, 16-byte tag; the deployed XChaCha construction in [draft-arciszewski-xchacha-03](https://datatracker.ietf.org/doc/html/draft-arciszewski-xchacha-03) and [RustCrypto](https://docs.rs/chacha20poly1305/0.10.1/chacha20poly1305/), not an IETF RFC). Exact per-message parameters:

| Message | Key | Nonce | AAD |
|---|---|---|---|
| Manifest | manifest key | 24 zero bytes | D("SolArch/slr/manifest-aad/v1") \|\| H \|\| U64(plaintext byte length) |
| Index | index key | 24 zero bytes | D("SolArch/slr/index-aad/v1") \|\| H \|\| U64(plaintext byte length) |
| Chunk i | content key | 16 zero bytes \|\| U64(i) | D("SolArch/slr/chunk-aad/v1") \|\| H \|\| U64(i) \|\| U64(plaintext byte length) |

Encrypted Manifest/Index sections are ciphertext followed by tag, with no nonce/salt prefix. Their plaintext lengths are section length minus 16. Chunk lengths come from the authenticated index. Manifest/index keys are each used once; chunk IDs never repeat under a content key. Fresh ACK per attempt is mandatory for the deterministic nonce scheme. Zeroize ACK, PRK, derived keys and plaintext buffers best-effort; do not put secrets in logs/disk/argv. No custom cryptographic primitive or alternate suite negotiation in v1.

## 7. Signature and trust

Signature Block is exactly 104 bytes:

| Relative offset | Bytes | Value |
|---|---:|---|
| 0 | 4 | ASCII `SIG1` |
| 4 | 2 | block version 1, little-endian |
| 6 | 2 | algorithm ID 1 = pure Ed25519 |
| 8 | 32 | key_id ASCII, right-padded with zero bytes |
| 40 | 64 | raw Ed25519 signature |

`key_id` matches `[a-z0-9_-]{1,32}`. Strip only right padding; reject embedded NUL followed by nonzero bytes or invalid characters. A 32-character ID needs no padding. Key ID selects **only** a pretrusted archive-role key; it is authenticated by the signature.

Let `S` be the signature-block offset from the validated final prelude. Compute `T = SHA256(file[0,S+40))`. The exact signed message is `D("SolArch/slr-signature/v1") || T`. Sign using **pure Ed25519 per [RFC 8032](https://www.rfc-editor.org/rfc/rfc8032.html)**, not Ed25519ph, not an Ed25519 context mode and not a second API-level prehash. This is a domain-separated SHA-256 digest signed with ordinary Ed25519. All file bytes except the final 64 signature bytes are covered, including final offsets, lengths, ciphertext and signature metadata. Compute T by bounded streaming.

Reject noncanonical Ed25519 encodings, scalar S >= group order, small-order public keys or R points, failed strict verification, unknown keys and wrong key role. No embedded public key establishes trust. [SECURITY.md](SECURITY.md#17-trust-anchors-and-key-custody) defines bundled Windows Viewer trust anchors and rotation. Backend owns the archive signing private key; it never enters Viewer or the builder process.

## 8. Fingerprint

`archive_fingerprint = lowercase_hex(SHA256(all finalized .slr bytes))`.

No domain prefix, no filename, no JSON reserialization and no omitted bytes. Raw digest is 32 bytes; wire text is exactly 64 lowercase ASCII hex characters (`[0-9a-f]{64}`), no `0x`, algorithm prefix, padding or whitespace. Compute **after** the final signature is written, including all 104 signature-block bytes. It is immutable for those finalized bytes; signing-key rotation/resigning changes the fingerprint and cannot silently replace a published archive. Future algorithms require a new contract/version.

Fingerprint identifies bytes and supports Backend equality checks; it alone does not authenticate an attacker-provided archive. Container signature authenticates the entire encrypted structure; per-message AEAD protects decrypted content and context; file hashes verify complete reassembly. No separate redundant integrity block is added.

## 9. MVP limits (all must hold)

| Resource | Exact maximum / rule |
|---|---:|
| Finalized `.slr` bytes | 1073741824 (1 GiB) |
| Total protected plaintext | 536870912 (512 MiB), sum of file sizes |
| Single protected file | 536870912 bytes |
| Protected file count | 10000, minimum 1 |
| Default/maximum chunk plaintext | 1048576 bytes, fixed except each file's last chunk |
| Global chunk count / references | 16384 |
| Public Header | 65536 bytes |
| Encrypted Manifest | 16777216 bytes including tag |
| Encrypted Index | 262168 bytes = 8 + 16384*16 + 16 |
| Signature Block | exactly 104 bytes |
| Normalized path | 4096 UTF-8 bytes |
| Path component | 255 UTF-8 bytes |
| Path depth | 32 components |
| JSON depth | 16 |

For nonempty files, sum of `ceil(file_size / 1048576)` is at most 10511 under the total/file-count caps, below 16384. Metadata limits are independent: an input under file/path-count caps may still fail the manifest-byte cap. Data length is exactly 8 + total plaintext + 16*chunk_count. Total file length must also pass the 1 GiB ceiling. Reject claimed lengths/counts before allocation; use checked arithmetic, bounded streaming for whole-file verification and bounded metadata buffers. No allocation proportional to an unchecked offset/count.

Foundation values 16 GiB plaintext, 65536 chunks, 1000000 references and the former 64 MiB in-memory builder ceiling are **not** production v1 semantics. The Part 01 production builder and verifier stream data under the frozen limits above; no production compatibility is claimed for the removed foundation in-memory test structs.

## 10. Validation order and failures

1. Bounded prelude read; physical-size, version, section arithmetic and resource checks.
2. Bounded header parsing; strict schema/JCS/policy checks. Until step 3 public metadata is explicitly UNVERIFIED.
3. Parse fixed signature metadata; select bundled archive-role key; stream signed digest and strict-verify signature. Compute final fingerprint over the same finalized file, including signature.
4. Before payment, fetch public authoritative metadata through the trusted origin
   and compare immutable fields/fingerprint. On later offline open, use the last
   verified metadata plus signed license until `offline_valid_until`; an online
   refresh rechecks current Backend archive state. A valid container signature
   never implies published/paid/active status.
5. Load a locally stored signed license/wrapper or obtain activation/refresh
   according to [API.md](API.md#9-device-activation-and-cryptographic-wire-profile);
   verify signature, device/archive/fingerprint/policy/time and best-effort clock
   state before HPKE unwrap. After the 72-hour deadline, refresh is mandatory.
6. Decrypt and validate bounded manifest/index; enforce cross-references and data coverage; decrypt only selected chunks and authenticate before rendering. Validate full file hash when assembling a complete file. No unauthenticated plaintext is displayed.

Any integrity, unsupported schema/version, key, bounds or authorization failure stops unlock; do not try alternate algorithms/keys/decoders. Report typed sanitized errors. Structural `inspect` is not `verify`. Use a stable file handle and detect/prevent modification between verification and reads (Windows sharing deny-write/delete, or an equivalent immutable encrypted snapshot); copying encrypted bytes is permitted, plaintext snapshots are not.

## 11. Evolution and vectors

Unknown fields and versions fail closed. A breaking layout/crypto change requires a new major profile and reviewed docs/fixtures before implementation. Adding a trusted verification key through a signed Viewer release does not change v1 bytes; changing suites or signed payload schemas does.

Deterministic byte-level vectors and synthetic-key warnings are in [INTEGRATION.md](INTEGRATION.md#15-deterministic-interoperability-vectors). Part 01 implements the production create/verify paths and covers malformed/truncated structures, signature metadata mutation, wrong tags, path collisions and limit boundaries; Backend/Viewer interoperability remains pending.
