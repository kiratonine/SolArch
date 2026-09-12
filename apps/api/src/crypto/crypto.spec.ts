import { canonicalizeJson } from './jcs.util';
import { generateToken32, hashSecretToken, verifySecretToken, hashRequestNonce } from './token32.util';
import { wrapContentKey, unwrapContentKey, validateDevicePublicKey } from './hpke.util';
import { signLicenseEnvelope, verifyLicenseSignature } from './ed25519.util';
import * as nacl from 'tweetnacl';

describe('SolArch Cryptographic Profile & Gate 01 Interoperability', () => {
  // Test vectors from Rust core & Gate 01 report
  const VECTOR_DEVICE_PRIV_HEX = '3caa61bc13e56473e913a85c33cf4d603ac99a517eea95ed4573e772b64435f7';
  const VECTOR_DEVICE_PUB_B64 = 'aTZYJUYw9zrY2nj7Mxv5ds1C+Q4OnJ6D9AxRBypvdBc=';
  const VECTOR_SIGNING_PUB_B64 = 'JUO5L/EJVRFHatyDadtt3JM2ZaEZeN2hQE7hBmypVZ0=';

  const vectorPayload = {
    archive_fingerprint: '57ce84068fdd9b23f8860afa27834151f4fefb038d812c2ac77e8a861b1eecdb',
    archive_id: 'arc_test_01',
    buyer_wallet: '11111111111111111111111111111111',
    device_public_key: VECTOR_DEVICE_PUB_B64,
    entitlement_id: 'ent_test_01',
    issued_at: '2026-09-07T00:00:00Z',
    key_id: 'lic-test-01',
    license_id: 'lic_test_01',
    offline_valid_until: '2026-09-10T00:00:00Z',
    request_nonce: 'gIGCg4SFhoeIiYqLjI2Oj5CRkpOUlZaXmJmam5ydnp8=',
    rights: {
      export: false,
      max_devices: 1,
      open: true,
      watermark_enabled: true,
    },
    status: 'active',
    version: 1,
  };

  const vectorWrappedKey = {
    aead_id: 2 as const,
    ciphertext: 'GO7bNoKdgUkCfV0rm1B3O7zAZPDfjLgoajBypokNP5+GsUXCjUMLys2HbagyFi6I',
    enc: 'utdi4JhEbLzFizDH6AT4KEe4uREYWZZYKvnye/1Oh18=',
    kdf_id: 1 as const,
    kem_id: 32 as const,
    version: 1 as const,
  };

  const expectedSignature = 'wLcOtVg7S0qywsufOSmRTPHACKPxVTO5qYivffQ5Xk0ylSvAjIV7b5u4LlnEycUM++zQ/5d5nMr4tTUaiWg1BA==';

  test('validates device public key correctly', () => {
    const raw = validateDevicePublicKey(VECTOR_DEVICE_PUB_B64);
    expect(raw.length).toBe(32);
    expect(raw.toString('base64')).toBe(VECTOR_DEVICE_PUB_B64);

    expect(() => validateDevicePublicKey('invalid-key')).toThrow();
    expect(() => validateDevicePublicKey(VECTOR_DEVICE_PUB_B64.slice(0, -1))).toThrow();
  });

  test('canonicalizes JSON according to RFC 8785 (JCS)', () => {
    const objA = { z: 1, a: 2, m: { b: 3, a: 4 } };
    const objB = { a: 2, m: { a: 4, b: 3 }, z: 1 };
    expect(canonicalizeJson(objA)).toBe(canonicalizeJson(objB));
    expect(canonicalizeJson(objA)).toBe('{"a":2,"m":{"a":4,"b":3},"z":1}');
  });

  test('generates and verifies TOKEN32 and request nonce hashes', () => {
    const token = generateToken32();
    expect(token.length).toBe(43);
    const pepper = 'test-pepper-32-bytes-minimum-key';
    const hash = hashSecretToken(token, pepper);
    expect(verifySecretToken(token, hash, pepper)).toBe(true);
    expect(verifySecretToken('wrongtokenwrongtokenwrongtokenwrongtokenwro', hash, pepper)).toBe(false);

    const nonceHash = hashRequestNonce('gIGCg4SFhoeIiYqLjI2Oj5CRkpOUlZaXmJmam5ydnp8=');
    expect(nonceHash.length).toBe(64);
  });

  test('verifies exact Gate 01 Ed25519 license signature vector', () => {
    const canonicalJson = canonicalizeJson({
      payload: vectorPayload,
      wrapped_content_key: vectorWrappedKey,
    });

    const pubKeyBytes = Buffer.from(VECTOR_SIGNING_PUB_B64, 'base64');
    const isValid = verifyLicenseSignature(canonicalJson, expectedSignature, pubKeyBytes);
    expect(isValid).toBe(true);

    // Verify signing with 0x40..0x5f seed generates the exact signature
    const seed = new Uint8Array(32);
    for (let i = 0; i < 32; i++) {
      seed[i] = 0x40 + i;
    }
    const keyPair = nacl.sign.keyPair.fromSeed(seed);
    expect(Buffer.from(keyPair.publicKey).toString('base64')).toBe(VECTOR_SIGNING_PUB_B64);

    const res = signLicenseEnvelope(
      {
        payload: vectorPayload,
        wrapped_content_key: vectorWrappedKey,
      },
      keyPair.secretKey,
    );
    expect(res.signatureBase64).toBe(expectedSignature);
  });

  test('unwraps Gate 01 HPKE wrapped content key using vector private key', async () => {
    const privKeyBytes = Buffer.from(VECTOR_DEVICE_PRIV_HEX, 'hex');
    const decryptedAck = await unwrapContentKey(privKeyBytes, vectorWrappedKey, vectorPayload);
    expect(decryptedAck.length).toBe(32);
    expect(decryptedAck.toString('hex')).toBe('a0a1a2a3a4a5a6a7a8a9aaabacadaeafb0b1b2b3b4b5b6b7b8b9babbbcbdbebf');

    // Test fresh wrap and unwrap cycle
    const freshAck = Buffer.from('12345678901234567890123456789012', 'utf8');
    const wrapped = await wrapContentKey(VECTOR_DEVICE_PUB_B64, freshAck, vectorPayload);
    expect(wrapped.kem_id).toBe(32);
    expect(wrapped.kdf_id).toBe(1);
    expect(wrapped.aead_id).toBe(2);

    const decryptedFresh = await unwrapContentKey(privKeyBytes, wrapped, vectorPayload);
    expect(decryptedFresh.equals(freshAck)).toBe(true);
  });
});
