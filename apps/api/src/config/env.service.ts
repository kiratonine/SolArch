import { Injectable, Logger, OnModuleInit } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { Keypair, PublicKey } from '@solana/web3.js';
import { closeSync, existsSync, mkdirSync, openSync, realpathSync, statSync, unlinkSync, writeSync } from 'fs';
import { isAbsolute, join, relative, resolve, sep } from 'path';
import { tmpdir } from 'os';
import { randomUUID } from 'crypto';
import * as nacl from 'tweetnacl';

const KEY_ID = /^[a-z0-9_-]{1,32}$/;

function canonicalPublicKey(value: string, name: string): PublicKey {
  try {
    const key = new PublicKey(value);
    if (key.toBase58() !== value) throw new Error('non-canonical');
    return key;
  } catch {
    throw new Error(`${name} must be a canonical Solana Base58 public key`);
  }
}

function canonicalBase64(value: string, byteLengths: number[], name: string): Buffer {
  const bytes = Buffer.from(value, 'base64');
  if (!byteLengths.includes(bytes.length) || bytes.toString('base64') !== value) {
    throw new Error(`${name} must be canonical padded Base64 with ${byteLengths.join(' or ')} bytes`);
  }
  return bytes;
}

@Injectable()
export class EnvService implements OnModuleInit {
  private readonly logger = new Logger(EnvService.name);

  constructor(private readonly configService: ConfigService) {}

  onModuleInit() {
    // Validate an explicitly requested deterministic clock even before any issuance path runs.
    void this.currentTime;
    void this.webAllowedOrigins;
    if (this.isLiveEnvironment) {
      this.validateStorage();
      this.validateLiveSecrets();
    }
  }

  get isLiveEnvironment(): boolean {
    const env = this.configService.get<string>('NODE_ENV');
    const network = this.configService.get<string>('SOLANA_NETWORK', 'devnet');
    const isExplicitLive = this.configService.get<string>('SOLANA_LIVE_DEVNET') === 'true';
    if (isExplicitLive) return true;
    if (env === 'test') return false;
    return env === 'production' || isExplicitLive || network === 'devnet' || network === 'mainnet-beta';
  }

  get currentTime(): Date {
    const enabled = this.configService.get<string>('SOLARCH_LIVE_E2E_CLOCK_ENABLED');
    const rawSeconds = this.configService.get<string>('SOLARCH_LIVE_E2E_CLOCK_UNIX_SECONDS');
    if (enabled === undefined && rawSeconds === undefined) return new Date();
    if (
      enabled !== 'true' ||
      this.configService.get<string>('NODE_ENV') !== 'test' ||
      this.configService.get<string>('SOLANA_LIVE_DEVNET') !== 'true' ||
      this.configService.get<string>('SOLANA_NETWORK', 'devnet') !== 'devnet'
    ) {
      throw new Error(
        'The deterministic live E2E clock is allowed only in explicit test-mode Devnet live runs',
      );
    }
    if (
      !rawSeconds ||
      !/^(0|[1-9][0-9]{0,9})$/.test(rawSeconds) ||
      Number(rawSeconds) > 9_999_999_999
    ) {
      throw new Error('SOLARCH_LIVE_E2E_CLOCK_UNIX_SECONDS must be canonical bounded Unix seconds');
    }
    return new Date(Number(rawSeconds) * 1000);
  }

  validateLiveSecrets(): void {
    const required = [
      'PUBLIC_API_ORIGIN',
      'SOLANA_RPC_URL',
      'SOLANA_USDC_MINT',
      'SOLARCH_PLATFORM_WALLET',
      'SOLARCH_FEE_PAYER_SECRET',
      'SOLARCH_CLI_PATH',
      'ARCHIVE_KEY_ID',
      'ARCHIVE_SIGNING_PUBLIC_KEY_B64',
      'ARCHIVE_SIGNING_PRIVATE_KEY_B64',
      'LICENSE_KEY_ID',
      'LICENSE_SIGNING_PUBLIC_KEY_B64',
      'LICENSE_SIGNING_PRIVATE_KEY_B64',
      'JWT_SECRET',
      'INTENT_HMAC_SECRET',
      'DEVICE_REFRESH_HMAC_SECRET',
      'ACK_KEK_SECRET',
    ];
    const missing = required.filter((name) => !this.configService.get<string>(name));
    if (missing.length > 0) {
      const errorMsg = `Live environment startup failed closed. Missing explicit configuration: ${missing.join(', ')}`;
      this.logger.error(errorMsg);
      throw new Error(errorMsg);
    }

    void this.publicApiOrigin;
    void this.usdcMint;
    void this.solarchPlatformWallet;
    void this.feePayerKeypair;
    void this.solarchCliPath;
    void this.jwtSecret;
    const archiveKeys = this.archiveSigningKeypair;
    const licenseKeys = this.licenseSigningKeypair;
    if (!KEY_ID.test(this.archiveKeyId) || !KEY_ID.test(this.licenseKeyId)) {
      throw new Error('Archive and license key IDs must use the frozen key_id grammar');
    }
    const archivePublic = this.signingPublicKey('ARCHIVE_SIGNING_PUBLIC_KEY_B64');
    const licensePublic = this.signingPublicKey('LICENSE_SIGNING_PUBLIC_KEY_B64');
    if (!Buffer.from(archiveKeys.publicKey).equals(archivePublic)) {
      throw new Error('Archive signing public/private keys do not match');
    }
    if (!Buffer.from(licenseKeys.publicKey).equals(licensePublic)) {
      throw new Error('License signing public/private keys do not match');
    }
    if (archivePublic.equals(licensePublic)) {
      throw new Error('Archive and license signing roles must use different key pairs');
    }
    const secrets = [this.intentHmacSecret, this.deviceRefreshHmacSecret, this.ackKekSecret];
    if (secrets.some((secret) => Buffer.byteLength(secret, 'utf8') < 32)) {
      throw new Error('HMAC and ACK KEK secrets must each contain at least 32 UTF-8 bytes');
    }
    if (new Set(secrets).size !== secrets.length) {
      throw new Error('Intent, refresh and ACK custody secrets must be purpose-separated');
    }
  }

  get port(): number {
    const port = Number(this.configService.get<string | number>('PORT', 3000));
    if (!Number.isInteger(port) || port < 1 || port > 65535) {
      throw new Error('PORT must be an integer between 1 and 65535');
    }
    return port;
  }

  get isProduction(): boolean {
    return this.configService.get<string>('NODE_ENV') === 'production';
  }

  get publicApiOrigin(): string {
    const origin = this.configService.get<string>('PUBLIC_API_ORIGIN');
    if (!origin) {
      if (this.isLiveEnvironment) {
        throw new Error('PUBLIC_API_ORIGIN is required in live environment');
      }
      return 'http://localhost:3000';
    }
    if (!this.isLiveEnvironment) {
      return origin.replace(/\/+$/, '');
    }
    let parsed: URL;
    try {
      parsed = new URL(origin);
    } catch {
      throw new Error('PUBLIC_API_ORIGIN must be a valid HTTPS root origin');
    }
    if (
      parsed.protocol !== 'https:' ||
      parsed.username ||
      parsed.password ||
      parsed.pathname !== '/' ||
      parsed.search ||
      parsed.hash ||
      !parsed.hostname
    ) {
      throw new Error('PUBLIC_API_ORIGIN must be an HTTPS root origin without credentials, path, query or fragment');
    }
    if (origin !== parsed.origin && origin !== `${parsed.origin}/`) {
      throw new Error('PUBLIC_API_ORIGIN must use its canonical HTTPS root-origin form');
    }
    return parsed.origin;
  }

  get jwtSecret(): string {
    const secret = this.configService.get<string>('JWT_SECRET');
    if (!secret || secret.trim().length === 0) {
      if (this.isLiveEnvironment) {
        throw new Error('JWT_SECRET is required in live environment');
      }
      return 'solarch-dev-jwt-super-secret-key-32-chars-minimum';
    }
    if (this.isLiveEnvironment && Buffer.byteLength(secret, 'utf8') < 32) {
      throw new Error('JWT_SECRET must contain at least 32 UTF-8 bytes in live environment');
    }
    return secret;
  }

  get jwtExpiresIn(): string {
    return this.configService.get<string>('JWT_EXPIRES_IN', '7d');
  }

  get ackKekSecret(): string {
    const secret = this.configService.get<string>('ACK_KEK_SECRET');
    if (!secret) {
      if (this.isLiveEnvironment) {
        throw new Error('ACK_KEK_SECRET is required in live environment');
      }
      return 'solarch-ack-kek-super-secret-key-32-chars-dev';
    }
    return secret;
  }

  get intentHmacSecret(): string {
    const secret = this.configService.get<string>('INTENT_HMAC_SECRET');
    if (!secret) {
      if (this.isLiveEnvironment) {
        throw new Error('INTENT_HMAC_SECRET is required in live environment');
      }
      return 'solarch-intent-hmac-secret-32-chars-minimum';
    }
    return secret;
  }

  get deviceRefreshHmacSecret(): string {
    const secret = this.configService.get<string>('DEVICE_REFRESH_HMAC_SECRET');
    if (!secret) {
      if (this.isLiveEnvironment) {
        throw new Error('DEVICE_REFRESH_HMAC_SECRET is required in live environment');
      }
      return 'solarch-device-refresh-hmac-secret-32-chars-dev';
    }
    return secret;
  }

  get storageRoot(): string {
    const configured = this.configService.get<string>('STORAGE_LOCAL_ROOT');
    if (this.isLiveEnvironment && (!configured || !isAbsolute(configured))) {
      throw new Error('STORAGE_LOCAL_ROOT must be explicitly configured as an absolute persistent path in live environment');
    }
    const root = resolve(configured || './storage_data');
    if (this.isLiveEnvironment) this.assertPersistentStorage(root);
    return root;
  }

  get uploadsDirectory(): string {
    return join(this.storageRoot, 'uploads');
  }

  validateStorage(): void {
    const root = this.storageRoot;
    let probe: string | undefined;
    let descriptor: number | undefined;
    try {
      mkdirSync(root, { recursive: true });
      this.assertPersistentStorage(realpathSync(root));
      probe = join(root, `.solarch-write-probe-${randomUUID()}`);
      descriptor = openSync(probe, 'wx', 0o600);
      writeSync(descriptor, Buffer.from('storage readiness'));
    } catch {
      throw new Error('STORAGE_LOCAL_ROOT must be a writable persistent directory, not temporary storage');
    } finally {
      // Only remove the unique readiness file that this invocation created.
      if (descriptor !== undefined) {
        closeSync(descriptor);
        unlinkSync(probe!);
      }
    }
  }

  private assertPersistentStorage(root: string): void {
    for (const temporaryRoot of [tmpdir(), '/tmp', '/var/tmp', '/dev/shm', '/run']) {
      const child = relative(resolve(temporaryRoot), root);
      if (child === '' || (!child.startsWith(`..${sep}`) && child !== '..' && !isAbsolute(child))) {
        throw new Error('STORAGE_LOCAL_ROOT must not point to temporary storage');
      }
    }
  }

  get webAllowedOrigins(): string[] {
    const origins = (this.configService.get<string>('WEB_ALLOWED_ORIGINS', '') || '')
      .split(',').map((value) => value.trim()).filter(Boolean);
    for (const origin of origins) {
      let url: URL;
      try { url = new URL(origin); } catch {
        throw new Error('WEB_ALLOWED_ORIGINS must contain comma-separated HTTPS origins');
      }
      if (url.protocol !== 'https:' || url.origin !== origin) {
        throw new Error('WEB_ALLOWED_ORIGINS must contain canonical HTTPS origins without credentials, path, query or fragment');
      }
    }
    if (!this.isLiveEnvironment || this.configService.get<string>('NODE_ENV') === 'development') {
      origins.push('http://localhost:5173');
    }
    return [...new Set(origins)];
  }

  get solanaRpcUrl(): string {
    const value = this.configService.get<string>('SOLANA_RPC_URL');
    if (!value && this.isLiveEnvironment) throw new Error('SOLANA_RPC_URL is required in live environment');
    return value || 'https://api.devnet.solana.com';
  }

  get solanaNetwork(): string {
    return this.configService.get<string>('SOLANA_NETWORK', 'devnet');
  }

  get skipAtaVerification(): boolean {
    return (
      this.configService.get<string>('SOLANA_SKIP_ATA_CHECK') === 'true' ||
      this.configService.get<string>('NODE_ENV') === 'test'
    );
  }

  get usdcMint(): PublicKey {
    const mint = this.configService.get<string>('SOLANA_USDC_MINT');
    if (!mint && this.isLiveEnvironment) throw new Error('SOLANA_USDC_MINT is required in live environment');
    return canonicalPublicKey(
      mint || '4zMMC9srt5Ri5X14GAgXhaHii3GnPAEERYPJgZJDncDU',
      'SOLANA_USDC_MINT',
    );
  }

  get solarchPlatformWallet(): PublicKey {
    const wallet = this.configService.get<string>('SOLARCH_PLATFORM_WALLET');
    if (!wallet && this.isLiveEnvironment) {
      throw new Error('SOLARCH_PLATFORM_WALLET is required in live environment');
    }
    return canonicalPublicKey(
      wallet || 'ADebM4PZk4xN3sUvW7n1o88h5Zqg7kR9m1vYt2zE5q11',
      'SOLARCH_PLATFORM_WALLET',
    );
  }

  get solarchCliPath(): string | undefined {
    const value = this.configService.get<string>('SOLARCH_CLI_PATH');
    if (!value) {
      if (this.isLiveEnvironment) throw new Error('SOLARCH_CLI_PATH is required in live environment');
      return undefined;
    }
    if (this.isLiveEnvironment && (!isAbsolute(value) || !existsSync(value) || !statSync(value).isFile())) {
      throw new Error('SOLARCH_CLI_PATH must be an existing absolute file in live environment');
    }
    return value;
  }

  get feePayerKeypair(): Keypair {
    const raw = this.configService.get<string>('SOLARCH_FEE_PAYER_SECRET');
    if (raw) {
      try {
        if (raw.startsWith('[') && raw.endsWith(']')) {
          const arr = JSON.parse(raw);
          if (
            !Array.isArray(arr) ||
            arr.length !== 64 ||
            !arr.every((byte) => Number.isInteger(byte) && byte >= 0 && byte <= 255)
          ) {
            throw new Error('fee-payer JSON secret must contain exactly 64 byte integers');
          }
          return Keypair.fromSecretKey(Uint8Array.from(arr));
        }
        const bs58 = require('bs58');
        const decoded = bs58.decode(raw);
        if (bs58.encode(decoded) !== raw) throw new Error('non-canonical fee-payer secret');
        return Keypair.fromSecretKey(decoded);
      } catch {
        if (this.isLiveEnvironment) {
          throw new Error('SOLARCH_FEE_PAYER_SECRET is malformed');
        }
      }
    }
    if (this.isLiveEnvironment) {
      throw new Error('SOLARCH_FEE_PAYER_SECRET is required in live environment');
    }
    // Deterministic dev fallback keypair
    const seed = new Uint8Array(32);
    seed.fill(0x33);
    return Keypair.fromSeed(seed);
  }

  get licenseKeyId(): string {
    const value = this.configService.get<string>('LICENSE_KEY_ID');
    if (!value && this.isLiveEnvironment) throw new Error('LICENSE_KEY_ID is required in live environment');
    return value || 'lic-dev-01';
  }

  get licenseSigningKeypair(): nacl.SignKeyPair {
    const privB64 = this.configService.get<string>('LICENSE_SIGNING_PRIVATE_KEY_B64');
    if (privB64) {
      const raw = canonicalBase64(privB64, [32, 64], 'LICENSE_SIGNING_PRIVATE_KEY_B64');
      if (raw.length === 64) {
        return nacl.sign.keyPair.fromSecretKey(new Uint8Array(raw));
      } else if (raw.length === 32) {
        return nacl.sign.keyPair.fromSeed(new Uint8Array(raw));
      }
    }
    if (this.isLiveEnvironment) {
      throw new Error('LICENSE_SIGNING_PRIVATE_KEY_B64 is required in live environment');
    }
    // Synthetic dev fallback keypair (0x40..0x5f from vectors)
    const seed = new Uint8Array(32);
    for (let i = 0; i < 32; i++) seed[i] = 0x40 + i;
    return nacl.sign.keyPair.fromSeed(seed);
  }

  get archiveKeyId(): string {
    const value = this.configService.get<string>('ARCHIVE_KEY_ID');
    if (!value && this.isLiveEnvironment) throw new Error('ARCHIVE_KEY_ID is required in live environment');
    return value || 'arc-dev-01';
  }

  get archiveSigningKeypair(): nacl.SignKeyPair {
    const privB64 = this.configService.get<string>('ARCHIVE_SIGNING_PRIVATE_KEY_B64');
    if (privB64) {
      const raw = canonicalBase64(privB64, [32, 64], 'ARCHIVE_SIGNING_PRIVATE_KEY_B64');
      if (raw.length === 64) {
        return nacl.sign.keyPair.fromSecretKey(new Uint8Array(raw));
      } else if (raw.length === 32) {
        return nacl.sign.keyPair.fromSeed(new Uint8Array(raw));
      }
    }
    if (this.isLiveEnvironment) {
      throw new Error('ARCHIVE_SIGNING_PRIVATE_KEY_B64 is required in live environment');
    }
    // Synthetic dev fallback keypair
    const seed = new Uint8Array(32);
    for (let i = 0; i < 32; i++) seed[i] = 0x60 + i;
    return nacl.sign.keyPair.fromSeed(seed);
  }

  private signingPublicKey(name: string): Buffer {
    const value = this.configService.get<string>(name);
    if (!value) throw new Error(`${name} is required in live environment`);
    return canonicalBase64(value, [32], name);
  }
}
