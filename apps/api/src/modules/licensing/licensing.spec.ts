import { Test, TestingModule } from '@nestjs/testing';
import { ConflictException, UnauthorizedException } from '@nestjs/common';
import { LicensingService } from './licensing.service';
import { PrismaService } from '@/common/prisma.service';
import { EnvService } from '@/config/env.service';
import { hashIntentClientSecret } from '@/crypto/token32.util';
import { AckCustodyService } from '@/modules/uploads/ack-custody.service';
import * as nacl from 'tweetnacl';

describe('LicensingService & Device Enforcement', () => {
  let service: LicensingService;
  let prisma: any;

  const DEVICE_A = 'aTZYJUYw9zrY2nj7Mxv5ds1C+Q4OnJ6D9AxRBypvdBc=';
  const DEVICE_B = Buffer.alloc(32, 2).toString('base64');
  const PEPPER = 'test-hmac-secret-pepper-minimum-32';
  const VALID_SECRET = 'AAECAwQFBgcICQoLDA0ODxAREhMUFRYXGBkaGxwdHh8';
  const VALID_HMAC = hashIntentClientSecret(VALID_SECRET, PEPPER);
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
        updateMany: jest.fn(),
        findUnique: jest.fn(),
        update: jest.fn(),
      },
      $transaction: jest.fn().mockImplementation((cb) => cb(prisma)),
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
            deviceRefreshHmacSecret: PEPPER,
          },
        },
        {
          provide: AckCustodyService,
          useValue: {
            seal: jest.fn().mockResolvedValue({ contentKeyRef: 'ack_ref_001' }),
            unseal: jest.fn().mockResolvedValue(
              Buffer.from('a0a1a2a3a4a5a6a7a8a9aaabacadaeafb0b1b2b3b4b5b6b7b8b9babbbcbdbebf', 'hex'),
            ),
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
      status: 'active',
      activations: [],
      archive: {
        technicalStatus: 'ready',
        marketplaceStatus: 'published',
      },
      payment: {
        status: 'confirmed',
        paymentIntent: { clientSecretHmac: VALID_HMAC },
      },
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
      status: 'active',
      maxDevices: 1,
      devicesActivated: 0,
      archive: {
        technicalStatus: 'ready',
        marketplaceStatus: 'published',
        archiveFingerprint: '57ce84068fdd9b23f8860afa27834151f4fefb038d812c2ac77e8a861b1eecdb',
        contentKeyRef: 'ack_ref_001',
        allowExport: false,
        watermarkEnabled: true,
      },
      payment: {
        status: 'confirmed',
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

  test('recovers from partial state when activation exists but license was not persisted', async () => {
    const fakeEntitlement = {
      id: 'ent_001',
      archiveId: 'arc_001',
      buyerWallet: 'BuyerWallet1111111111111111111111111111111',
      devicePublicKey: DEVICE_A,
      status: 'active',
      maxDevices: 1,
      devicesActivated: 1,
      archive: {
        technicalStatus: 'ready',
        marketplaceStatus: 'published',
        archiveFingerprint: '57ce84068fdd9b23f8860afa27834151f4fefb038d812c2ac77e8a861b1eecdb',
        contentKeyRef: 'ack_ref_001',
        allowExport: false,
        watermarkEnabled: true,
      },
      payment: {
        status: 'confirmed',
        paymentIntent: {
          clientSecretHmac: VALID_HMAC,
        },
      },
      // Activation exists, but licenses is empty (crash occurred before license create)
      activations: [
        {
          id: 'act_001',
          devicePublicKey: DEVICE_A,
          activatedAt: new Date(Date.now() - 60_000), // 1 minute ago (within 10m window)
          licenses: [],
        },
      ],
    };

    prisma.entitlement.findFirst.mockResolvedValue(fakeEntitlement);
    prisma.requestNonceRecord.findUnique.mockResolvedValue(null);

    const res = await service.activateDevice('ent_001', VALID_AUTH_HEADER, {
      device_public_key: DEVICE_A,
      device_name: 'Test PC',
      viewer_version: '0.1.0',
      request_nonce: 'gIGCg4SFhoeIiYqLjI2Oj5CRkpOUlZaXmJmam5ydnp8=',
    });

    // Must atomically create the sole license instead of updateMany(0)
    expect(prisma.deviceLicense.create).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({
          deviceActivationId: 'act_001',
          devicePublicKey: DEVICE_A,
          status: 'active',
        }),
      }),
    );
    expect(res.license).toBeDefined();
  });

  test('rejects Device B activation with DEVICE_BINDING_MISMATCH when entitlement is bound to Device A', async () => {
    const fakeEntitlement = {
      id: 'ent_001',
      devicePublicKey: DEVICE_A,
      status: 'active',
      maxDevices: 1,
      devicesActivated: 0,
      activations: [],
      archive: {
        technicalStatus: 'ready',
        marketplaceStatus: 'published',
      },
      payment: {
        status: 'confirmed',
        paymentIntent: { clientSecretHmac: VALID_HMAC },
      },
    };

    prisma.entitlement.findFirst.mockResolvedValue(fakeEntitlement);

    await expect(
      service.activateDevice('ent_001', VALID_AUTH_HEADER, {
        device_public_key: DEVICE_B,
        request_nonce: 'gIGCg4SFhoeIiYqLjI2Oj5CRkpOUlZaXmJmam5ydnp8=',
      }),
    ).rejects.toThrow(ConflictException);
  });

  test('rejects request nonce replay with REQUEST_NONCE_REPLAY', async () => {
    const fakeEntitlement = {
      id: 'ent_001',
      devicePublicKey: DEVICE_A,
      status: 'active',
      maxDevices: 1,
      devicesActivated: 0,
      activations: [],
      archive: {
        technicalStatus: 'ready',
        marketplaceStatus: 'published',
      },
      payment: {
        status: 'confirmed',
        paymentIntent: { clientSecretHmac: VALID_HMAC },
      },
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
