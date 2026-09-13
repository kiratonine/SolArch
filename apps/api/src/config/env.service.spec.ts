import { ConfigService } from '@nestjs/config';
import { Keypair } from '@solana/web3.js';
import * as nacl from 'tweetnacl';
import { EnvService } from './env.service';

function envService(values: Record<string, string>): EnvService {
  const config = {
    get: jest.fn((name: string, fallback?: unknown) => values[name] ?? fallback),
  } as unknown as ConfigService;
  return new EnvService(config);
}

describe('EnvService live fail-closed configuration', () => {
  test('accepts only a strict HTTPS root PUBLIC_API_ORIGIN in live mode', () => {
    expect(
      envService({ NODE_ENV: 'production', PUBLIC_API_ORIGIN: 'https://api.solarch.example/' })
        .publicApiOrigin,
    ).toBe('https://api.solarch.example');

    for (const origin of [
      'http://api.solarch.example/',
      'https://user@api.solarch.example/',
      'https://api.solarch.example/v1',
      'https://api.solarch.example/v1/..',
      'https://api.solarch.example/?tenant=1',
      'https://api.solarch.example/#fragment',
    ]) {
      expect(() => envService({ NODE_ENV: 'production', PUBLIC_API_ORIGIN: origin }).publicApiOrigin).toThrow(
        /HTTPS root[- ]origin/,
      );
    }
  });

  test('requires explicit canonical live mint and platform wallet configuration', () => {
    const missing = envService({ NODE_ENV: 'production' });
    expect(() => missing.usdcMint).toThrow(/SOLANA_USDC_MINT is required/);
    expect(() => missing.solarchPlatformWallet).toThrow(/SOLARCH_PLATFORM_WALLET is required/);

    const malformed = envService({
      NODE_ENV: 'production',
      SOLANA_USDC_MINT: 'not-base58',
      SOLARCH_PLATFORM_WALLET: 'not-base58',
    });
    expect(() => malformed.usdcMint).toThrow(/canonical Solana/);
    expect(() => malformed.solarchPlatformWallet).toThrow(/canonical Solana/);
  });

  test('fails startup before using missing live keys, custody or fee-payer secrets', () => {
    expect(() => envService({ NODE_ENV: 'production' }).validateLiveSecrets()).toThrow(
      /Missing explicit configuration/,
    );
  });

  test('accepts a complete role-separated live configuration and rejects mismatched signing trust', () => {
    const archive = nacl.sign.keyPair.fromSeed(new Uint8Array(32).fill(1));
    const license = nacl.sign.keyPair.fromSeed(new Uint8Array(32).fill(2));
    const feePayer = Keypair.generate();
    const values = {
      NODE_ENV: 'production',
      PUBLIC_API_ORIGIN: 'https://api.solarch.example',
      SOLANA_RPC_URL: 'https://api.devnet.solana.com',
      SOLANA_USDC_MINT: '4zMMC9srt5Ri5X14GAgXhaHii3GnPAEERYPJgZJDncDU',
      SOLARCH_PLATFORM_WALLET: Keypair.generate().publicKey.toBase58(),
      SOLARCH_FEE_PAYER_SECRET: JSON.stringify(Array.from(feePayer.secretKey)),
      SOLARCH_CLI_PATH: process.execPath,
      ARCHIVE_KEY_ID: 'archive-live-01',
      ARCHIVE_SIGNING_PUBLIC_KEY_B64: Buffer.from(archive.publicKey).toString('base64'),
      ARCHIVE_SIGNING_PRIVATE_KEY_B64: Buffer.from(archive.secretKey).toString('base64'),
      LICENSE_KEY_ID: 'license-live-01',
      LICENSE_SIGNING_PUBLIC_KEY_B64: Buffer.from(license.publicKey).toString('base64'),
      LICENSE_SIGNING_PRIVATE_KEY_B64: Buffer.from(license.secretKey).toString('base64'),
      JWT_SECRET: 'jwt-purpose-secret-00000000000000001',
      INTENT_HMAC_SECRET: 'intent-purpose-secret-0000000000001',
      DEVICE_REFRESH_HMAC_SECRET: 'refresh-purpose-secret-000000000001',
      ACK_KEK_SECRET: 'custody-purpose-secret-000000000001',
    };

    expect(() => envService(values).validateLiveSecrets()).not.toThrow();
    expect(() =>
      envService({ ...values, JWT_SECRET: 'too-short' }).validateLiveSecrets(),
    ).toThrow(/JWT_SECRET.*at least 32 UTF-8 bytes/);
    expect(() =>
      envService({
        ...values,
        DEVICE_REFRESH_HMAC_SECRET: values.INTENT_HMAC_SECRET,
      }).validateLiveSecrets(),
    ).toThrow(/purpose-separated/);
    expect(() =>
      envService({
        ...values,
        ACK_KEK_SECRET: values.INTENT_HMAC_SECRET,
      }).validateLiveSecrets(),
    ).toThrow(/purpose-separated/);
    expect(() =>
      envService({
        ...values,
        LICENSE_SIGNING_PUBLIC_KEY_B64: Buffer.from(archive.publicKey).toString('base64'),
      }).validateLiveSecrets(),
    ).toThrow(/do not match/);
  });

  test('requires an explicit JWT secret of at least 32 UTF-8 bytes in live mode', () => {
    for (const jwtSecret of [undefined, '', ' '.repeat(32), 'too-short']) {
      const values: Record<string, string> = {
        NODE_ENV: 'production',
      };
      if (jwtSecret !== undefined) values.JWT_SECRET = jwtSecret;
      expect(() => envService(values).jwtSecret).toThrow(/JWT_SECRET/);
    }
  });

  test('keeps the known JWT fallback strictly outside live environments', () => {
    expect(
      envService({ NODE_ENV: 'test', SOLANA_NETWORK: 'localnet' }).jwtSecret,
    ).toBe('solarch-dev-jwt-super-secret-key-32-chars-minimum');
  });
});
