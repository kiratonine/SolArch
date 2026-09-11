import * as nacl from 'tweetnacl';
import { canonicalizeJson } from './jcs.util';
import { WrappedContentKey } from './hpke.util';

export const LICENSE_DOMAIN_PREFIX = Buffer.from('SolArch/license-signature/v1\0', 'utf8');
export const ARCHIVE_DOMAIN_PREFIX = Buffer.from('SolArch/container-signature/v1\0', 'utf8');

export interface LicenseSigningInput {
  payload: Record<string, any>;
  wrapped_content_key: WrappedContentKey;
}

function toUint8Array(buf: ArrayBufferView): Uint8Array {
  return new Uint8Array(buf.buffer, buf.byteOffset, buf.byteLength);
}

/**
 * Signs license payload and wrapped content key according to exact Gate 01 contract:
 * 1. Q = JCS({ payload: P, wrapped_content_key: W })
 * 2. Message = LICENSE_DOMAIN_PREFIX + Q
 * 3. Pure Ed25519 signature
 * 4. Standard Base64 output
 */
export function signLicenseEnvelope(
  input: LicenseSigningInput,
  privateKey64Bytes: Uint8Array,
): { canonicalJson: string; signatureBase64: string } {
  const canonicalJson = canonicalizeJson({
    payload: input.payload,
    wrapped_content_key: input.wrapped_content_key,
  });

  const messageBuffer = Buffer.concat([
    LICENSE_DOMAIN_PREFIX,
    Buffer.from(canonicalJson, 'utf8'),
  ]);

  const signature = nacl.sign.detached(
    toUint8Array(messageBuffer),
    toUint8Array(privateKey64Bytes),
  );

  return {
    canonicalJson,
    signatureBase64: Buffer.from(signature).toString('base64'),
  };
}

/**
 * Verifies Ed25519 signature of a license envelope.
 */
export function verifyLicenseSignature(
  canonicalJson: string,
  signatureBase64: string,
  publicKey32Bytes: Uint8Array,
): boolean {
  try {
    const messageBuffer = Buffer.concat([
      LICENSE_DOMAIN_PREFIX,
      Buffer.from(canonicalJson, 'utf8'),
    ]);
    const sigBytes = Buffer.from(signatureBase64, 'base64');
    if (sigBytes.length !== 64) {
      return false;
    }
    return nacl.sign.detached.verify(
      toUint8Array(messageBuffer),
      toUint8Array(sigBytes),
      toUint8Array(publicKey32Bytes),
    );
  } catch {
    return false;
  }
}

/**
 * Verifies Solana wallet signature for challenge/verify authentication.
 */
export function verifyWalletSignature(
  message: string,
  signatureBase58OrBase64: string,
  walletPublicKey32Bytes: Uint8Array,
): boolean {
  try {
    const messageBytes = Buffer.from(message, 'utf8');
    let sigBytes: Buffer;
    if (
      signatureBase58OrBase64.includes('/') ||
      signatureBase58OrBase64.includes('+') ||
      signatureBase58OrBase64.endsWith('=')
    ) {
      sigBytes = Buffer.from(signatureBase58OrBase64, 'base64');
    } else {
      const bs58 = require('bs58');
      sigBytes = Buffer.from(bs58.decode(signatureBase58OrBase64));
    }

    if (sigBytes.length !== 64) {
      return false;
    }

    return nacl.sign.detached.verify(
      toUint8Array(messageBytes),
      toUint8Array(sigBytes),
      toUint8Array(walletPublicKey32Bytes),
    );
  } catch {
    return false;
  }
}
