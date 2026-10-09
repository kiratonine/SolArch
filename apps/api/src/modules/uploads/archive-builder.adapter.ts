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
    const configured = this.env.solarchCliPath;
    if (configured) {
      return configured;
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
    if (
      input.platformFeeBps !== 500 ||
      input.maxDevices !== 1 ||
      input.allowExport !== false ||
      input.watermarkEnabled !== true
    ) {
      throw new Error('Archive policy does not match the frozen SolArch MVP policy');
    }
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
        platform_fee_bps: input.platformFeeBps,
      },
      license_snapshot: {
        max_devices: input.maxDevices,
        allow_export: input.allowExport,
        watermark_enabled: input.watermarkEnabled,
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
    let completed = false;

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
      await this.executeFinalVerify(
        cliBinary,
        input.outputFilePath,
        signingKeyId,
        signingPublicKeyB64,
      );

      // Assert independent file fingerprint matches
      const computedFinalFingerprint = await this.hashFileSha256(input.outputFilePath);
      if (computedFinalFingerprint !== result.archiveFingerprint.toLowerCase()) {
        throw new Error(
          `Final archive fingerprint mismatch: declared ${result.archiveFingerprint}, computed ${computedFinalFingerprint}`,
        );
      }

      this.logger.log(
        `Archive built successfully with solarch-cli: ${input.archiveId} -> ${input.outputFilePath} (${result.sizeBytes} bytes, fingerprint: ${result.archiveFingerprint})`,
      );

      completed = true;
      return {
        outputFilePath: input.outputFilePath,
        archiveFingerprint: result.archiveFingerprint,
        contentKey,
        sizeBytes: result.sizeBytes,
      };
    } finally {
      if (!completed) {
        zeroizeBuffer(contentKey);
        if (fs.existsSync(input.outputFilePath)) {
          try {
            fs.unlinkSync(input.outputFilePath);
          } catch {
            // Unverified output is never persisted as ready; cleanup is best effort.
          }
        }
      }
      if (fs.existsSync(metadataPath)) {
        try {
          fs.unlinkSync(metadataPath);
        } catch {
          // best-effort cleanup
        }
      }
    }
  }

  private hashFileSha256(filePath: string): Promise<string> {
    return new Promise((resolve, reject) => {
      const digest = createHash('sha256');
      const input = fs.createReadStream(filePath);
      input.on('error', reject);
      input.on('data', (chunk) => digest.update(chunk));
      input.on('end', () => resolve(digest.digest('hex').toLowerCase()));
    });
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

      let settled = false;
      let terminalError: Error | undefined;
      let signingFrame = Buffer.alloc(0);
      const completionChunks: Buffer[] = [];
      let completionBytes = 0;
      let stderrBytes = 0;
      let stderrText = '';
      let signingProcessed = false;

      const cleanupPending = () => {
        if (fs.existsSync(pendingPath)) {
          try {
            fs.unlinkSync(pendingPath);
          } catch {
            // Best-effort cleanup of an untrusted incomplete build.
          }
        }
      };

      const requestStop = (error: Error) => {
        terminalError ??= error;
        if (!child.killed) {
          try {
            child.kill('SIGKILL');
          } catch {
            // The close/error handlers still fail closed.
          }
        }
      };

      const appendCompletion = (chunk: Buffer) => {
        const remaining = JSON_LINE_CAP_BYTES - completionBytes;
        if (remaining > 0) {
          const slice = chunk.subarray(0, remaining);
          completionChunks.push(slice);
          completionBytes += slice.length;
        }
        if (chunk.length > remaining) {
          requestStop(new Error(`solarch create JSON stdout exceeded ${JSON_LINE_CAP_BYTES} bytes`));
        }
      };

      const jobTimer = setTimeout(() => {
        requestStop(new Error(`solarch create exceeded overall timeout of ${JOB_TIMEOUT_MS}ms`));
      }, JOB_TIMEOUT_MS);

      child.stderr.on('data', (chunk: Buffer) => {
        if (stderrBytes < STDERR_CAP_BYTES) {
          const slice = chunk.subarray(0, STDERR_CAP_BYTES - stderrBytes);
          stderrText += slice.toString('utf8');
          stderrBytes += slice.length;
        }
      });

      child.on('error', (err) => {
        requestStop(
          new Error(
            `Failed to spawn solarch CLI (${cliBinary}): ${err.message}. Ensure Rust solarch-cli is built.`,
          ),
        );
      });

      child.stdin.on('error', (err) => {
        requestStop(new Error(`solarch create stdin failed: ${err.message}`));
      });

      // Step 1: Send SLRKEY01 || ACK (40 bytes)
      const ackFrame = Buffer.concat([ACK_FRAME_MAGIC, ack]);
      child.stdin.write(ackFrame);

      child.stdout.on('data', async (rawChunk: Buffer | string) => {
        if (terminalError) return;
        let chunk = Buffer.isBuffer(rawChunk) ? rawChunk : Buffer.from(rawChunk);

        if (!signingProcessed) {
          const needed = 40 - signingFrame.length;
          const frameSlice = chunk.subarray(0, needed);
          signingFrame = Buffer.concat([signingFrame, frameSlice]);
          chunk = chunk.subarray(frameSlice.length);
          if (signingFrame.length < 40) return;

          const frameMagic = signingFrame.subarray(0, 8);
          if (!frameMagic.equals(SIGNING_FRAME_MAGIC)) {
            requestStop(
              new Error(
                `Invalid signing frame magic from solarch-cli: expected SLRSIGN1, got ${frameMagic.toString('utf8')}`,
              ),
            );
            return;
          }

          const signingDigest = signingFrame.subarray(8, 40);
          signingFrame = Buffer.alloc(0);
          signingProcessed = true;
          if (chunk.length > 0) appendCompletion(chunk);

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
            const computedDigestHex = await this.hashFileSha256(pendingPath);
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
            requestStop(
              new Error(
                `Pending build verification/signing aborted: ${verifyErr instanceof Error ? verifyErr.message : 'unknown error'}`,
              ),
            );
          }
          return;
        }

        appendCompletion(chunk);
      });

      child.on('close', (code, signal) => {
        clearTimeout(jobTimer);
        if (settled) return;
        settled = true;
        if (terminalError) {
          cleanupPending();
          reject(terminalError);
          return;
        }
        if (code !== 0) {
          cleanupPending();
          reject(
            new Error(
              `solarch-cli create exited with code ${String(code)} signal ${String(signal)}: ${stderrText.trim()}`,
            ),
          );
          return;
        }

        try {
          if (!signingProcessed) {
            throw new Error('solarch-cli did not emit the exact 40-byte signing frame');
          }
          const remainingStdout = Buffer.concat(completionChunks).toString('utf8').trim();
          const lastLine = remainingStdout.split('\n').filter(Boolean).pop();
          if (!lastLine) {
            throw new Error('solarch-cli did not output JSON completion line');
          }

          const parsed = JSON.parse(lastLine);
          if (!parsed.success || !parsed.archive_fingerprint) {
            throw new Error(`solarch-cli did not report success: ${JSON.stringify(parsed)}`);
          }

          resolve({
            archiveFingerprint: parsed.archive_fingerprint,
            sizeBytes: parsed.size_bytes ?? fs.statSync(outputPath).size,
          });
        } catch (e) {
          cleanupPending();
          reject(
            new Error(
              `Failed to parse solarch-cli response: ${e instanceof Error ? e.message : 'unknown error'}`,
            ),
          );
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

      const stdoutChunks: Buffer[] = [];
      let stdoutBytes = 0;
      let stderrBytes = 0;
      let stderrText = '';
      let terminalError: Error | undefined;

      const requestStop = (error: Error) => {
        terminalError ??= error;
        if (!child.killed) {
          try {
            child.kill('SIGKILL');
          } catch {
            // The close/error handlers still fail closed.
          }
        }
      };

      const verifyTimer = setTimeout(() => {
        requestStop(
          new Error(`solarch verify --pending-build timed out after ${VERIFY_SIGN_TIMEOUT_MS}ms`),
        );
      }, VERIFY_SIGN_TIMEOUT_MS);

      child.stderr.on('data', (chunk: Buffer) => {
        if (stderrBytes < STDERR_CAP_BYTES) {
          const slice = chunk.subarray(0, STDERR_CAP_BYTES - stderrBytes);
          stderrText += slice.toString('utf8');
          stderrBytes += slice.length;
        }
      });

      child.stdout.on('data', (rawChunk: Buffer | string) => {
        const chunk = Buffer.isBuffer(rawChunk) ? rawChunk : Buffer.from(rawChunk);
        const remaining = JSON_LINE_CAP_BYTES - stdoutBytes;
        if (remaining > 0) {
          const slice = chunk.subarray(0, remaining);
          stdoutChunks.push(slice);
          stdoutBytes += slice.length;
        }
        if (chunk.length > remaining) {
          requestStop(
            new Error(`solarch verify --pending-build stdout exceeded ${JSON_LINE_CAP_BYTES} bytes`),
          );
        }
      });

      child.on('error', (err) => {
        requestStop(new Error(`Failed to spawn pending verifier: ${err.message}`));
      });

      child.stdin.on('error', (err) => {
        requestStop(new Error(`Pending verifier stdin failed: ${err.message}`));
      });

      // Send SLRKEY01 || ACK (40 bytes) then close stdin
      const ackFrame = Buffer.concat([ACK_FRAME_MAGIC, ack]);
      child.stdin.write(ackFrame);
      child.stdin.end();

      child.on('close', (code, signal) => {
        clearTimeout(verifyTimer);
        if (settled) return;
        settled = true;

        if (terminalError) {
          reject(terminalError);
          return;
        }

        if (code !== 0) {
          return reject(
            new Error(
              `solarch verify --pending-build failed with exit code ${String(code)} signal ${String(signal)}: ${stderrText.trim()}`,
            ),
          );
        }

        try {
          const stdoutText = Buffer.concat(stdoutChunks).toString('utf8');
          const lastLine = stdoutText.trim().split('\n').filter(Boolean).pop();
          if (!lastLine) {
            return reject(new Error('solarch verify --pending-build emitted no JSON output'));
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

  private executeFinalVerify(
    cliBinary: string,
    archivePath: string,
    keyId: string,
    publicKeyB64: string,
  ): Promise<void> {
    return new Promise((resolve, reject) => {
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

      const stdoutChunks: Buffer[] = [];
      let stdoutBytes = 0;
      let stderrBytes = 0;
      let stderrText = '';
      let terminalError: Error | undefined;

      const requestStop = (error: Error) => {
        terminalError ??= error;
        if (!child.killed) {
          try {
            child.kill('SIGKILL');
          } catch {
            // The close/error handlers below still fail closed.
          }
        }
      };

      const verifyTimer = setTimeout(() => {
        requestStop(new Error(`Final solarch verify timed out after ${VERIFY_SIGN_TIMEOUT_MS}ms`));
      }, VERIFY_SIGN_TIMEOUT_MS);

      child.stdout.on('data', (rawChunk: Buffer | string) => {
        const chunk = Buffer.isBuffer(rawChunk) ? rawChunk : Buffer.from(rawChunk);
        const remaining = JSON_LINE_CAP_BYTES - stdoutBytes;
        if (remaining > 0) {
          const slice = chunk.subarray(0, remaining);
          stdoutChunks.push(slice);
          stdoutBytes += slice.length;
        }
        if (chunk.length > remaining) {
          requestStop(new Error(`Final solarch verify stdout exceeded ${JSON_LINE_CAP_BYTES} bytes`));
        }
      });

      child.stderr.on('data', (rawChunk: Buffer | string) => {
        const chunk = Buffer.isBuffer(rawChunk) ? rawChunk : Buffer.from(rawChunk);
        if (stderrBytes < STDERR_CAP_BYTES) {
          const slice = chunk.subarray(0, STDERR_CAP_BYTES - stderrBytes);
          stderrText += slice.toString('utf8');
          stderrBytes += slice.length;
        }
      });

      child.on('error', (error) => {
        requestStop(new Error(`Failed to spawn final solarch verifier: ${error.message}`));
      });

      child.on('close', (code, signal) => {
        clearTimeout(verifyTimer);
        if (terminalError) {
          reject(terminalError);
          return;
        }
        if (code !== 0) {
          reject(
            new Error(
              `Final solarch verify exited with code ${String(code)} signal ${String(signal)}: ${stderrText.trim()}`,
            ),
          );
          return;
        }
        try {
          const stdoutText = Buffer.concat(stdoutChunks).toString('utf8');
          const json = JSON.parse(stdoutText.trim().split('\n').filter(Boolean).pop() || '{}');
          // Note per prompt: finalized solarch verify authenticates the container structure and signature;
          // protected_content_verified does not need to be true without ACK.
          if (json.success !== true) {
            reject(new Error('Final solarch verify did not report success'));
            return;
          }
          resolve();
        } catch (error) {
          reject(
            new Error(
              `Failed to parse bounded final verifier JSON: ${error instanceof Error ? error.message : 'unknown error'}`,
            ),
          );
        }
      });
    });
  }
}
