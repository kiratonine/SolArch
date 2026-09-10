---
name: solarch-drm-licensing
description: >-
  Generates canonical RFC 8785 JCS licenses, wraps content keys (ACK) using RFC 9180 HPKE Base mode,
  signs with Ed25519, enforces 72-hour offline windows, and prevents request nonce replays.
---

# SolArch DRM Licensing & Cryptography Skill

This skill provides guidelines and implementations for creating cryptographic licenses and wrapping content keys bound to user devices.

## Crytographic Profile

- **KEM:** DHKEM(X25519, HKDF-SHA256) (`kem_id = 32`)
- **KDF:** HKDF-SHA256 (`kdf_id = 1`)
- **AEAD:** AES-256-GCM (`aead_id = 2`)
- **JCS:** RFC 8785 JSON Canonicalization Scheme (deterministic field ordering and number formatting)
- **Signature:** Ed25519 over domain-separated message

## License Issuance Procedure

### 1. Payload P Construction
```json
{
  "version": 1,
  "key_id": "lic-prod-01",
  "license_id": "lic_...",
  "entitlement_id": "ent_...",
  "archive_id": "arc_...",
  "archive_fingerprint": "<64 lowercase hex chars>",
  "buyer_wallet": "<solana base58 wallet>",
  "device_public_key": "<44-char standard padded base64 X25519>",
  "status": "active",
  "issued_at": "2026-09-07T00:00:00Z",
  "offline_valid_until": "2026-09-10T00:00:00Z",
  "request_nonce": "<44-char base64>",
  "rights": {
    "open": true,
    "export": false,
    "max_devices": 1,
    "watermark_enabled": true
  }
}
```
*Note: `offline_valid_until = issued_at + 259200 seconds` (72 hours).*

### 2. HPKE Key Wrapping (RFC 9180)
Using `@hpke/core` and `@hpke/dhkem-x25519`:
```typescript
import { CipherSuite, AeadId, KdfId, KemId } from '@hpke/core';
import { DhkemX25519 } from '@hpke/dhkem-x25519';

const suite = new CipherSuite({
  kem: new DhkemX25519(),
  kdf: KdfId.HkdfSha256,
  aead: AeadId.Aes256Gcm,
});

// Import device X25519 public key
const rpk = await suite.kem.importKey('raw', devicePublicKeyBytes, true);

// Sender context with empty info
const sender = await suite.createSenderContext({
  recipientPublicKey: rpk,
});

// Seal ACK (32 bytes raw content key)
const ciphertext = await sender.seal(ackBytes);
const enc = sender.enc;

const wrapped_content_key = {
  version: 1,
  kem_id: 32,
  kdf_id: 1,
  aead_id: 2,
  enc: Buffer.from(enc).toString('base64'),
  ciphertext: Buffer.from(ciphertext).toString('base64'),
};
```

### 3. JCS Canonicalization and Signature
1. Build envelope object:
```typescript
const envelope = {
  payload: P,
  wrapped_content_key: W,
};
```
2. Canonicalize via RFC 8785:
```typescript
import canonicalize from 'canonicalize';
const canonicalJson = canonicalize(envelope);
```
3. Prepare domain-separated signing buffer:
`SolArch/license-signature/v1\0` + `UTF-8 bytes of canonicalJson`.
4. Sign with server Ed25519 license private key.
5. Encode signature as standard Base64.
