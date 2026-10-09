import { Test, TestingModule } from '@nestjs/testing';
import {
  ConflictException,
  ForbiddenException,
  UnauthorizedException,
} from '@nestjs/common';
import { LicensingService } from './licensing.service';
import { PrismaService } from '@/common/prisma.service';
import { EnvService } from '@/config/env.service';
import {
  hashDeviceRefreshToken,
  hashIntentClientSecret,
  verifyDeviceRefreshToken,
} from '@/crypto/token32.util';
import { AckCustodyService } from '@/modules/uploads/ack-custody.service';
import * as nacl from 'tweetnacl';
import * as hpkeUtil from '@/crypto/hpke.util';
import * as ed25519Util from '@/crypto/ed25519.util';

describe('LicensingService & Device Enforcement', () => {
  let service: LicensingService;
  let prisma: any;
  let ackCustody: { seal: jest.Mock; unseal: jest.Mock };

  const DEVICE_A = 'aTZYJUYw9zrY2nj7Mxv5ds1C+Q4OnJ6D9AxRBypvdBc=';
  const DEVICE_B = Buffer.alloc(32, 2).toString('base64');
  const PEPPER = 'test-hmac-secret-pepper-minimum-32';
  const VALID_SECRET = 'AAECAwQFBgcICQoLDA0ODxAREhMUFRYXGBkaGxwdHh8';
  const VALID_HMAC = hashIntentClientSecret(VALID_SECRET, PEPPER);
  const VALID_AUTH_HEADER = `SolArchIntent ${VALID_SECRET}`;
  const BUYER_WALLET = 'BuyerWallet1111111111111111111111111111111';
  const ARCHIVE_FINGERPRINT = '57ce84068fdd9b23f8860afa27834151f4fefb038d812c2ac77e8a861b1eecdb';

  const authorityPayment = {
    status: 'confirmed',
    archiveId: 'arc_001',
    buyerWallet: BUYER_WALLET,
    devicePublicKey: DEVICE_A,
    paymentIntent: {
      id: 'pi_001',
      archiveId: 'arc_001',
      archiveFingerprint: ARCHIVE_FINGERPRINT,
      devicePublicKey: DEVICE_A,
      confirmedBuyerWallet: BUYER_WALLET,
      clientSecretHmac: VALID_HMAC,
    },
  };

  beforeEach(async () => {
    const seed = new Uint8Array(32);
    for (let i = 0; i < 32; i++) seed[i] = 0x40 + i;
    const testSigningKeys = nacl.sign.keyPair.fromSeed(seed);

    prisma = {
      paymentIntent: {
        findUnique: jest.fn(),
      },
      entitlement: {
        findFirst: jest.fn(),
        findUnique: jest.fn().mockImplementation(() => prisma.entitlement.findFirst()),
        update: jest.fn(),
      },
      requestNonceRecord: {
        findUnique: jest.fn(),
        create: jest.fn(),
      },
      deviceActivation: {
        create: jest.fn(),
        update: jest.fn(),
      },
      deviceLicense: {
        create: jest.fn(),
        updateMany: jest.fn(),
        findUnique: jest.fn(),
        update: jest.fn(),
      },
      $queryRaw: jest.fn().mockResolvedValue([{ id: 'locked' }]),
      $transaction: jest.fn().mockImplementation((cb) => cb(prisma)),
    };
    prisma.paymentIntent.findUnique.mockImplementation(async () => {
      const entitlement = await prisma.entitlement.findFirst();
      if (!entitlement) return null;
      const payment = entitlement.payment;
      return {
        id: 'pi_001',
        devicePublicKey: entitlement.devicePublicKey,
        clientSecretHmac: payment?.paymentIntent?.clientSecretHmac || VALID_HMAC,
        payment: payment ? { ...payment, entitlement } : null,
      };
    });
    ackCustody = {
      seal: jest.fn().mockResolvedValue({ contentKeyRef: 'ack_ref_001' }),
      unseal: jest.fn().mockResolvedValue(
        Buffer.from('a0a1a2a3a4a5a6a7a8a9aaabacadaeafb0b1b2b3b4b5b6b7b8b9babbbcbdbebf', 'hex'),
      ),
    };

    const module: TestingModule = await Test.createTestingModule({
      providers: [
        LicensingService,
        { provide: PrismaService, useValue: prisma },
        {
          provide: EnvService,
          useValue: {
            currentTime: new Date('2026-09-14T15:25:51Z'),
            licenseKeyId: 'lic-test-01',
            licenseSigningKeypair: testSigningKeys,
            intentHmacSecret: PEPPER,
            deviceRefreshHmacSecret: PEPPER,
          },
        },
        {
          provide: AckCustodyService,
          useValue: ackCustody,
        },
      ],
    }).compile();

    service = module.get<LicensingService>(LicensingService);
  });

  afterEach(() => {
    jest.restoreAllMocks();
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
      service.activateDevice('pi_001', '', {
        device_public_key: DEVICE_A,
        device_name: 'Test PC',
        viewer_version: '0.1.0',
        request_nonce: 'gIGCg4SFhoeIiYqLjI2Oj5CRkpOUlZaXmJmam5ydnp8=',
      }),
    ).rejects.toThrow(UnauthorizedException);
  });

  test('successfully activates Device A with exact 72-hour window and wrapped key', async () => {
    const fakeEntitlement = {
      id: 'ent_001',
      archiveId: 'arc_001',
      buyerWallet: BUYER_WALLET,
      devicePublicKey: DEVICE_A,
      status: 'active',
      maxDevices: 1,
      devicesActivated: 0,
      expiresAt: null,
      archive: {
        technicalStatus: 'ready',
        marketplaceStatus: 'published',
        priceCurrency: 'USDC',
        platformFeeBps: 500,
        maxDevices: 1,
        archiveFingerprint: ARCHIVE_FINGERPRINT,
        contentKeyRef: 'ack_ref_001',
        allowExport: false,
        watermarkEnabled: true,
      },
      payment: authorityPayment,
      activations: [],
    };

    prisma.entitlement.findFirst.mockResolvedValue(fakeEntitlement);
    prisma.requestNonceRecord.findUnique.mockResolvedValue(null);
    prisma.deviceActivation.create.mockResolvedValue({ id: 'act_001' });
    prisma.deviceLicense.create.mockResolvedValue({ id: 'lic_001' });

    const res = await service.activateDevice('pi_001', VALID_AUTH_HEADER, {
      device_public_key: DEVICE_A,
      device_name: 'Test PC',
      viewer_version: '0.1.0',
      request_nonce: 'gIGCg4SFhoeIiYqLjI2Oj5CRkpOUlZaXmJmam5ydnp8=',
    });

    expect(prisma.paymentIntent.findUnique).toHaveBeenCalledWith({
      where: { clientSecretHmac: VALID_HMAC },
      include: { payment: { include: { entitlement: true } } },
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

  test('does not accept an Entitlement ID in the PaymentIntent activation route', async () => {
    prisma.paymentIntent.findUnique.mockResolvedValue({
      id: 'pi_001',
      devicePublicKey: DEVICE_A,
      clientSecretHmac: VALID_HMAC,
      payment: { status: 'confirmed', entitlement: { id: 'ent_001' } },
    });

    await expect(
      service.activateDevice('ent_001', VALID_AUTH_HEADER, {
        device_public_key: DEVICE_A,
        device_name: 'Test PC',
        viewer_version: '0.1.0',
        request_nonce: Buffer.alloc(32, 21).toString('base64'),
      }),
    ).rejects.toMatchObject({
      status: 401,
      response: expect.objectContaining({ code: 'INVALID_INTENT_CREDENTIAL' }),
    });
    expect(prisma.$transaction).not.toHaveBeenCalled();
  });

  test('returns PAYMENT_NOT_CONFIRMED after authenticating a pending PaymentIntent', async () => {
    prisma.paymentIntent.findUnique.mockResolvedValue({
      id: 'pi_pending',
      devicePublicKey: DEVICE_A,
      clientSecretHmac: VALID_HMAC,
      payment: null,
    });

    await expect(
      service.activateDevice('pi_pending', VALID_AUTH_HEADER, {
        device_public_key: DEVICE_A,
        device_name: 'Test PC',
        viewer_version: '0.1.0',
        request_nonce: Buffer.alloc(32, 24).toString('base64'),
      }),
    ).rejects.toMatchObject({
      status: 403,
      response: expect.objectContaining({ code: 'PAYMENT_NOT_CONFIRMED' }),
    });
    expect(prisma.paymentIntent.findUnique).toHaveBeenCalledWith(
      expect.objectContaining({ where: { clientSecretHmac: VALID_HMAC } }),
    );
    expect(prisma.$transaction).not.toHaveBeenCalled();
  });

  test.each([
    ['missing', '', 'pi_guess_a'],
    ['wrong', `SolArchIntent ${Buffer.alloc(32, 99).toString('base64url')}`, 'pi_guess_b'],
  ])('returns stable 401 for %s activation credential regardless of guessed ID', async (_case, header, pathId) => {
    prisma.paymentIntent.findUnique.mockResolvedValue(null);

    await expect(
      service.activateDevice(pathId, header, {
        device_public_key: DEVICE_A,
        device_name: 'Test PC',
        viewer_version: '0.1.0',
        request_nonce: Buffer.alloc(32, 25).toString('base64'),
      }),
    ).rejects.toMatchObject({
      status: 401,
      response: {
        code: 'INVALID_INTENT_CREDENTIAL',
        message: 'Invalid payment intent credential',
      },
    });
    expect(prisma.$transaction).not.toHaveBeenCalled();
  });

  test('fails closed when license issuance sees an archive fingerprint different from the purchase snapshot', async () => {
    const entitlement = {
      id: 'ent_001',
      archiveId: 'arc_001',
      buyerWallet: BUYER_WALLET,
      devicePublicKey: DEVICE_A,
      status: 'active',
      maxDevices: 1,
      devicesActivated: 0,
      expiresAt: null,
      archive: {
        technicalStatus: 'ready',
        marketplaceStatus: 'published',
        priceCurrency: 'USDC',
        platformFeeBps: 500,
        maxDevices: 1,
        allowExport: false,
        watermarkEnabled: true,
        archiveFingerprint: 'b'.repeat(64),
        contentKeyRef: 'ack_ref_001',
      },
      payment: authorityPayment,
      activations: [],
    };
    prisma.entitlement.findFirst.mockResolvedValue(entitlement);

    await expect(
      service.activateDevice('pi_001', VALID_AUTH_HEADER, {
        device_public_key: DEVICE_A,
        device_name: 'Test PC',
        viewer_version: '0.1.0',
        request_nonce: Buffer.alloc(32, 9).toString('base64'),
      }),
    ).rejects.toMatchObject({ status: 503 });
    expect(prisma.requestNonceRecord.create).not.toHaveBeenCalled();
    expect(prisma.deviceLicense.create).not.toHaveBeenCalled();
  });

  test('fails closed when an active DeviceActivation has no DeviceLicense', async () => {
    const fakeEntitlement = {
      id: 'ent_001',
      archiveId: 'arc_001',
      buyerWallet: BUYER_WALLET,
      devicePublicKey: DEVICE_A,
      status: 'active',
      maxDevices: 1,
      devicesActivated: 1,
      expiresAt: null,
      archive: {
        technicalStatus: 'ready',
        marketplaceStatus: 'published',
        priceCurrency: 'USDC',
        platformFeeBps: 500,
        maxDevices: 1,
        archiveFingerprint: ARCHIVE_FINGERPRINT,
        contentKeyRef: 'ack_ref_001',
        allowExport: false,
        watermarkEnabled: true,
      },
      payment: authorityPayment,
      activations: [
        {
          id: 'act_001',
          devicePublicKey: DEVICE_A,
          status: 'active',
          activatedAt: new Date(Date.now() - 60_000),
          licenses: [],
        },
      ],
    };

    prisma.entitlement.findFirst.mockResolvedValue(fakeEntitlement);
    prisma.requestNonceRecord.findUnique.mockResolvedValue(null);
    const wrapSpy = jest.spyOn(hpkeUtil, 'wrapContentKey');
    const signSpy = jest.spyOn(ed25519Util, 'signLicenseEnvelope');

    const outcome = await service
      .activateDevice('pi_001', VALID_AUTH_HEADER, {
        device_public_key: DEVICE_A,
        device_name: 'Test PC',
        viewer_version: '0.1.0',
        request_nonce: 'gIGCg4SFhoeIiYqLjI2Oj5CRkpOUlZaXmJmam5ydnp8=',
      })
      .then(
        (value) => ({ value }),
        (error: unknown) => ({ error }),
      );

    expect(outcome).toMatchObject({
      error: {
        status: 503,
        response: {
          code: 'BACKEND_UNAVAILABLE',
          message: 'License authority state is inconsistent',
        },
      },
    });
    expect(outcome).not.toHaveProperty('value');
    expect(prisma.requestNonceRecord.create).not.toHaveBeenCalled();
    expect(prisma.deviceActivation.create).not.toHaveBeenCalled();
    expect(prisma.deviceLicense.create).not.toHaveBeenCalled();
    expect(prisma.deviceLicense.update).not.toHaveBeenCalled();
    expect(ackCustody.unseal).not.toHaveBeenCalled();
    expect(wrapSpy).not.toHaveBeenCalled();
    expect(signSpy).not.toHaveBeenCalled();
  });

  test('rejects Device B activation with DEVICE_BINDING_MISMATCH when entitlement is bound to Device A', async () => {
    const fakeEntitlement = {
      id: 'ent_001',
      archiveId: 'arc_001',
      buyerWallet: BUYER_WALLET,
      devicePublicKey: DEVICE_A,
      status: 'active',
      maxDevices: 1,
      devicesActivated: 0,
      expiresAt: null,
      activations: [],
      archive: {
        technicalStatus: 'ready',
        marketplaceStatus: 'published',
        priceCurrency: 'USDC',
        platformFeeBps: 500,
        maxDevices: 1,
        allowExport: false,
        watermarkEnabled: true,
        archiveFingerprint: ARCHIVE_FINGERPRINT,
        contentKeyRef: 'ack_ref_001',
      },
      payment: authorityPayment,
    };

    prisma.entitlement.findFirst.mockResolvedValue(fakeEntitlement);

    await expect(
      service.activateDevice('pi_001', VALID_AUTH_HEADER, {
        device_public_key: DEVICE_B,
        device_name: 'Test PC',
        viewer_version: '0.1.0',
        request_nonce: 'gIGCg4SFhoeIiYqLjI2Oj5CRkpOUlZaXmJmam5ydnp8=',
      }),
    ).rejects.toThrow(ConflictException);
  });

  test('rejects request nonce replay with REQUEST_NONCE_REPLAY', async () => {
    const fakeEntitlement = {
      id: 'ent_001',
      archiveId: 'arc_001',
      buyerWallet: BUYER_WALLET,
      devicePublicKey: DEVICE_A,
      status: 'active',
      maxDevices: 1,
      devicesActivated: 0,
      expiresAt: null,
      activations: [],
      archive: {
        technicalStatus: 'ready',
        marketplaceStatus: 'published',
        priceCurrency: 'USDC',
        platformFeeBps: 500,
        maxDevices: 1,
        allowExport: false,
        watermarkEnabled: true,
        archiveFingerprint: ARCHIVE_FINGERPRINT,
        contentKeyRef: 'ack_ref_001',
      },
      payment: authorityPayment,
    };

    prisma.entitlement.findFirst.mockResolvedValue(fakeEntitlement);
    // Nonce already exists
    prisma.requestNonceRecord.findUnique.mockResolvedValue({ id: 'nonce_rec_001' });

    await expect(
      service.activateDevice('pi_001', VALID_AUTH_HEADER, {
        device_public_key: DEVICE_A,
        device_name: 'Test PC',
        viewer_version: '0.1.0',
        request_nonce: 'gIGCg4SFhoeIiYqLjI2Oj5CRkpOUlZaXmJmam5ydnp8=',
      }),
    ).rejects.toThrow(ConflictException);
  });

  test('maps malformed request_nonce to 400 INVALID_REQUEST before issuance side effects', async () => {
    await expect(
      service.activateDevice('pi_001', VALID_AUTH_HEADER, {
        device_public_key: DEVICE_A,
        device_name: 'Test PC',
        viewer_version: '0.1.0',
        request_nonce: 'not-canonical-base64',
      }),
    ).rejects.toMatchObject({
      status: 400,
      response: expect.objectContaining({ code: 'INVALID_REQUEST' }),
    });
    expect(prisma.entitlement.findFirst).not.toHaveBeenCalled();
  });

  test.each([
    'not-base64',
    Buffer.alloc(32).toString('base64'),
    Buffer.from([0xed, ...Array(30).fill(0xff), 0x7f]).toString('base64'),
  ])('maps malformed/noncanonical/low-order activation device keys to 400', async (deviceKey) => {
    await expect(
      service.activateDevice('pi_001', VALID_AUTH_HEADER, {
        device_public_key: deviceKey,
        device_name: 'Test PC',
        viewer_version: '0.1.0',
        request_nonce: Buffer.alloc(32, 22).toString('base64'),
      }),
    ).rejects.toMatchObject({
      status: 400,
      response: expect.objectContaining({ code: 'INVALID_REQUEST' }),
    });
    expect(prisma.entitlement.findFirst).not.toHaveBeenCalled();
  });

  test.each([
    'not-base64',
    Buffer.alloc(32).toString('base64'),
    Buffer.from([0xed, ...Array(30).fill(0xff), 0x7f]).toString('base64'),
  ])('maps malformed/noncanonical/low-order refresh device keys to 400', async (deviceKey) => {
    await expect(
      service.refreshLicense('lic_001', `DeviceRefresh ${VALID_SECRET}`, {
        archive_id: 'arc_001',
        device_public_key: deviceKey,
        request_nonce: Buffer.alloc(32, 23).toString('base64'),
      }),
    ).rejects.toMatchObject({
      status: 400,
      response: expect.objectContaining({ code: 'INVALID_REQUEST' }),
    });
    expect(prisma.deviceLicense.findUnique).not.toHaveBeenCalled();
  });

  test.each([
    { device_name: '', viewer_version: '0.1.0' },
    { device_name: 'bad\u0000name', viewer_version: '0.1.0' },
    { device_name: 'ж'.repeat(65), viewer_version: '0.1.0' },
    { device_name: 'Windows PC', viewer_version: 'v0.1' },
  ])('rejects invalid activation presentation fields before issuance', async (fields) => {
    await expect(
      service.activateDevice('pi_001', VALID_AUTH_HEADER, {
        device_public_key: DEVICE_A,
        device_name: fields.device_name,
        viewer_version: fields.viewer_version,
        request_nonce: 'gIGCg4SFhoeIiYqLjI2Oj5CRkpOUlZaXmJmam5ydnp8=',
      }),
    ).rejects.toMatchObject({ status: 400 });
    expect(prisma.entitlement.findFirst).not.toHaveBeenCalled();
  });

  test('denies activation recovery when the existing Device License is revoked', async () => {
    const revokedLicense = {
      id: 'lic_revoked',
      entitlementId: 'ent_001',
      deviceActivationId: 'act_001',
      archiveId: 'arc_001',
      devicePublicKey: DEVICE_A,
      status: 'revoked',
    };
    prisma.entitlement.findFirst.mockResolvedValue({
      id: 'ent_001',
      archiveId: 'arc_001',
      buyerWallet: BUYER_WALLET,
      devicePublicKey: DEVICE_A,
      status: 'active',
      maxDevices: 1,
      devicesActivated: 1,
      expiresAt: null,
      archive: {
        technicalStatus: 'ready',
        marketplaceStatus: 'published',
        priceCurrency: 'USDC',
        platformFeeBps: 500,
        maxDevices: 1,
        allowExport: false,
        watermarkEnabled: true,
        archiveFingerprint: ARCHIVE_FINGERPRINT,
        contentKeyRef: 'ack_ref_001',
      },
      payment: authorityPayment,
      activations: [
        {
          id: 'act_001',
          devicePublicKey: DEVICE_A,
          status: 'active',
          activatedAt: new Date(Date.now() - 60_000),
          licenses: [revokedLicense],
        },
      ],
    });

    await expect(
      service.activateDevice('pi_001', VALID_AUTH_HEADER, {
        device_public_key: DEVICE_A,
        device_name: 'Test PC',
        viewer_version: '0.1.0',
        request_nonce: 'gIGCg4SFhoeIiYqLjI2Oj5CRkpOUlZaXmJmam5ydnp8=',
      }),
    ).rejects.toThrow(ForbiddenException);
    expect(prisma.deviceLicense.update).not.toHaveBeenCalled();
  });

  test('serializes concurrent recovery so only the latest returned refresh token remains usable', async () => {
    const activeLicense = {
      id: 'lic_001',
      entitlementId: 'ent_001',
      deviceActivationId: 'act_001',
      archiveId: 'arc_001',
      devicePublicKey: DEVICE_A,
      status: 'active',
      refreshTokenHmac: '',
    };
    const entitlement = {
      id: 'ent_001',
      archiveId: 'arc_001',
      buyerWallet: BUYER_WALLET,
      devicePublicKey: DEVICE_A,
      status: 'active',
      maxDevices: 1,
      devicesActivated: 1,
      expiresAt: null,
      archive: {
        technicalStatus: 'ready',
        marketplaceStatus: 'published',
        priceCurrency: 'USDC',
        platformFeeBps: 500,
        maxDevices: 1,
        allowExport: false,
        watermarkEnabled: true,
        archiveFingerprint: ARCHIVE_FINGERPRINT,
        contentKeyRef: 'ack_ref_001',
      },
      payment: authorityPayment,
      activations: [
        {
          id: 'act_001',
          devicePublicKey: DEVICE_A,
          status: 'active',
          activatedAt: new Date(Date.now() - 60_000),
          licenses: [activeLicense],
        },
      ],
    };
    prisma.entitlement.findFirst.mockResolvedValue(entitlement);
    prisma.deviceLicense.update.mockImplementation(({ data }) => {
      activeLicense.refreshTokenHmac = data.refreshTokenHmac;
      return activeLicense;
    });
    let transactionTail = Promise.resolve();
    prisma.$transaction.mockImplementation((callback) => {
      const result = transactionTail.then(() => callback(prisma));
      transactionTail = result.then(
        () => undefined,
        () => undefined,
      );
      return result;
    });

    const [first, second] = await Promise.all([
      service.activateDevice('pi_001', VALID_AUTH_HEADER, {
        device_public_key: DEVICE_A,
        device_name: 'Test PC',
        viewer_version: '0.1.0',
        request_nonce: Buffer.alloc(32, 3).toString('base64'),
      }),
      service.activateDevice('pi_001', VALID_AUTH_HEADER, {
        device_public_key: DEVICE_A,
        device_name: 'Test PC',
        viewer_version: '0.1.0',
        request_nonce: Buffer.alloc(32, 4).toString('base64'),
      }),
    ]);

    expect(first.device_refresh_token).not.toBe(second.device_refresh_token);
    expect(
      verifyDeviceRefreshToken(first.device_refresh_token, activeLicense.refreshTokenHmac, PEPPER),
    ).toBe(false);
    expect(
      verifyDeviceRefreshToken(second.device_refresh_token, activeLicense.refreshTokenHmac, PEPPER),
    ).toBe(true);
    expect(prisma.$queryRaw).toHaveBeenCalledTimes(2);
  });

  test('uses the keyed refresh HMAC lookup and rejects a wrong token independently of path ID', async () => {
    const wrongToken = Buffer.alloc(32, 77).toString('base64url');
    const wrongHmac = hashDeviceRefreshToken(wrongToken, PEPPER);
    prisma.deviceLicense.findUnique.mockResolvedValue(null);

    await expect(
      service.refreshLicense('lic_guessed', `DeviceRefresh ${wrongToken}`, {
        archive_id: 'arc_001',
        device_public_key: DEVICE_A,
        request_nonce: Buffer.alloc(32, 26).toString('base64'),
      }),
    ).rejects.toMatchObject({
      status: 401,
      response: {
        code: 'INVALID_REFRESH_CREDENTIAL',
        message: 'Invalid device refresh credential',
      },
    });
    expect(prisma.deviceLicense.findUnique).toHaveBeenCalledWith({
      where: { refreshTokenHmac: wrongHmac },
    });
    expect(prisma.$transaction).not.toHaveBeenCalled();
  });

  test('rejects a valid refresh credential bound to a different path license ID', async () => {
    const refreshHmac = hashDeviceRefreshToken(VALID_SECRET, PEPPER);
    prisma.deviceLicense.findUnique.mockResolvedValue({
      id: 'lic_authoritative',
      refreshTokenHmac: refreshHmac,
    });

    await expect(
      service.refreshLicense('lic_guessed', `DeviceRefresh ${VALID_SECRET}`, {
        archive_id: 'arc_001',
        device_public_key: DEVICE_A,
        request_nonce: Buffer.alloc(32, 27).toString('base64'),
      }),
    ).rejects.toMatchObject({
      status: 401,
      response: expect.objectContaining({ code: 'INVALID_REFRESH_CREDENTIAL' }),
    });
    expect(prisma.deviceLicense.findUnique).toHaveBeenCalledWith({
      where: { refreshTokenHmac: refreshHmac },
    });
    expect(prisma.$transaction).not.toHaveBeenCalled();
  });

  test('denies refresh when the bound DeviceActivation is inactive', async () => {
    const refreshToken = VALID_SECRET;
    const license = {
      id: 'lic_001',
      entitlementId: 'ent_001',
      deviceActivationId: 'act_001',
      archiveId: 'arc_001',
      devicePublicKey: DEVICE_A,
      status: 'active',
      refreshTokenHmac: hashDeviceRefreshToken(refreshToken, PEPPER),
      deviceActivation: {
        id: 'act_001',
        entitlementId: 'ent_001',
        devicePublicKey: DEVICE_A,
        status: 'inactive',
      },
      entitlement: {
        id: 'ent_001',
        devicePublicKey: DEVICE_A,
        status: 'active',
        maxDevices: 1,
        expiresAt: null,
        payment: authorityPayment,
        archive: {
          maxDevices: 1,
          technicalStatus: 'ready',
          marketplaceStatus: 'published',
          priceCurrency: 'USDC',
          platformFeeBps: 500,
          allowExport: false,
          watermarkEnabled: true,
          archiveFingerprint: ARCHIVE_FINGERPRINT,
          contentKeyRef: 'ack_ref_001',
        },
      },
    };
    prisma.deviceLicense.findUnique.mockResolvedValue(license);

    await expect(
      service.refreshLicense('lic_001', `DeviceRefresh ${refreshToken}`, {
        archive_id: 'arc_001',
        device_public_key: DEVICE_A,
        request_nonce: 'gIGCg4SFhoeIiYqLjI2Oj5CRkpOUlZaXmJmam5ydnp8=',
      }),
    ).rejects.toThrow(ConflictException);
    expect(prisma.requestNonceRecord.create).not.toHaveBeenCalled();
  });
});
