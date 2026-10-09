import { createHash } from 'crypto';
import { CipherSuite, Aes256Gcm, HkdfSha256 } from '@hpke/core';
import { DhkemX25519HkdfSha256 } from '@hpke/dhkem-x25519';
import { canonicalizeJson } from './jcs.util';

export const HPKE_INFO_DOMAIN = Buffer.from('SolArch/content-key-wrap/info/v1\0', 'utf8');
export const HPKE_AAD_DOMAIN = Buffer.from('SolArch/content-key-wrap/aad/v1\0', 'utf8');

export interface WrappedContentKey {
  version: 1;
  kem_id: 32;
  kdf_id: 1;
  aead_id: 2;
  enc: string;
  ciphertext: string;
}

const X25519_FIELD_PRIME = (1n << 255n) - 19n;

function littleEndianInteger(bytes: Buffer): bigint {
  let value = 0n;
  for (let index = bytes.length - 1; index >= 0; index -= 1) {
    value = (value << 8n) | BigInt(bytes[index]);
  }
  return value;
}

/**
 * Validates that a device public key meets exact SolArch requirements:
 * - 32 raw bytes X25519 little-endian coordinate
 * - Exactly 44 characters RFC 4648 standard Base64
 * - Ends with '='
 * - Exact canonical re-encoding matches textual input
 */
export async function validateDevicePublicKey(devicePublicKeyB64: string): Promise<Buffer> {
  if (!devicePublicKeyB64 || typeof devicePublicKeyB64 !== 'string') {
    throw new Error('Device public key must be a non-empty string');
  }
  if (devicePublicKeyB64.length !== 44 || !devicePublicKeyB64.endsWith('=')) {
    throw new Error('Device public key must be 44 characters RFC 4648 Base64 ending with "="');
  }
  const buf = Buffer.from(devicePublicKeyB64, 'base64');
  if (buf.length !== 32) {
    throw new Error('Device public key must decode to exactly 32 bytes');
  }
  if (buf.toString('base64') !== devicePublicKeyB64) {
    throw new Error('Device public key is not canonical Base64');
  }
  if ((buf[31] & 0x80) !== 0 || littleEndianInteger(buf) >= X25519_FIELD_PRIME) {
    throw new Error('Device public key is not a canonical X25519 u-coordinate');
  }

  // The audited RFC 9180 KEM implementation performs an actual X25519
  // encapsulation. Its noble-curves primitive rejects low-order recipient keys
  // when the DH result is all zero; import alone is insufficient because RFC
  // 7748 decoding otherwise accepts/reduces several hostile encodings.
  try {
    const kem = new DhkemX25519HkdfSha256();
    const recipientPublicKey = await kem.importKey('raw', bufferToArrayBuffer(buf), true);
    await kem.encap({ recipientPublicKey });
  } catch {
    throw new Error('Device public key is low-order or invalid for X25519 HPKE');
  }
  return buf;
}

function bufferToArrayBuffer(buf: Buffer): ArrayBuffer {
  const ab = new ArrayBuffer(buf.byteLength);
  new Uint8Array(ab).set(new Uint8Array(buf.buffer, buf.byteOffset, buf.byteLength));
  return ab;
}

/**
 * Wraps Content Key (ACK) using RFC 9180 HPKE Base mode:
 * KEM: DHKEM(X25519, HKDF-SHA256) (32)
 * KDF: HKDF-SHA256 (1)
 * AEAD: AES-256-GCM (2)
 * info: HPKE_INFO_DOMAIN + Sha256(JCS(payload))
 * aad:  HPKE_AAD_DOMAIN + JCS(payload)
 */
export async function wrapContentKey(
  devicePublicKeyB64: string,
  rawContentKeyBytes: Buffer,
  payload: Record<string, any>,
): Promise<WrappedContentKey> {
  const deviceKeyBuf = await validateDevicePublicKey(devicePublicKeyB64);
  const payloadJcs = Buffer.from(canonicalizeJson(payload), 'utf8');

  const info = Buffer.concat([
    HPKE_INFO_DOMAIN,
    createHash('sha256').update(payloadJcs).digest(),
  ]);

  const aad = Buffer.concat([
    HPKE_AAD_DOMAIN,
    payloadJcs,
  ]);

  const suite = new CipherSuite({
    kem: new DhkemX25519HkdfSha256(),
    kdf: new HkdfSha256(),
    aead: new Aes256Gcm(),
  });

  const rpk = await suite.kem.importKey('raw', bufferToArrayBuffer(deviceKeyBuf), true);
  const sender = await suite.createSenderContext({
    recipientPublicKey: rpk,
    info: bufferToArrayBuffer(info),
  });

  const ciphertext = await sender.seal(
    bufferToArrayBuffer(rawContentKeyBytes),
    bufferToArrayBuffer(aad),
  );
  const enc = sender.enc;

  return {
    version: 1,
    kem_id: 32,
    kdf_id: 1,
    aead_id: 2,
    enc: Buffer.from(enc).toString('base64'),
    ciphertext: Buffer.from(ciphertext).toString('base64'),
  };
}

/**
 * Decrypts wrapped content key using device private key.
 * Used for tests and verification against synthetic vectors.
 */
export async function unwrapContentKey(
  devicePrivateKeyBytes: Buffer,
  wrapped: WrappedContentKey,
  payload: Record<string, any>,
): Promise<Buffer> {
  const payloadJcs = Buffer.from(canonicalizeJson(payload), 'utf8');

  const info = Buffer.concat([
    HPKE_INFO_DOMAIN,
    createHash('sha256').update(payloadJcs).digest(),
  ]);

  const aad = Buffer.concat([
    HPKE_AAD_DOMAIN,
    payloadJcs,
  ]);

  const suite = new CipherSuite({
    kem: new DhkemX25519HkdfSha256(),
    kdf: new HkdfSha256(),
    aead: new Aes256Gcm(),
  });

  const sk = await suite.kem.importKey('raw', bufferToArrayBuffer(devicePrivateKeyBytes), false);
  const encBuf = Buffer.from(wrapped.enc, 'base64');
  const ctBuf = Buffer.from(wrapped.ciphertext, 'base64');

  const recipient = await suite.createRecipientContext({
    recipientKey: sk,
    enc: bufferToArrayBuffer(encBuf),
    info: bufferToArrayBuffer(info),
  });

  const decrypted = await recipient.open(
    bufferToArrayBuffer(ctBuf),
    bufferToArrayBuffer(aad),
  );
  return Buffer.from(decrypted);
}
