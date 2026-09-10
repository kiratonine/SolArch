import { Injectable, Logger } from '@nestjs/common';
import { createHash, randomBytes } from 'crypto';
import * as fs from 'fs';
import * as path from 'path';
import { canonicalizeJson } from '@/crypto/jcs.util';

export interface BuildArchiveInput {
  archiveId: string;
  title: string;
  creatorWallet: string;
  priceAmount: string;
  platformFeeBps: number;
  maxDevices: number;
  allowExport: boolean;
  watermarkEnabled: boolean;
  sourceFilesDir?: string;
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

  async build(input: BuildArchiveInput): Promise<BuildArchiveResult> {
    const dir = path.dirname(input.outputFilePath);
    if (!fs.existsSync(dir)) {
      fs.mkdirSync(dir, { recursive: true });
    }

    // Generate fresh 32-byte Content Key (ACK)
    const contentKey = randomBytes(32);

    // Build Public Header Snapshot
    const publicHeader = {
      format: 'solarch',
      version: '1.0.0',
      archive_id: input.archiveId,
      created_at: new Date().toISOString(),
      title: input.title,
      creator_wallet: input.creatorWallet,
      commercial_snapshot: {
        price_amount: input.priceAmount,
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
        content_algorithm: 'AES-256-GCM',
        chunk_size: 1048576,
      },
    };

    const publicHeaderJcs = Buffer.from(canonicalizeJson(publicHeader), 'utf8');

    // Container format:
    // [8 bytes magic: "SOLARCH\0"]
    // [4 bytes format_version: 1 (uint32be)]
    // [4 bytes header_length (uint32be)]
    // [public_header bytes]
    // [body mock encrypted manifest and chunks]
    // [signature block]

    const magic = Buffer.from('SOLARCH\0', 'utf8');
    const versionBuf = Buffer.alloc(4);
    versionBuf.writeUInt32BE(1, 0);

    const headerLenBuf = Buffer.alloc(4);
    headerLenBuf.writeUInt32BE(publicHeaderJcs.length, 0);

    // Encrypted dummy payload & integrity
    const mockEncryptedChunks = Buffer.concat([
      Buffer.from('ENC_MANIFEST_MOCK:', 'utf8'),
      randomBytes(64),
      Buffer.from('DATA_CHUNKS:', 'utf8'),
      randomBytes(128),
    ]);

    const slrContainer = Buffer.concat([
      magic,
      versionBuf,
      headerLenBuf,
      publicHeaderJcs,
      mockEncryptedChunks,
    ]);

    fs.writeFileSync(input.outputFilePath, slrContainer);

    // Archive Fingerprint: SHA-256 over EVERY byte of the finalized container
    const fingerprint = createHash('sha256').update(slrContainer).digest('hex').toLowerCase();

    this.logger.log(
      `Archive built successfully: ${input.archiveId} -> ${input.outputFilePath} (${slrContainer.length} bytes, fingerprint: ${fingerprint})`,
    );

    return {
      outputFilePath: input.outputFilePath,
      archiveFingerprint: fingerprint,
      contentKey,
      sizeBytes: slrContainer.length,
    };
  }
}
