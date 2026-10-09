import { Test, TestingModule } from '@nestjs/testing';
import { INestApplication, ValidationPipe } from '@nestjs/common';
const request = require('supertest');
import { AppModule } from '@/app.module';
import { PrismaService } from '@/common/prisma.service';
import { EnvService } from '@/config/env.service';
import { SolArchExceptionFilter } from '@/common/filters/http-exception.filter';
import { PaymentsService } from '@/modules/payments/payments.service';
import { AckCustodyService } from '@/modules/uploads/ack-custody.service';
import { configureRequestBodyParsers } from '@/common/viewer-request-limits';
import { Keypair, PublicKey } from '@solana/web3.js';
import { createHash } from 'crypto';
import * as nacl from 'tweetnacl';

const VALID_TOKEN32 = 'AAECAwQFBgcICQoLDA0ODxAREhMUFRYXGBkaGxwdHh8';
const VALID_TRANSACTION_SIGNATURE =
  '5VERv8NMvzbJMEkV8xnrLkEaWRtSz9CosKDYjCJjBRnbJLgp8uirBgmQpjKhoR4tjF3ZpRzrFmBV6UjKdiSZkQUc';
const mockE2eMessageBytes = Buffer.from('e2e_mock_tx_message_bytes_valid');
const mockE2eMessageHash = createHash('sha256').update(mockE2eMessageBytes).digest('hex').toLowerCase();

describe('SolArch Marketplace Backend API (e2e)', () => {
  let app: INestApplication;

  const mockUser = {
    id: 'usr_e2e_001',
    status: 'active',
    wallets: [
      {
        id: 'wal_001',
        userId: 'usr_e2e_001',
        chain: 'solana',
        address: 'CreatorSolanaWallet1111111111111111111111111',
        verifiedAt: new Date(),
      },
    ],
  };

  const DEVICE_A = 'aTZYJUYw9zrY2nj7Mxv5ds1C+Q4OnJ6D9AxRBypvdBc=';
  const DEVICE_B = Buffer.alloc(32, 7).toString('base64');

  const validCreatorAta = Keypair.generate().publicKey.toBase58();
  const validPlatformAta = Keypair.generate().publicKey.toBase58();
  const validReference = Keypair.generate().publicKey.toBase58();
  const validBuyerWallet = Keypair.generate().publicKey.toBase58();

  const mockArchive = {
    id: 'arc_e2e_001',
    creatorUserId: 'usr_e2e_001',
    title: 'SolArch Masterclass',
    shortDescription: 'Master protected archives',
    description: 'Full course on SolArch and Solana Pay',
    technicalStatus: 'ready',
    marketplaceStatus: 'published',
    creatorPayoutWallet: 'CreatorSolanaWallet1111111111111111111111111',
    creatorUsdcAta: validCreatorAta,
    priceCurrency: 'USDC',
    priceAmount: '10.00',
    platformFeeBps: 500,
    maxDevices: 1,
    allowExport: false,
    watermarkEnabled: true,
    archiveFingerprint: '57ce84068fdd9b23f8860afa27834151f4fefb038d812c2ac77e8a861b1eecdb',
    contentKeyRef: 'a0a1a2a3a4a5a6a7a8a9aaabacadaeafb0b1b2b3b4b5b6b7b8b9babbbcbdbebf',
    listing: {
      id: 'lst_001',
      slug: 'solarch-masterclass',
      title: 'SolArch Masterclass',
      marketplaceStatus: 'published',
    },
    publicFiles: [
      {
        id: 'fil_001',
        displayPath: 'lesson-01.pdf',
        displayName: 'lesson-01.pdf',
        fileExtension: 'pdf',
        mimeType: 'application/pdf',
        sizeBytes: BigInt(1024),
        sortOrder: 0,
        isPubliclyListed: true,
      },
    ],
    creator: mockUser,
    events: [],
    payments: [],
  };

  const mockPrisma = {
    $queryRaw: jest.fn().mockResolvedValue([{ '1': 1 }]),
    user: {
      findUnique: jest.fn().mockResolvedValue(mockUser),
      create: jest.fn().mockResolvedValue(mockUser),
    },
    wallet: {
      findUnique: jest.fn().mockResolvedValue({
        id: 'wal_001',
        userId: mockUser.id,
        address: mockUser.wallets[0].address,
        user: mockUser,
      }),
      update: jest.fn().mockResolvedValue({}),
    },
    archive: {
      findUnique: jest.fn().mockResolvedValue(mockArchive),
      findMany: jest.fn().mockResolvedValue([mockArchive]),
      count: jest.fn().mockResolvedValue(1),
      create: jest.fn().mockResolvedValue(mockArchive),
      update: jest.fn().mockImplementation(({ data }) => ({
        ...mockArchive,
        ...data,
        listing: {
          ...mockArchive.listing,
          ...(data.listing?.update || {}),
        },
      })),
    },
    archiveListing: {
      findUnique: jest.fn().mockResolvedValue({
        ...mockArchive.listing,
        archive: mockArchive,
      }),
    },
    paymentIntent: {
      create: jest.fn().mockImplementation(({ data }) => ({
        id: 'pi_e2e_001',
        ...data,
      })),
      findUnique: jest.fn().mockImplementation(() => ({
        id: 'pi_e2e_001',
        archiveId: 'arc_e2e_001',
        archiveFingerprint: mockArchive.archiveFingerprint,
        devicePublicKey: DEVICE_A,
        confirmedBuyerWallet: null,
        clientSecretHmac: require('@/crypto/token32.util').hashIntentClientSecret(
          VALID_TOKEN32,
          'solarch-intent-hmac-secret-32-chars-minimum',
        ),
        expectedPriceAmount: '10.00',
        currency: 'USDC',
        creatorWallet: mockArchive.creatorPayoutWallet,
        creatorAta: mockArchive.creatorUsdcAta,
        creatorShareAmount: '9.50',
        platformWallet: 'ADebM4PZk4xN3sUvW7n1o88h5Zqg7kR9m1vYt2zE5q11',
        platformAta: validPlatformAta,
        platformShareAmount: '0.50',
        reference: validReference,
        status: 'created',
        expiresAt: new Date(Date.now() + 1800 * 1000),
        archive: mockArchive,
      })),
      update: jest.fn().mockResolvedValue({}),
    },
    payment: {
      findUnique: jest.fn().mockResolvedValue(null),
      create: jest.fn().mockResolvedValue({ id: 'pay_e2e_001' }),
      findMany: jest.fn().mockResolvedValue([]),
    },
    entitlement: {
      findFirst: jest.fn().mockResolvedValue({
        id: 'ent_e2e_001',
        archiveId: 'arc_e2e_001',
        buyerWallet: 'Buyer111111111111111111111111111111111111',
        devicePublicKey: DEVICE_A,
        maxDevices: 1,
        devicesActivated: 0,
        status: 'active',
        expiresAt: null,
        archive: mockArchive,
        activations: [],
        payment: {
          status: 'confirmed',
          archiveId: 'arc_e2e_001',
          buyerWallet: 'Buyer111111111111111111111111111111111111',
          devicePublicKey: DEVICE_A,
          paymentIntent: {
            id: 'pi_e2e_001',
            archiveId: 'arc_e2e_001',
            archiveFingerprint: mockArchive.archiveFingerprint,
            devicePublicKey: DEVICE_A,
            confirmedBuyerWallet: 'Buyer111111111111111111111111111111111111',
            clientSecretHmac: require('@/crypto/token32.util').hashIntentClientSecret(
              VALID_TOKEN32,
              'solarch-intent-hmac-secret-32-chars-minimum',
            ),
          },
        },
      }),
      findUnique: jest.fn().mockImplementation(() => mockPrisma.entitlement.findFirst()),
      create: jest.fn().mockResolvedValue({ id: 'ent_e2e_001' }),
      update: jest.fn().mockResolvedValue({}),
    },
    deviceActivation: {
      create: jest.fn().mockResolvedValue({ id: 'act_e2e_001' }),
      update: jest.fn().mockResolvedValue({}),
    },
    deviceLicense: {
      create: jest.fn().mockResolvedValue({ id: 'lic_e2e_001' }),
      updateMany: jest.fn().mockResolvedValue({ count: 1 }),
      findUnique: jest.fn().mockResolvedValue({
        id: 'lic_e2e_001',
        archiveId: 'arc_e2e_001',
        devicePublicKey: DEVICE_A,
        status: 'active',
        rightsJson: { open: true, max_devices: 1 },
      }),
    },
    requestNonceRecord: {
      findUnique: jest.fn().mockResolvedValue(null),
      create: jest.fn().mockResolvedValue({}),
    },
    paymentTransactionIssuance: {
      findFirst: jest.fn().mockImplementation(({ where }) =>
        where.expectedTransactionSignature === VALID_TRANSACTION_SIGNATURE
          ? {
            id: 'iss_e2e_001',
            paymentIntentId: 'pi_e2e_001',
            constructionAccount: validBuyerWallet,
            expectedTransactionSignature: VALID_TRANSACTION_SIGNATURE,
            transactionMessageHash: mockE2eMessageHash,
            lastValidBlockHeight: BigInt(999999),
            status: 'active',
          }
          : null,
      ),
      findMany: jest.fn().mockResolvedValue([]),
      create: jest.fn().mockResolvedValue({}),
      update: jest.fn().mockResolvedValue({}),
      updateMany: jest.fn().mockResolvedValue({ count: 1 }),
    },
    marketplaceEvent: {
      create: jest.fn().mockResolvedValue({}),
      findFirst: jest.fn().mockResolvedValue(null),
      findMany: jest.fn().mockResolvedValue([
        { eventType: 'archive_view' },
        { eventType: 'archive_download' },
      ]),
    },
    $transaction: jest.fn((cb) => cb(mockPrisma)),
  };

  let creatorJwt: string;

  beforeAll(async () => {
    const moduleFixture: TestingModule = await Test.createTestingModule({
      imports: [AppModule],
    })
      .overrideProvider(PrismaService)
      .useValue(mockPrisma)
      .overrideProvider(AckCustodyService)
      .useValue({
        seal: jest.fn().mockResolvedValue({ contentKeyRef: 'ack_ref_e2e' }),
        unseal: jest.fn().mockResolvedValue(
          Buffer.from('a0a1a2a3a4a5a6a7a8a9aaabacadaeafb0b1b2b3b4b5b6b7b8b9babbbcbdbebf', 'hex'),
        ),
      })
      .compile();

    // Keep mock payment credentials independent of the local live .env.
    jest
      .spyOn(moduleFixture.get(EnvService), 'intentHmacSecret', 'get')
      .mockReturnValue('solarch-intent-hmac-secret-32-chars-minimum');

    app = moduleFixture.createNestApplication({ bodyParser: false });
    configureRequestBodyParsers(app);
    app.useGlobalPipes(
      new ValidationPipe({
        whitelist: true,
        transform: true,
        forbidNonWhitelisted: true,
      }),
    );
    app.useGlobalFilters(new SolArchExceptionFilter());

    const paymentsService = app.get(PaymentsService);
    const e2eFeePayer = app.get(EnvService).feePayerKeypair.publicKey;
    jest.spyOn(paymentsService, 'getConnection').mockReturnValue({
      getLatestBlockhash: jest.fn().mockResolvedValue({
        blockhash: 'EkSnNWid2cvwEVnVx9aBqawnmiCNiDcg3iAZ2tFhGuqd',
        lastValidBlockHeight: 123456,
      }),
      getSignatureStatuses: jest.fn().mockResolvedValue({
        value: [{ confirmationStatus: 'finalized', err: null, slot: 100 }],
      }),
      getBlockHeight: jest.fn().mockResolvedValue(100),
      getParsedTransaction: jest.fn().mockResolvedValue({
        slot: 100,
        blockTime: 123456,
        meta: { err: null },
        transaction: {
          message: {
            accountKeys: [
              { pubkey: { toBase58: () => validReference }, signer: false },
              { pubkey: e2eFeePayer, signer: true },
              { pubkey: { toBase58: () => validBuyerWallet }, signer: true },
            ],
            instructions: [
              {
                parsed: {
                  type: 'transferChecked',
                  info: {
                    destination: validCreatorAta,
                    amount: '9500000',
                    mint: '4zMMC9srt5Ri5X14GAgXhaHii3GnPAEERYPJgZJDncDU',
                  },
                },
              },
              {
                parsed: {
                  type: 'transferChecked',
                  info: {
                    destination: validPlatformAta,
                    amount: '500000',
                    mint: '4zMMC9srt5Ri5X14GAgXhaHii3GnPAEERYPJgZJDncDU',
                  },
                },
              },
            ],
          },
        },
      }),
      getTransaction: jest.fn().mockResolvedValue({
        slot: 100,
        transaction: {
          message: {
            serialize: () => mockE2eMessageBytes,
          },
        },
      }),
      getBlock: jest.fn().mockResolvedValue({ blockHeight: 100 }),
    } as any);

    await app.init();
  });

  afterAll(async () => {
    await app.close();
  });

  describe('Health API', () => {
    it('/v1/health (GET) should return ok', async () => {
      const res = await request(app.getHttpServer()).get('/v1/health').expect(200);
      expect(res.body.status).toBe('ok');
      expect(res.body.service).toBe('solarch-api');
    });

    it('/v1/health/ready (GET) should report dependency readiness', async () => {
      const res = await request(app.getHttpServer()).get('/v1/health/ready').expect(200);
      expect(res.body.status).toBeDefined();
      expect(res.body.dependencies).toBeDefined();
    });
  });

  describe('Auth API Flow', () => {
    let challengeId: string;
    let challengeMessage: string;
    const keyPair = nacl.sign.keyPair();
    const walletPubKey = new PublicKey(keyPair.publicKey).toBase58();

    it('/v1/auth/wallet/challenge (POST) generates sign challenge', async () => {
      const res = await request(app.getHttpServer())
        .post('/v1/auth/wallet/challenge')
        .send({ wallet: walletPubKey })
        .expect(200);

      expect(res.body.challenge_id).toBeDefined();
      expect(res.body.message).toContain(walletPubKey);
      challengeId = res.body.challenge_id;
      challengeMessage = res.body.message;
    });

    it('/v1/auth/wallet/verify (POST) verifies signature and issues JWT', async () => {
      const msgBytes = Buffer.from(challengeMessage, 'utf8');
      const sig = nacl.sign.detached(msgBytes, keyPair.secretKey);
      const sigBase64 = Buffer.from(sig).toString('base64');

      const res = await request(app.getHttpServer())
        .post('/v1/auth/wallet/verify')
        .send({
          challenge_id: challengeId,
          wallet: walletPubKey,
          signature: sigBase64,
        })
        .expect(200);

      expect(res.body.authenticated).toBe(true);
      expect(res.body.access_token).toBeDefined();
      expect(res.body.user).toBeDefined();
      creatorJwt = res.body.access_token;
    });

    it('/v1/me (GET) returns authenticated creator profile', async () => {
      const res = await request(app.getHttpServer())
        .get('/v1/me')
        .set('Authorization', `Bearer ${creatorJwt}`)
        .expect(200);

      expect(res.body.id).toBeDefined();
      expect(res.body.wallet).toBeDefined();
    });
  });

  describe('Creator Archives & Economics', () => {
    it('/v1/archives/:id/cover (POST) requires creator authentication', async () => {
      const res = await request(app.getHttpServer())
        .post('/v1/archives/arc_e2e_001/cover')
        .attach('file', Buffer.from([0x89, 0x50, 0x4e, 0x47]), {
          filename: 'cover.png',
          contentType: 'image/png',
        })
        .expect(401);

      expect(res.body.code).toBe('UNAUTHORIZED');
    });

    it('/v1/archives/:id/cover (POST) bounds multipart bytes before decoding', async () => {
      const res = await request(app.getHttpServer())
        .post('/v1/archives/arc_e2e_001/cover')
        .set('Authorization', `Bearer ${creatorJwt}`)
        .attach('file', Buffer.alloc(5 * 1024 * 1024 + 1), {
          filename: 'cover.png',
          contentType: 'image/png',
        })
        .expect(413);

      expect(res.body.code).toBe('COVER_TOO_LARGE');
    });

    it('/v1/archives (POST) creates archive with frozen 95/5 USDC economics', async () => {
      const res = await request(app.getHttpServer())
        .post('/v1/archives')
        .set('Authorization', `Bearer ${creatorJwt}`)
        .send({
          title: 'SolArch Masterclass',
          short_description: 'Master protected archives',
          price: { currency: 'USDC', amount: '10.00' },
          creator_payout_wallet: Keypair.generate().publicKey.toBase58(),
          license_policy: { max_devices: 1, allow_export: false, watermark_enabled: true },
        })
        .expect(201);

      expect(res.body.archive_id).toBeDefined();
      expect(res.body.price.amount).toBe('10.00');
      expect(res.body.price.currency).toBe('USDC');
      expect(res.body.economics.platform_fee_bps).toBe(500);
      expect(res.body.economics.creator_share).toBe('9.50');
      expect(res.body.economics.platform_share).toBe('0.50');
      expect(res.body.economics.network_fees_paid_by).toBe('solarch');
    });

    it('/v1/archives (POST) rejects non-USDC currency', async () => {
      await request(app.getHttpServer())
        .post('/v1/archives')
        .set('Authorization', `Bearer ${creatorJwt}`)
        .send({
          title: 'SOL Archive',
          price: { currency: 'SOL', amount: '1.00' },
          creator_payout_wallet: Keypair.generate().publicKey.toBase58(),
        })
        .expect(400);
    });

    it('/v1/archives (GET) returns creator archives list (My Archives)', async () => {
      const res = await request(app.getHttpServer())
        .get('/v1/archives')
        .set('Authorization', `Bearer ${creatorJwt}`)
        .expect(200);

      expect(Array.isArray(res.body)).toBe(true);
      expect(res.body[0].archive_id).toBe('arc_e2e_001');
      expect(res.body[0].file_count).toBeDefined();
      expect(res.body[0].metrics).toBeDefined();
      expect(res.body[0].license_policy).toBeDefined();
    });

    it('/v1/archives/:id/files (GET) returns unpacked files list for creator', async () => {
      const res = await request(app.getHttpServer())
        .get('/v1/archives/arc_e2e_001/files')
        .set('Authorization', `Bearer ${creatorJwt}`)
        .expect(200);

      expect(res.body.files).toBeDefined();
      expect(Array.isArray(res.body.files)).toBe(true);
      expect(res.body.files[0].display_name).toBe('lesson-01.pdf');
    });

    it('/v1/archives/:id/block (POST) blocks archive listing (moderation hook)', async () => {
      const res = await request(app.getHttpServer())
        .post('/v1/archives/arc_e2e_001/block')
        .set('Authorization', `Bearer ${creatorJwt}`)
        .expect(201);

      expect(res.body.marketplace_status).toBe('blocked');
    });
  });

  describe('Public Marketplace API', () => {
    it('/v1/marketplace/archives (GET) returns public published catalog with flat & pagination fields', async () => {
      const res = await request(app.getHttpServer())
        .get('/v1/marketplace/archives')
        .expect(200);

      expect(res.body.items).toBeDefined();
      expect(Array.isArray(res.body.items)).toBe(true);
      expect(res.body.page).toBe(1);
      expect(res.body.per_page).toBeDefined();
      expect(res.body.total).toBeDefined();
      expect(res.body.has_more).toBeDefined();
      expect(res.body.pagination).toBeDefined();
    });

    it('/v1/marketplace/archives/:slug (GET) returns public archive detail with aliases', async () => {
      const res = await request(app.getHttpServer())
        .get('/v1/marketplace/archives/solarch-masterclass')
        .expect(200);

      expect(res.body.title).toBe('SolArch Masterclass');
      expect(res.body.access_rules).toBeDefined();
      expect(res.body.license_policy).toBeDefined();
      expect(res.body.download_available).toBeDefined();
      expect(res.body.marketplace_status).toBeDefined();
      expect(res.body.metrics).toBeDefined();
    });

    it('/v1/viewer/archives/:id (GET) returns authoritative pre-payment metadata', async () => {
      const res = await request(app.getHttpServer())
        .get('/v1/viewer/archives/arc_e2e_001')
        .expect(200);

      expect(res.body.archive_id).toBe('arc_e2e_001');
      expect(res.body.price.amount).toBe('10.00');
      expect(res.body.license_policy.max_devices).toBe(1);
    });
  });

  describe('Solana Pay & Licensing Lifecycle', () => {
    const clientSecret = VALID_TOKEN32;
    const authHeader = `SolArchIntent ${clientSecret}`;

    it('/v1/payment-intents (POST) binds Device A and returns TOKEN32 secret', async () => {
      const res = await request(app.getHttpServer())
        .post('/v1/payment-intents')
        .send({
          archive_id: 'arc_e2e_001',
          device_public_key: DEVICE_A,
        })
        .expect(201);

      expect(res.body.payment_intent_id).toBeDefined();
      expect(res.body.payment_intent_client_secret).toBeDefined();
      expect(res.body.payment_intent_client_secret.length).toBe(43);
      expect(res.body.solana_pay_url).toContain('solana:');
    });

    it('rejects Viewer payment bodies above the frozen 4096-byte transport cap', async () => {
      const res = await request(app.getHttpServer())
        .post('/v1/payment-intents')
        .set('Content-Type', 'application/json')
        .send(
          JSON.stringify({
            archive_id: 'arc_e2e_001',
            device_public_key: DEVICE_A,
            padding: 'x'.repeat(4_096),
          }),
        )
        .expect(400);

      expect(res.body.code).toBe('INVALID_REQUEST');
    });

    it('rejects Viewer activation/refresh JSON deeper than the frozen depth cap', async () => {
      let nested: Record<string, unknown> = {};
      for (let index = 0; index < 9; index += 1) nested = { nested };

      for (const endpoint of [
        '/v1/payment-intents/pi_e2e_001/activate-device',
        '/v1/device-licenses/lic_e2e_001/refresh',
      ]) {
        const res = await request(app.getHttpServer())
          .post(endpoint)
          .set('Content-Type', 'application/json')
          .send(JSON.stringify(nested))
          .expect(400);
        expect(res.body.code).toBe('INVALID_REQUEST');
      }
    });

    it('/assets/solarch-pay-icon.svg (GET) serves the metadata icon', async () => {
      const res = await request(app.getHttpServer())
        .get('/assets/solarch-pay-icon.svg')
        .expect(200)
        .expect('Content-Type', /image\/svg\+xml/);
      expect(Buffer.from(res.body).toString('utf8')).toContain('<svg');
    });

    it('/v1/solana-pay/payment-intents/:id/transaction (POST) builds transaction request', async () => {
      const buyerPubKey = Keypair.generate().publicKey.toBase58();
      const res = await request(app.getHttpServer())
        .post('/v1/solana-pay/payment-intents/pi_e2e_001/transaction')
        .send({ account: buyerPubKey })
        .expect(200);

      expect(res.body.transaction).toBeDefined();
      expect(res.body.message).toContain('10.00 USDC');

      const forwardCompatible = await request(app.getHttpServer())
        .post('/v1/solana-pay/payment-intents/pi_e2e_001/transaction')
        .send({ account: buyerPubKey, future_field: 'ignored' })
        .expect(200);
      expect(forwardCompatible.body.transaction).toBe(res.body.transaction);
      expect(forwardCompatible.body.message).toBe(res.body.message);
    });

    it('/v1/payment-intents/:id/verify (POST) verifies payment and creates Entitlement', async () => {
      const res = await request(app.getHttpServer())
        .post('/v1/payment-intents/pi_e2e_001/verify')
        .set('Authorization', authHeader)
        .send({
          device_public_key: DEVICE_A,
          transaction_signature: VALID_TRANSACTION_SIGNATURE,
        })
        .expect(200);

      expect(res.body.verified).toBe(true);
      expect(res.body.next_step).toBe('activate_device');
    });

    it('/v1/payment-intents/:id/activate-device (POST) activates Device A with 72h window and wrapped key', async () => {
      mockPrisma.paymentIntent.findUnique.mockResolvedValueOnce({
        id: 'pi_e2e_001',
        devicePublicKey: DEVICE_A,
        clientSecretHmac: require('@/crypto/token32.util').hashIntentClientSecret(
          VALID_TOKEN32,
          'solarch-intent-hmac-secret-32-chars-minimum',
        ),
        payment: {
          status: 'confirmed',
          entitlement: { id: 'ent_e2e_001' },
        },
      });
      const res = await request(app.getHttpServer())
        .post('/v1/payment-intents/pi_e2e_001/activate-device')
        .set('Authorization', authHeader)
        .send({
          device_public_key: DEVICE_A,
          device_name: 'E2E PC',
          viewer_version: '0.1.0',
          request_nonce: 'gIGCg4SFhoeIiYqLjI2Oj5CRkpOUlZaXmJmam5ydnp8=',
        })
        .expect(200);

      expect(res.body.license).toBeDefined();
      expect(res.body.license.payload.device_public_key).toBe(DEVICE_A);
      expect(res.body.license.server_signature).toBeDefined();
      expect(res.body.wrapped_content_key).toBeDefined();
      expect(res.body.device_refresh_token).toBeDefined();

      const issued = new Date(res.body.license.payload.issued_at).getTime();
      const validUntil = new Date(res.body.license.payload.offline_valid_until).getTime();
      expect(Math.round((validUntil - issued) / 1000)).toBe(259200); // 72 hours
    });

    it('/v1/payment-intents/:id/activate-device (POST) rejects Device B with DEVICE_BINDING_MISMATCH', async () => {
      mockPrisma.paymentIntent.findUnique.mockResolvedValueOnce({
        id: 'pi_e2e_001',
        devicePublicKey: DEVICE_A,
        clientSecretHmac: require('@/crypto/token32.util').hashIntentClientSecret(
          VALID_TOKEN32,
          'solarch-intent-hmac-secret-32-chars-minimum',
        ),
        payment: {
          status: 'confirmed',
          entitlement: { id: 'ent_e2e_001' },
        },
      });
      const res = await request(app.getHttpServer())
        .post('/v1/payment-intents/pi_e2e_001/activate-device')
        .set('Authorization', authHeader)
        .send({
          device_public_key: DEVICE_B,
          device_name: 'Second PC',
          viewer_version: '0.1.0',
          request_nonce: 'hJGCg4SFhoeIiYqLjI2Oj5CRkpOUlZaXmJmam5ydnp8=',
        })
        .expect(409);

      expect(res.body.code).toBe('DEVICE_BINDING_MISMATCH');
    });

    it('does not expose removed out-of-contract licensing routes', async () => {
      await request(app.getHttpServer()).post('/v1/licenses/check').send({}).expect(404);
      await request(app.getHttpServer())
        .post('/v1/entitlements/ent_e2e_001/activate-device')
        .send({})
        .expect(404);
    });
  });

  describe('Creator Analytics API', () => {
    it('/v1/archives/:id/analytics (GET) returns owner metrics & revenue', async () => {
      const res = await request(app.getHttpServer())
        .get('/v1/archives/arc_e2e_001/analytics?period=all')
        .set('Authorization', `Bearer ${creatorJwt}`)
        .expect(200);

      expect(res.body.views).toBeDefined();
      expect(res.body.downloads).toBeDefined();
      expect(res.body.conversions).toBeDefined();
      expect(res.body.revenue).toBeDefined();
      expect(res.body.revenue.currency).toBe('USDC');
    });
  });
});
