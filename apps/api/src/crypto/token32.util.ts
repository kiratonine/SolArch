import { randomBytes, createHmac, createHash, timingSafeEqual } from 'crypto';

export const INTENT_SECRET_DOMAIN = Buffer.from('SolArch/payment-intent-client-secret/v1\0', 'utf8');
export const REFRESH_TOKEN_DOMAIN = Buffer.from('SolArch/device-refresh-token/v1\0', 'utf8');

/**
 * TOKEN32 implementation according to SolArch specification:
 * - 32 CSPRNG bytes
 * - RFC 4648 Base64URL without padding
 * - Exactly 43 ASCII characters
 */
export function generateToken32(): string {
  const bytes = randomBytes(32);
  const token = bytes.toString('base64url');
  if (token.length !== 43) {
    throw new Error(`Invalid TOKEN32 length: expected 43, got ${token.length}`);
  }
  return token;
}

/**
 * Extracts raw 32 bytes from a TOKEN32 string or buffer.
 */
function toRawTokenBytes(token: string | Buffer): Buffer {
  if (Buffer.isBuffer(token)) {
    return token;
  }
  if (typeof token === 'string') {
    if (token.length === 43) {
      return Buffer.from(token, 'base64url');
    }
    return Buffer.from(token, 'utf8');
  }
  throw new Error('Token must be a string or Buffer');
}

/**
 * Computes keyed HMAC-SHA256 of payment intent client secret using domain:
 * HMAC-SHA-256(intent_secret_pepper, D("SolArch/payment-intent-client-secret/v1") || raw_token)
 */
export function hashIntentClientSecret(token: string | Buffer, pepper: string): string {
  const rawBytes = toRawTokenBytes(token);
  return createHmac('sha256', pepper)
    .update(INTENT_SECRET_DOMAIN)
    .update(rawBytes)
    .digest('hex');
}

/**
 * Verifies payment intent client secret against stored HMAC-SHA256 in constant time.
 */
export function verifyIntentClientSecret(token: string | Buffer, storedHash: string, pepper: string): boolean {
  if (!token || !storedHash) return false;
  const computedHash = hashIntentClientSecret(token, pepper);
  if (computedHash.length !== storedHash.length) return false;
  return timingSafeEqual(Buffer.from(computedHash, 'hex'), Buffer.from(storedHash, 'hex'));
}

/**
 * Computes keyed HMAC-SHA256 of device refresh token using domain:
 * HMAC-SHA-256(refresh_token_pepper, D("SolArch/device-refresh-token/v1") || raw_token)
 */
export function hashDeviceRefreshToken(token: string | Buffer, pepper: string): string {
  const rawBytes = toRawTokenBytes(token);
  return createHmac('sha256', pepper)
    .update(REFRESH_TOKEN_DOMAIN)
    .update(rawBytes)
    .digest('hex');
}

/**
 * Verifies device refresh token against stored HMAC-SHA256 in constant time.
 */
export function verifyDeviceRefreshToken(token: string | Buffer, storedHash: string, pepper: string): boolean {
  if (!token || !storedHash) return false;
  const computedHash = hashDeviceRefreshToken(token, pepper);
  if (computedHash.length !== storedHash.length) return false;
  return timingSafeEqual(Buffer.from(computedHash, 'hex'), Buffer.from(storedHash, 'hex'));
}

/**
 * Legacy/generic wrapper for backward compatibility in tests.
 */
export function hashSecretToken(token: string, pepper: string): string {
  return hashIntentClientSecret(token, pepper);
}

export function verifySecretToken(token: string, storedHash: string, pepper: string): boolean {
  return verifyIntentClientSecret(token, storedHash, pepper);
}

/**
 * Validates whether a token string is a valid TOKEN32:
 * - exactly 43 ASCII characters
 * - unpadded RFC 4648 base64url
 * - decodes to exactly 32 bytes
 */
export function validateToken32(token: string): boolean {
  if (!token || typeof token !== 'string' || token.length !== 43) {
    return false;
  }
  try {
    const buf = Buffer.from(token, 'base64url');
    return buf.length === 32 && buf.toString('base64url') === token;
  } catch {
    return false;
  }
}

/**
 * Validates RFC 4648 §4 standard alphabet with canonical padding:
 * strict decode/re-encode equality, no whitespace, exact expected byte length.
 */
export function validateCanonicalB64(value: string, expectedByteLength = 32): Buffer {
  if (!value || typeof value !== 'string') {
    throw new Error('Base64 value must be a non-empty string');
  }
  const expectedCharLength = Math.ceil(expectedByteLength / 3) * 4;
  if (value.length !== expectedCharLength) {
    throw new Error(`Invalid Base64 length: expected ${expectedCharLength}, got ${value.length}`);
  }
  const buf = Buffer.from(value, 'base64');
  if (buf.length !== expectedByteLength) {
    throw new Error(`Invalid Base64 byte length: expected ${expectedByteLength}, got ${buf.length}`);
  }
  if (buf.toString('base64') !== value) {
    throw new Error('Non-canonical Base64 encoding: must match RFC 4648 canonical padding');
  }
  return buf;
}

/**
 * Validates canonical 32-byte standard padded Base64 request_nonce (44 chars, ends in '=').
 */
export function validateRequestNonce(nonceBase64: string): Buffer {
  if (!nonceBase64 || typeof nonceBase64 !== 'string' || !nonceBase64.endsWith('=')) {
    throw new Error('request_nonce must be standard Base64 with canonical padding ending in "="');
  }
  return validateCanonicalB64(nonceBase64, 32);
}

/**
 * Computes SHA-256 digest of the raw 32-byte request nonce for replay protection.
 * Returns 64-char lowercase hex string.
 */
export function hashRequestNonce(nonceBase64: string): string {
  const rawBytes = validateRequestNonce(nonceBase64);
  return createHash('sha256').update(rawBytes).digest('hex').toLowerCase();
}

/**
 * Formats a Date object to exact-second UTC format: YYYY-MM-DDTHH:mm:ssZ (20 chars, no milliseconds).
 */
export function formatExactSecondUtc(date: Date): string {
  const truncated = new Date(Math.floor(date.getTime() / 1000) * 1000);
  return truncated.toISOString().replace(/\.\d{3}Z$/, 'Z');
}

/**
 * Best-effort zeroize sensitive buffer in memory.
 */
export function zeroizeBuffer(buf: Buffer | Uint8Array | null | undefined): void {
  if (buf && Buffer.isBuffer(buf)) {
    buf.fill(0);
  } else if (buf && buf instanceof Uint8Array) {
    buf.fill(0);
  }
}
