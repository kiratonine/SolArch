import { Injectable, Logger, ServiceUnavailableException } from '@nestjs/common';
import { randomBytes, createCipheriv, createDecipheriv, hkdfSync, randomUUID } from 'crypto';
import * as fs from 'fs';
import * as path from 'path';
import { EnvService } from '@/config/env.service';
import { zeroizeBuffer } from '@/crypto/token32.util';

const KEK_DOMAIN = Buffer.from('SolArch/ack-custody-kek/v1\0', 'utf8');

export interface AckCustodyEnvelope {
  version: 1;
  archive_id: string;
  archive_fingerprint: string;
  iv: string; // 12 bytes base64
  tag: string; // 16 bytes base64
  ciphertext: string; // base64
  created_at: string;
}

@Injectable()
export class AckCustodyService {
  private readonly logger = new Logger(AckCustodyService.name);

  constructor(private readonly env: EnvService) {}

  private deriveKey(): Buffer {
    const rawSecret = Buffer.from(this.env.ackKekSecret, 'utf8');
    const salt = Buffer.alloc(32, 0);
    const derived = hkdfSync('sha256', rawSecret, salt, KEK_DOMAIN, 32);
    return Buffer.from(derived);
  }

  private getCustodyFilePath(archiveId: string): string {
    const custodyDir = path.join(this.env.storageRoot, 'custody');
    if (!fs.existsSync(custodyDir)) {
      fs.mkdirSync(custodyDir, { recursive: true });
    }
    return path.join(custodyDir, `${archiveId}.ack.enc`);
  }

  async seal(
    archiveId: string,
    archiveFingerprint: string,
    rawAck: Buffer,
  ): Promise<{ contentKeyRef: string }> {
    if (!rawAck || rawAck.length !== 32) {
      throw new Error('Raw ACK must be exactly 32 bytes');
    }

    const key = this.deriveKey();
    const iv = randomBytes(12);
    const aad = Buffer.from(`${archiveId}:${archiveFingerprint}`, 'utf8');

    const cipher = createCipheriv('aes-256-gcm', key, iv);
    cipher.setAAD(aad);

    const ciphertext = Buffer.concat([cipher.update(rawAck), cipher.final()]);
    const tag = cipher.getAuthTag();

    const envelope: AckCustodyEnvelope = {
      version: 1,
      archive_id: archiveId,
      archive_fingerprint: archiveFingerprint,
      iv: iv.toString('base64'),
      tag: tag.toString('base64'),
      ciphertext: ciphertext.toString('base64'),
      created_at: new Date().toISOString(),
    };

    const filePath = this.getCustodyFilePath(archiveId);
    fs.writeFileSync(filePath, JSON.stringify(envelope, null, 2), 'utf8');

    // Best effort zeroize temporary buffers
    zeroizeBuffer(key);

    const contentKeyRef = `ack_custody_${randomUUID()}`;
    return { contentKeyRef };
  }

  async unseal(
    archiveId: string,
    archiveFingerprint: string,
    contentKeyRef?: string | null,
  ): Promise<Buffer> {
    if (!contentKeyRef) {
      this.logger.error(`Archive ${archiveId} missing contentKeyRef`);
      throw new ServiceUnavailableException('Archive content key unavailable');
    }

    const filePath = this.getCustodyFilePath(archiveId);
    if (!fs.existsSync(filePath)) {
      this.logger.error(`Archive ${archiveId} custody file not found at ${filePath}`);
      throw new ServiceUnavailableException('Archive content key custody unavailable');
    }

    let envelope: AckCustodyEnvelope;
    try {
      envelope = JSON.parse(fs.readFileSync(filePath, 'utf8'));
    } catch (e) {
      this.logger.error(`Failed to parse custody envelope for archive ${archiveId}: ${e.message}`);
      throw new ServiceUnavailableException('Archive content key corrupted');
    }

    if (
      envelope.archive_id !== archiveId ||
      envelope.archive_fingerprint !== archiveFingerprint
    ) {
      this.logger.error(
        `Custody envelope binding mismatch for archive ${archiveId}. Expected ${archiveId}:${archiveFingerprint}, got ${envelope.archive_id}:${envelope.archive_fingerprint}`,
      );
      throw new ServiceUnavailableException('Archive content key binding mismatch');
    }

    const key = this.deriveKey();
    const iv = Buffer.from(envelope.iv, 'base64');
    const tag = Buffer.from(envelope.tag, 'base64');
    const ciphertext = Buffer.from(envelope.ciphertext, 'base64');
    const aad = Buffer.from(`${archiveId}:${archiveFingerprint}`, 'utf8');

    try {
      const decipher = createDecipheriv('aes-256-gcm', key, iv);
      decipher.setAAD(aad);
      decipher.setAuthTag(tag);

      const plaintext = Buffer.concat([decipher.update(ciphertext), decipher.final()]);
      zeroizeBuffer(key);

      if (plaintext.length !== 32) {
        zeroizeBuffer(plaintext);
        throw new Error('Decrypted ACK is not 32 bytes');
      }

      return plaintext;
    } catch (err) {
      zeroizeBuffer(key);
      this.logger.error(`Failed to authenticate and decrypt ACK custody for archive ${archiveId}: ${err.message}`);
      throw new ServiceUnavailableException('Archive content key authentication failed');
    }
  }
}
