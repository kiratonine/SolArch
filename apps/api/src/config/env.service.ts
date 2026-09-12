import { Injectable, Logger, OnModuleInit } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { Keypair, PublicKey } from '@solana/web3.js';
import * as nacl from 'tweetnacl';

@Injectable()
export class EnvService implements OnModuleInit {
  private readonly logger = new Logger(EnvService.name);

  constructor(private readonly configService: ConfigService) {}

  onModuleInit() {
    if (this.isLiveEnvironment) {
      this.validateLiveSecrets();
    }
  }

  get isLiveEnvironment(): boolean {
    const env = this.configService.get<string>('NODE_ENV');
    if (env === 'test') return false;
    const network = this.configService.get<string>('SOLANA_NETWORK', 'devnet');
    const isExplicitLive = this.configService.get<string>('SOLANA_LIVE_DEVNET') === 'true';
    return env === 'production' || isExplicitLive || network === 'devnet' || network === 'mainnet-beta';
  }

  validateLiveSecrets(): void {
    const missing: string[] = [];
    if (!this.configService.get<string>('SOLARCH_FEE_PAYER_SECRET')) {
      missing.push('SOLARCH_FEE_PAYER_SECRET');
    }
    if (!this.configService.get<string>('ARCHIVE_SIGNING_PRIVATE_KEY_B64')) {
      missing.push('ARCHIVE_SIGNING_PRIVATE_KEY_B64');
    }
    if (!this.configService.get<string>('LICENSE_SIGNING_PRIVATE_KEY_B64')) {
      missing.push('LICENSE_SIGNING_PRIVATE_KEY_B64');
    }
    if (!this.configService.get<string>('INTENT_HMAC_SECRET')) {
      missing.push('INTENT_HMAC_SECRET');
    }
    if (!this.configService.get<string>('DEVICE_REFRESH_HMAC_SECRET')) {
      missing.push('DEVICE_REFRESH_HMAC_SECRET');
    }
    if (!this.configService.get<string>('ACK_KEK_SECRET')) {
      missing.push('ACK_KEK_SECRET');
    }
    const publicOrigin = this.configService.get<string>('PUBLIC_API_ORIGIN');
    if (!publicOrigin) {
      missing.push('PUBLIC_API_ORIGIN');
    } else if (!publicOrigin.startsWith('https://')) {
      throw new Error('PUBLIC_API_ORIGIN must start with https:// in live environment');
    }
    if (missing.length > 0) {
      const errorMsg = `Live environment startup failed closed. Missing explicit secrets: ${missing.join(', ')}`;
      this.logger.error(errorMsg);
      throw new Error(errorMsg);
    }
  }

  get port(): number {
    return this.configService.get<number>('PORT', 3000);
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
    if (this.isLiveEnvironment && !origin.startsWith('https://')) {
      throw new Error('PUBLIC_API_ORIGIN must start with https:// in live environment');
    }
    return origin.replace(/\/+$/, '');
  }

  get jwtSecret(): string {
    return this.configService.get<string>('JWT_SECRET', 'solarch-dev-jwt-super-secret-key-32-chars-minimum');
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
    return this.configService.get<string>('STORAGE_LOCAL_ROOT', './storage_data');
  }

  get solanaRpcUrl(): string {
    return this.configService.get<string>('SOLANA_RPC_URL', 'https://api.devnet.solana.com');
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
    const mint = this.configService.get<string>(
      'SOLANA_USDC_MINT',
      '4zMMC9srt5Ri5X14GAgXhaHii3GnPAEERYPJgZJDncDU',
    );
    return new PublicKey(mint);
  }

  get solarchPlatformWallet(): PublicKey {
    const wallet = this.configService.get<string>(
      'SOLARCH_PLATFORM_WALLET',
      'ADebM4PZk4xN3sUvW7n1o88h5Zqg7kR9m1vYt2zE5q11',
    );
    return new PublicKey(wallet);
  }

  get feePayerKeypair(): Keypair {
    const raw = this.configService.get<string>('SOLARCH_FEE_PAYER_SECRET');
    if (raw) {
      try {
        if (raw.startsWith('[') && raw.endsWith(']')) {
          const arr = JSON.parse(raw);
          return Keypair.fromSecretKey(Uint8Array.from(arr));
        }
        const bs58 = require('bs58');
        return Keypair.fromSecretKey(bs58.decode(raw));
      } catch (e) {
        this.logger.warn(`Failed to parse SOLARCH_FEE_PAYER_SECRET: ${e.message}`);
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
    return this.configService.get<string>('LICENSE_KEY_ID', 'lic-dev-01');
  }

  get licenseSigningKeypair(): nacl.SignKeyPair {
    const privB64 = this.configService.get<string>('LICENSE_SIGNING_PRIVATE_KEY_B64');
    if (privB64) {
      const raw = Buffer.from(privB64, 'base64');
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
    return this.configService.get<string>('ARCHIVE_KEY_ID', 'arc-dev-01');
  }

  get archiveSigningKeypair(): nacl.SignKeyPair {
    const privB64 = this.configService.get<string>('ARCHIVE_SIGNING_PRIVATE_KEY_B64');
    if (privB64) {
      const raw = Buffer.from(privB64, 'base64');
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
}
