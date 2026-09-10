import { Test, TestingModule } from '@nestjs/testing';
import { ForbiddenException, ConflictException, UnauthorizedException } from '@nestjs/common';
import { LicensingService } from './licensing.service';
import { PrismaService } from '@/common/prisma.service';
import { EnvService } from '@/config/env.service';
import { hashSecretToken } from '@/crypto/token32.util';
import * as nacl from 'tweetnacl';

describe('LicensingService & Device Enforcement', () => {
  let service: LicensingService;
  let prisma: any;

  const DEVICE_A = 'aTZYJUYw9zrY2nj7Mxv5ds1C+Q4OnJ6D9AxRBypvdBc=';
  const DEVICE_B = Buffer.alloc(32, 2).toString('base64');
  const PEPPER = 'test-hmac-secret-pepper-minimum-32';
  const VALID_SECRET = 'abc123def456ghi789jkl012mno345pqr678stu9012';
  const VALID_HMAC = hashSecretToken(VALID_SECRET, PEPPER);
  const VALID_AUTH_HEADER = `SolArchIntent ${VALID_SECRET}`;

  beforeEach(async () => {
    const seed = new Uint8Array(32);
    for (let i = 0; i < 32; i++) seed[i] = 0x40 + i;
    const testSigningKeys = nacl.sign.keyPair.fromSeed(seed);

    prisma = {
      entitlement: {
        findFirst: jest.fn(),
        update: jest.fn(),
      },
      requestNonceRecord: {
        findUnique: jest.fn(),
        create: jest.fn(),
      },
      deviceActivation: {
        create: jest.fn(),
      },
      deviceLicense: {
        create: jest.fn(),
        findUnique: jest.fn(),
        update: jest.fn(),
      },
    };

    const module: TestingModule = await Test.createTestingModule({
      providers: [
        LicensingService,
        { provide: PrismaService, useValue: prisma },
        {
          provide: EnvService,
          useValue: {
            licenseKeyId: 'lic-test-01',
            licenseSigningKeypair: testSigningKeys,
            intentHmacSecret: PEPPER,
          },
        },
      ],
    }).compile();

    service = module.get<LicensingService>(LicensingService);
  });

  test('rejects activation without SolArchIntent authorization header', async () => {
    const fakeEntitlement = {
      id: 'ent_001',
      devicePublicKey: DEVICE_A,
      activations: [],
      archive: {},
      payment: { paymentIntent: { clientSecretHmac: VALID_HMAC } },
    };
    prisma.entitlement.findFirst.mockResolvedValue(fakeEntitlement);

    await expect(
      service.activateDevice('ent_001', '', {
        device_public_key: DEVICE_A,
        request_nonce: 'gIGCg4SFhoeIiYqLjI2Oj5CRkpOUlZaXmJmam5ydnp8=',
      }),
    ).rejects.toThrow(UnauthorizedException);
  });

  test('successfully activates Device A with exact 72-hour window and wrapped key', async () => {
    const fakeEntitlement = {
      id: 'ent_001',
      archiveId: 'arc_001',
      buyerWallet: 'BuyerWallet1111111111111111111111111111111',
      devicePublicKey: DEVICE_A,
      devicesActivated: 0,
      archive: {
        archiveFingerprint: '57ce84068fdd9b23f8860afa27834151f4fefb038d812c2ac77e8a861b1eecdb',
        contentKeyRef: 'a0a1a2a3a4a5a6a7a8a9aaabacadaeafb0b1b2b3b4b5b6b7b8b9babbbcbdbebf',
        allowExport: false,
        watermarkEnabled: true,
      },
      payment: {
        paymentIntent: {
          clientSecretHmac: VALID_HMAC,
        },
      },
      activations: [],
    };

    prisma.entitlement.findFirst.mockResolvedValue(fakeEntitlement);
    prisma.requestNonceRecord.findUnique.mockResolvedValue(null);
    prisma.deviceActivation.create.mockResolvedValue({ id: 'act_001' });
    prisma.deviceLicense.create.mockResolvedValue({ id: 'lic_001' });

    const res = await service.activateDevice('ent_001', VALID_AUTH_HEADER, {
      device_public_key: DEVICE_A,
      device_name: 'Test PC',
      viewer_version: '0.1.0',
      request_nonce: 'gIGCg4SFhoeIiYqLjI2Oj5CRkpOUlZaXmJmam5ydnp8=',
    });

    expect(res.license).toBeDefined();
    expect(res.license.payload.device_public_key).toBe(DEVICE_A);
    expect(res.license.server_signature).toBeDefined();
    expect(res.wrapped_content_key).toBeDefined();
    expect(res.wrapped_content_key.kem_id).toBe(32);
    expect(res.device_refresh_token).toBeDefined();

    // Verify exactly 72 hours (259200 seconds)
    const issuedAt = new Date(res.license.payload.issued_at).getTime();
    const offlineValidUntil = new Date(res.license.payload.offline_valid_until).getTime();
    expect(Math.round((offlineValidUntil - issuedAt) / 1000)).toBe(259200);
  });

  test('rejects Device B activation with DEVICE_LIMIT_REACHED when entitlement is bound to Device A', async () => {
    const fakeEntitlement = {
      id: 'ent_001',
      devicePublicKey: DEVICE_A,
      activations: [],
      archive: {},
      payment: { paymentIntent: { clientSecretHmac: VALID_HMAC } },
    };

    prisma.entitlement.findFirst.mockResolvedValue(fakeEntitlement);

    await expect(
      service.activateDevice('ent_001', VALID_AUTH_HEADER, {
        device_public_key: DEVICE_B,
        request_nonce: 'gIGCg4SFhoeIiYqLjI2Oj5CRkpOUlZaXmJmam5ydnp8=',
      }),
    ).rejects.toThrow(ForbiddenException);
  });

  test('rejects request nonce replay with REQUEST_NONCE_REPLAY', async () => {
    const fakeEntitlement = {
      id: 'ent_001',
      devicePublicKey: DEVICE_A,
      activations: [],
      archive: {},
      payment: { paymentIntent: { clientSecretHmac: VALID_HMAC } },
    };

    prisma.entitlement.findFirst.mockResolvedValue(fakeEntitlement);
    // Nonce already exists
    prisma.requestNonceRecord.findUnique.mockResolvedValue({ id: 'nonce_rec_001' });

    await expect(
      service.activateDevice('ent_001', VALID_AUTH_HEADER, {
        device_public_key: DEVICE_A,
        request_nonce: 'gIGCg4SFhoeIiYqLjI2Oj5CRkpOUlZaXmJmam5ydnp8=',
      }),
    ).rejects.toThrow(ConflictException);
  });
});
