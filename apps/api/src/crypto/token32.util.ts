import { randomBytes, createHmac, createHash } from 'crypto';

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
 * Computes purpose-separated keyed HMAC-SHA256 of a secret token.
 * Raw secrets must never be stored in database.
 */
export function hashSecretToken(token: string, pepper: string): string {
  return createHmac('sha256', pepper).update(token, 'utf8').digest('hex');
}

/**
 * Verifies a token against a stored HMAC-SHA256 hash in constant time.
 */
export function verifySecretToken(token: string, storedHash: string, pepper: string): boolean {
  const computedHash = hashSecretToken(token, pepper);
  if (computedHash.length !== storedHash.length) {
    return false;
  }
  const bufA = Buffer.from(computedHash, 'hex');
  const bufB = Buffer.from(storedHash, 'hex');
  return require('crypto').timingSafeEqual(bufA, bufB);
}

/**
 * Computes SHA-256 digest of a request nonce for replay protection.
 * Returns 64-char hex string.
 */
export function hashRequestNonce(nonceBase64: string): string {
  const rawBytes = Buffer.from(nonceBase64, 'base64');
  return createHash('sha256').update(rawBytes).digest('hex');
}
