import { Injectable, Logger } from '@nestjs/common';
import { randomBytes } from 'crypto';
import * as fs from 'fs';
import * as path from 'path';
import { spawn } from 'child_process';
import * as nacl from 'tweetnacl';
import { EnvService } from '@/config/env.service';
import { canonicalizeJson } from '@/crypto/jcs.util';
import { formatExactSecondUtc } from '@/crypto/token32.util';

const ACK_FRAME_MAGIC = Buffer.from('SLRKEY01', 'utf8');
const SIGNING_FRAME_MAGIC = Buffer.from('SLRSIGN1', 'utf8');
const SIGNATURE_DOMAIN = Buffer.from('SolArch/slr-signature/v1\0', 'utf8');

export interface BuildArchiveInput {
  archiveId: string;
  title: string;
  creatorWallet: string;
  priceAmount: string;
  platformFeeBps: number;
  maxDevices: number;
  allowExport: boolean;
  watermarkEnabled: boolean;
  sourceFilesDir: string;
  outputFilePath: string;
}

export interface BuildArchiveResult {
  outputFilePath: string;
  archiveFingerprint: string;
  contentKey: Buffer; // 32-byte raw ACK
  sizeBytes: number;
}

@Injectable()
export class ArchiveBuilderAdapter {
  private readonly logger = new Logger(ArchiveBuilderAdapter.name);

  constructor(private readonly env: EnvService) {}

  getCliPath(): string {
    if (process.env.SOLARCH_CLI_PATH) {
      return process.env.SOLARCH_CLI_PATH;
    }
    const candidates = [
      'solarch',
      'solarch.exe',
      path.resolve(process.cwd(), '../../crates/target/release/solarch.exe'),
      path.resolve(process.cwd(), '../../crates/target/debug/solarch.exe'),
      path.resolve(process.cwd(), '../target/release/solarch.exe'),
      path.resolve(process.cwd(), 'target/release/solarch.exe'),
    ];
    for (const candidate of candidates) {
      if (candidate.includes('/') || candidate.includes('\\')) {
        if (fs.existsSync(candidate)) {
          return candidate;
        }
      }
    }
    return 'solarch';
  }

  async build(input: BuildArchiveInput): Promise<BuildArchiveResult> {
    const dir = path.dirname(input.outputFilePath);
    if (!fs.existsSync(dir)) {
      fs.mkdirSync(dir, { recursive: true });
    }

    // Generate fresh 32-byte Content Key (ACK)
    const contentKey = randomBytes(32);

    // Build Public Header Snapshot strictly matching format::PublicHeader
    const publicHeader = {
      format: 'solarch',
      version: '1.0.0',
      archive_id: input.archiveId,
      created_at: formatExactSecondUtc(new Date()),
      title: input.title,
      creator_wallet: input.creatorWallet,
      commercial_snapshot: {
        price_amount: Number(input.priceAmount).toFixed(6),
        price_currency: 'USDC',
        platform_fee_bps: input.platformFeeBps ?? 500,
      },
      license_snapshot: {
        max_devices: input.maxDevices ?? 1,
        allow_export: Boolean(input.allowExport),
        watermark_enabled: Boolean(input.watermarkEnabled),
      },
      backend: {
        archive_api_id: input.archiveId,
      },
      crypto: {
        content_algorithm: 'XChaCha20-Poly1305',
        kdf: 'HKDF-SHA-256',
        chunk_size: 1048576,
      },
    };

    const metadataPath = path.join(dir, `${input.archiveId}.metadata.json`);
    fs.writeFileSync(metadataPath, canonicalizeJson(publicHeader), 'utf8');

    const signingKeyId = this.env.archiveKeyId;
    const signingKeypair = this.env.archiveSigningKeypair;
    const signingPublicKeyB64 = Buffer.from(signingKeypair.publicKey).toString('base64');
    const cliBinary = this.getCliPath();

    try {
      const result = await this.executeDuplexCreate(
        cliBinary,
        input.sourceFilesDir,
        metadataPath,
        input.outputFilePath,
        signingKeyId,
        signingPublicKeyB64,
        contentKey,
        signingKeypair.secretKey,
      );

      this.logger.log(
        `Archive built successfully with solarch-cli: ${input.archiveId} -> ${input.outputFilePath} (${result.sizeBytes} bytes, fingerprint: ${result.archiveFingerprint})`,
      );

      return {
        outputFilePath: input.outputFilePath,
        archiveFingerprint: result.archiveFingerprint,
        contentKey,
        sizeBytes: result.sizeBytes,
      };
    } finally {
      if (fs.existsSync(metadataPath)) {
        try {
          fs.unlinkSync(metadataPath);
        } catch {
          // best-effort cleanup
        }
      }
    }
  }

  private executeDuplexCreate(
    cliBinary: string,
    inputDir: string,
    metadataPath: string,
    outputPath: string,
    signingKeyId: string,
    signingPublicKeyB64: string,
    ack: Buffer,
    secretKey: Uint8Array,
  ): Promise<{ archiveFingerprint: string; sizeBytes: number }> {
    return new Promise((resolve, reject) => {
      const args = [
        'create',
        '--input-dir',
        inputDir,
        '--metadata',
        metadataPath,
        '--output',
        outputPath,
        '--signing-key-id',
        signingKeyId,
        '--signing-public-key',
        signingPublicKeyB64,
      ];

      const child = spawn(cliBinary, args, {
        stdio: ['pipe', 'pipe', 'pipe'],
      });

      let stdoutChunks: Buffer[] = [];
      let stderrText = '';
      let signingProcessed = false;

      child.stderr.on('data', (chunk) => {
        stderrText += chunk.toString('utf8');
      });

      child.on('error', (err) => {
        reject(
          new Error(
            `Failed to spawn solarch CLI (${cliBinary}): ${err.message}. Ensure Rust solarch-cli is built.`,
          ),
        );
      });

      // Send ACK frame: SLRKEY01 + 32-byte ACK (40 bytes)
      const ackFrame = Buffer.concat([ACK_FRAME_MAGIC, ack]);
      child.stdin.write(ackFrame);

      child.stdout.on('data', (chunk: Buffer) => {
        stdoutChunks.push(chunk);
        const totalBuffer = Buffer.concat(stdoutChunks);

        if (!signingProcessed && totalBuffer.length >= 40) {
          const frameMagic = totalBuffer.subarray(0, 8);
          if (!frameMagic.equals(SIGNING_FRAME_MAGIC)) {
            child.kill();
            return reject(
              new Error(
                `Invalid signing frame magic from solarch-cli: expected SLRSIGN1, got ${frameMagic.toString('utf8')}`,
              ),
            );
          }

          const signingDigest = totalBuffer.subarray(8, 40);
          stdoutChunks = [totalBuffer.subarray(40)];
          signingProcessed = true;

          // Pure Ed25519 signature over D("SolArch/slr-signature/v1") || signingDigest
          const signingMessage = Buffer.concat([SIGNATURE_DOMAIN, signingDigest]);
          const signature = Buffer.from(nacl.sign.detached(new Uint8Array(signingMessage), secretKey));

          child.stdin.write(signature);
          child.stdin.end();
        }
      });

      child.on('close', (code) => {
        if (code !== 0) {
          return reject(
            new Error(`solarch-cli create exited with code ${code}: ${stderrText.trim()}`),
          );
        }

        try {
          const remainingStdout = Buffer.concat(stdoutChunks).toString('utf8').trim();
          const lastLine = remainingStdout.split('\n').filter(Boolean).pop();
          if (!lastLine) {
            return reject(new Error('solarch-cli did not output JSON completion line'));
          }

          const parsed = JSON.parse(lastLine);
          if (!parsed.success || !parsed.archive_fingerprint) {
            return reject(
              new Error(`solarch-cli did not report success: ${JSON.stringify(parsed)}`),
            );
          }

          resolve({
            archiveFingerprint: parsed.archive_fingerprint,
            sizeBytes: parsed.size_bytes ?? fs.statSync(outputPath).size,
          });
        } catch (e) {
          reject(new Error(`Failed to parse solarch-cli response: ${e.message}`));
        }
      });
    });
  }

  async verify(archivePath: string, keyId: string, publicKeyB64: string): Promise<boolean> {
    const cliBinary = this.getCliPath();
    return new Promise((resolve) => {
      const child = spawn(
        cliBinary,
        [
          'verify',
          '--archive',
          archivePath,
          '--signing-key-id',
          keyId,
          '--signing-public-key',
          publicKeyB64,
        ],
        { stdio: ['ignore', 'pipe', 'pipe'] },
      );

      let stdoutText = '';
      child.stdout.on('data', (d) => {
        stdoutText += d.toString('utf8');
      });

      child.on('close', (code) => {
        if (code !== 0) {
          resolve(false);
          return;
        }
        try {
          const json = JSON.parse(stdoutText.trim().split('\n').pop() || '{}');
          resolve(Boolean(json.success && json.protected_content_verified));
        } catch {
          resolve(false);
        }
      });
    });
  }
}
