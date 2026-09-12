import { Injectable, Logger } from '@nestjs/common';
import { randomBytes, createHash } from 'crypto';
import * as fs from 'fs';
import * as path from 'path';
import { spawn } from 'child_process';
import * as nacl from 'tweetnacl';
import { EnvService } from '@/config/env.service';
import { canonicalizeJson } from '@/crypto/jcs.util';
import { formatExactSecondUtc, zeroizeBuffer } from '@/crypto/token32.util';

const ACK_FRAME_MAGIC = Buffer.from('SLRKEY01', 'utf8');
const SIGNING_FRAME_MAGIC = Buffer.from('SLRSIGN1', 'utf8');
const SIGNATURE_DOMAIN = Buffer.from('SolArch/slr-signature/v1\0', 'utf8');

const JOB_TIMEOUT_MS = 900_000; // 900 seconds overall limit
const VERIFY_SIGN_TIMEOUT_MS = 300_000; // 300 seconds verification/signing limit
const STDERR_CAP_BYTES = 16_384; // 16 KiB stderr drain cap
const JSON_LINE_CAP_BYTES = 4_096; // 4 KiB JSON stdout cap

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

  private getSanitizedEnv(): NodeJS.ProcessEnv {
    return {
      PATH: process.env.PATH || '',
      SYSTEMROOT: process.env.SYSTEMROOT || '',
      TEMP: process.env.TEMP || '',
      TMP: process.env.TMP || '',
      USERPROFILE: process.env.USERPROFILE || '',
      HOMEDRIVE: process.env.HOMEDRIVE || '',
      HOMEPATH: process.env.HOMEPATH || '',
    };
  }

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

      // Final independent verification of completed file
      const finalVerified = await this.verify(input.outputFilePath, signingKeyId, signingPublicKeyB64);
      if (!finalVerified) {
        throw new Error(`Final independent solarch verify failed for ${input.outputFilePath}`);
      }

      // Assert independent file fingerprint matches
      const fileBytes = fs.readFileSync(input.outputFilePath);
      const computedFinalFingerprint = createHash('sha256').update(fileBytes).digest('hex').toLowerCase();
      if (computedFinalFingerprint !== result.archiveFingerprint.toLowerCase()) {
        throw new Error(
          `Final archive fingerprint mismatch: declared ${result.archiveFingerprint}, computed ${computedFinalFingerprint}`,
        );
      }

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
      const pendingPath = `${outputPath}.pending`;
      let resolved = false;

      const finishReject = (err: Error) => {
        if (!resolved) {
          resolved = true;
          if (child && !child.killed) {
            try {
              child.kill('SIGKILL');
            } catch {
              // ignore
            }
          }
          // Best effort cleanup of unfinished artifacts
          if (fs.existsSync(pendingPath)) {
            try {
              fs.unlinkSync(pendingPath);
            } catch {
              // ignore
            }
          }
          reject(err);
        }
      };

      const jobTimer = setTimeout(() => {
        finishReject(new Error(`solarch create exceeded overall timeout of ${JOB_TIMEOUT_MS}ms`));
      }, JOB_TIMEOUT_MS);

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
        env: this.getSanitizedEnv(),
        shell: false,
      });

      let stdoutChunks: Buffer[] = [];
      let stderrBytes = 0;
      let stderrText = '';
      let signingProcessed = false;

      child.stderr.on('data', (chunk: Buffer) => {
        if (stderrBytes < STDERR_CAP_BYTES) {
          const slice = chunk.subarray(0, STDERR_CAP_BYTES - stderrBytes);
          stderrText += slice.toString('utf8');
          stderrBytes += slice.length;
        }
      });

      child.on('error', (err) => {
        clearTimeout(jobTimer);
        finishReject(
          new Error(
            `Failed to spawn solarch CLI (${cliBinary}): ${err.message}. Ensure Rust solarch-cli is built.`,
          ),
        );
      });

      // Step 1: Send SLRKEY01 || ACK (40 bytes)
      const ackFrame = Buffer.concat([ACK_FRAME_MAGIC, ack]);
      child.stdin.write(ackFrame);

      child.stdout.on('data', async (chunk: Buffer) => {
        stdoutChunks.push(chunk);
        const totalBuffer = Buffer.concat(stdoutChunks);

        if (!signingProcessed && totalBuffer.length >= 40) {
          const frameMagic = totalBuffer.subarray(0, 8);
          if (!frameMagic.equals(SIGNING_FRAME_MAGIC)) {
            clearTimeout(jobTimer);
            return finishReject(
              new Error(
                `Invalid signing frame magic from solarch-cli: expected SLRSIGN1, got ${frameMagic.toString('utf8')}`,
              ),
            );
          }

          const signingDigest = totalBuffer.subarray(8, 40);
          stdoutChunks = [totalBuffer.subarray(40)];
          signingProcessed = true;

          // Step 3: Independent verification of pending build before signing
          try {
            const verifierResult = await this.executePendingBuildVerify(
              cliBinary,
              pendingPath,
              inputDir,
              metadataPath,
              signingKeyId,
              ack,
            );

            // Independent digest recomputation over pending bytes
            if (!fs.existsSync(pendingPath)) {
              throw new Error(`Pending build file not found at ${pendingPath}`);
            }
            const pendingBytes = fs.readFileSync(pendingPath);
            const computedDigestHex = createHash('sha256').update(pendingBytes).digest('hex').toLowerCase();
            const childDigestHex = signingDigest.toString('hex').toLowerCase();

            if (computedDigestHex !== childDigestHex) {
              throw new Error(
                `Pending digest mismatch: child claimed ${childDigestHex}, computed ${computedDigestHex}`,
              );
            }
            if (verifierResult.signing_digest.toLowerCase() !== computedDigestHex) {
              throw new Error(
                `Verifier digest mismatch: verifier reported ${verifierResult.signing_digest}, computed ${computedDigestHex}`,
              );
            }

            // Step 4: Pure Ed25519 signature over D("SolArch/slr-signature/v1") || T
            const signingMessage = Buffer.concat([SIGNATURE_DOMAIN, signingDigest]);
            const signature = Buffer.from(nacl.sign.detached(new Uint8Array(signingMessage), secretKey));
            if (signature.length !== 64) {
              throw new Error(`Invalid Ed25519 signature length: expected 64, got ${signature.length}`);
            }

            // Write exactly 64 raw signature bytes then close stdin
            child.stdin.write(signature);
            child.stdin.end();
          } catch (verifyErr) {
            clearTimeout(jobTimer);
            return finishReject(
              new Error(`Pending build verification/signing aborted: ${verifyErr.message}`),
            );
          }
        }
      });

      child.on('close', (code) => {
        clearTimeout(jobTimer);
        if (code !== 0) {
          return finishReject(
            new Error(`solarch-cli create exited with code ${code}: ${stderrText.trim()}`),
          );
        }

        try {
          const remainingStdout = Buffer.concat(stdoutChunks).toString('utf8').trim();
          const lastLine = remainingStdout.split('\n').filter(Boolean).pop();
          if (!lastLine) {
            return finishReject(new Error('solarch-cli did not output JSON completion line'));
          }
          if (Buffer.byteLength(lastLine, 'utf8') > JSON_LINE_CAP_BYTES) {
            return finishReject(new Error('solarch-cli JSON output line exceeded cap of 4096 bytes'));
          }

          const parsed = JSON.parse(lastLine);
          if (!parsed.success || !parsed.archive_fingerprint) {
            return finishReject(
              new Error(`solarch-cli did not report success: ${JSON.stringify(parsed)}`),
            );
          }

          resolved = true;
          resolve({
            archiveFingerprint: parsed.archive_fingerprint,
            sizeBytes: parsed.size_bytes ?? fs.statSync(outputPath).size,
          });
        } catch (e) {
          finishReject(new Error(`Failed to parse solarch-cli response: ${e.message}`));
        }
      });
    });
  }

  private executePendingBuildVerify(
    cliBinary: string,
    pendingPath: string,
    inputDir: string,
    metadataPath: string,
    signingKeyId: string,
    ack: Buffer,
  ): Promise<{ success: boolean; signing_digest: string; file_count: number; size_bytes: number }> {
    return new Promise((resolve, reject) => {
      let settled = false;
      const verifyTimer = setTimeout(() => {
        if (!settled) {
          settled = true;
          if (child && !child.killed) {
            try {
              child.kill('SIGKILL');
            } catch {
              // ignore
            }
          }
          reject(new Error(`solarch verify --pending-build timed out after ${VERIFY_SIGN_TIMEOUT_MS}ms`));
        }
      }, VERIFY_SIGN_TIMEOUT_MS);

      const args = [
        'verify',
        '--pending-build',
        pendingPath,
        '--input-dir',
        inputDir,
        '--metadata',
        metadataPath,
        '--signing-key-id',
        signingKeyId,
      ];

      const child = spawn(cliBinary, args, {
        stdio: ['pipe', 'pipe', 'pipe'],
        env: this.getSanitizedEnv(),
        shell: false,
      });

      let stdoutText = '';
      let stderrBytes = 0;
      let stderrText = '';

      child.stderr.on('data', (chunk: Buffer) => {
        if (stderrBytes < STDERR_CAP_BYTES) {
          const slice = chunk.subarray(0, STDERR_CAP_BYTES - stderrBytes);
          stderrText += slice.toString('utf8');
          stderrBytes += slice.length;
        }
      });

      child.stdout.on('data', (chunk: Buffer) => {
        stdoutText += chunk.toString('utf8');
      });

      child.on('error', (err) => {
        clearTimeout(verifyTimer);
        if (!settled) {
          settled = true;
          reject(new Error(`Failed to spawn pending verifier: ${err.message}`));
        }
      });

      // Send SLRKEY01 || ACK (40 bytes) then close stdin
      const ackFrame = Buffer.concat([ACK_FRAME_MAGIC, ack]);
      child.stdin.write(ackFrame);
      child.stdin.end();

      child.on('close', (code) => {
        clearTimeout(verifyTimer);
        if (settled) return;
        settled = true;

        if (code !== 0) {
          return reject(
            new Error(
              `solarch verify --pending-build failed with exit code ${code}: ${stderrText.trim()}`,
            ),
          );
        }

        try {
          const lastLine = stdoutText.trim().split('\n').filter(Boolean).pop();
          if (!lastLine) {
            return reject(new Error('solarch verify --pending-build emitted no JSON output'));
          }
          if (Buffer.byteLength(lastLine, 'utf8') > JSON_LINE_CAP_BYTES) {
            return reject(new Error('solarch verify --pending-build JSON exceeded 4096 bytes'));
          }

          const parsed = JSON.parse(lastLine);
          if (!parsed.success || !parsed.signing_digest) {
            return reject(
              new Error(`solarch verify --pending-build reported failure: ${JSON.stringify(parsed)}`),
            );
          }

          resolve(parsed);
        } catch (e) {
          reject(new Error(`Failed to parse pending verifier JSON: ${e.message}`));
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
        {
          stdio: ['ignore', 'pipe', 'pipe'],
          env: this.getSanitizedEnv(),
          shell: false,
        },
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
          // Note per prompt: finalized solarch verify authenticates the container structure and signature;
          // protected_content_verified does not need to be true without ACK.
          resolve(Boolean(json.success));
        } catch {
          resolve(false);
        }
      });
    });
  }
}
