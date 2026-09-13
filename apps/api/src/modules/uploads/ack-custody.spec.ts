import { Test, TestingModule } from '@nestjs/testing';
import { ServiceUnavailableException } from '@nestjs/common';
import * as fs from 'fs';
import * as path from 'path';
import { AckCustodyService } from './ack-custody.service';
import { EnvService } from '@/config/env.service';

describe('AckCustodyService', () => {
  let service: AckCustodyService;
  const testStorageRoot = path.resolve(__dirname, '../../../test_storage_custody');

  beforeAll(() => {
    if (!fs.existsSync(testStorageRoot)) {
      fs.mkdirSync(testStorageRoot, { recursive: true });
    }
  });

  afterAll(() => {
    if (fs.existsSync(testStorageRoot)) {
      fs.rmSync(testStorageRoot, { recursive: true, force: true });
    }
  });

  beforeEach(async () => {
    const module: TestingModule = await Test.createTestingModule({
      providers: [
        AckCustodyService,
        {
          provide: EnvService,
          useValue: {
            ackKekSecret: 'test-ack-kek-32-chars-minimum-secret',
            storageRoot: testStorageRoot,
          },
        },
      ],
    }).compile();

    service = module.get<AckCustodyService>(AckCustodyService);
  });

  test('seals and unseals ACK correctly with authenticated AEAD envelope', async () => {
    const archiveId = 'arc_custody_001';
    const archiveFingerprint = '57ce84068fdd9b23f8860afa27834151f4fefb038d812c2ac77e8a861b1eecdb';
    const rawAck = Buffer.from('a0a1a2a3a4a5a6a7a8a9aaabacadaeafb0b1b2b3b4b5b6b7b8b9babbbcbdbebf', 'hex');
    const originalAckCopy = Buffer.from(rawAck);

    const { contentKeyRef } = await service.seal(archiveId, archiveFingerprint, rawAck);
    expect(contentKeyRef).toBeDefined();
    expect(contentKeyRef.startsWith('ack_custody_')).toBe(true);

    const unsealed = await service.unseal(archiveId, archiveFingerprint, contentKeyRef);
    expect(unsealed.equals(originalAckCopy)).toBe(true);
  });

  test('fails closed when envelope file is tampered', async () => {
    const archiveId = 'arc_custody_tamper';
    const archiveFingerprint = '57ce84068fdd9b23f8860afa27834151f4fefb038d812c2ac77e8a861b1eecdb';
    const rawAck = Buffer.alloc(32, 0x42);

    const { contentKeyRef } = await service.seal(archiveId, archiveFingerprint, rawAck);

    // Tamper with file
    const custodyFile = path.join(testStorageRoot, 'custody', `${archiveId}.ack.enc`);
    const envelope = JSON.parse(fs.readFileSync(custodyFile, 'utf8'));
    // Flip ciphertext byte
    const cipherBuf = Buffer.from(envelope.ciphertext, 'base64');
    cipherBuf[0] ^= 0xff;
    envelope.ciphertext = cipherBuf.toString('base64');
    fs.writeFileSync(custodyFile, JSON.stringify(envelope));

    await expect(service.unseal(archiveId, archiveFingerprint, contentKeyRef)).rejects.toThrow(
      ServiceUnavailableException,
    );
  });

  test('fails closed when archive fingerprint does not match envelope binding', async () => {
    const archiveId = 'arc_custody_binding';
    const archiveFingerprint = '57ce84068fdd9b23f8860afa27834151f4fefb038d812c2ac77e8a861b1eecdb';
    const rawAck = Buffer.alloc(32, 0x42);

    const { contentKeyRef } = await service.seal(archiveId, archiveFingerprint, rawAck);

    await expect(
      service.unseal(archiveId, 'wrong_fingerprint_000000000000000000000000000000000000000000000000', contentKeyRef),
    ).rejects.toThrow(ServiceUnavailableException);
  });

  test('fails closed instead of treating a plaintext 64-hex value as live ACK custody', async () => {
    await expect(
      service.unseal(
        'arc_plaintext_fallback',
        '57ce84068fdd9b23f8860afa27834151f4fefb038d812c2ac77e8a861b1eecdb',
        'a0a1a2a3a4a5a6a7a8a9aaabacadaeafb0b1b2b3b4b5b6b7b8b9babbbcbdbebf',
      ),
    ).rejects.toThrow(ServiceUnavailableException);
  });
});
