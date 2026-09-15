import { Test, TestingModule } from '@nestjs/testing';
import { BadRequestException } from '@nestjs/common';
import { createHash } from 'crypto';
import { PaymentsService } from './payments.service';
import { PrismaService } from '@/common/prisma.service';
import { EnvService } from '@/config/env.service';
import { Keypair, PublicKey, Transaction } from '@solana/web3.js';
import bs58 from 'bs58';
import { hashIntentClientSecret } from '@/crypto/token32.util';

describe('PaymentsService & Solana Pay', () => {
  let service: PaymentsService;
  let prisma: any;

  const DEVICE_A = 'aTZYJUYw9zrY2nj7Mxv5ds1C+Q4OnJ6D9AxRBypvdBc=';
  const feePayer = Keypair.generate();
  const usdcMint = new PublicKey('4zMMC9srt5Ri5X14GAgXhaHii3GnPAEERYPJgZJDncDU');
  const platformWallet = Keypair.generate().publicKey;
  const PEPPER = 'test-hmac-secret-pepper-minimum-32';
  const VALID_SIGNATURE = bs58.encode(Buffer.alloc(64, 7));
  const UNRELATED_SIGNATURE = bs58.encode(Buffer.alloc(64, 8));
  const ARCHIVE_FINGERPRINT = 'a'.repeat(64);

  const mockMessageBytes = Buffer.from('mock_tx_message_bytes_for_matching');
  const mockMessageHash = createHash('sha256').update(mockMessageBytes).digest('hex').toLowerCase();

  beforeEach(async () => {
    prisma = {
      archive: {
        findUnique: jest.fn(),
      },
      paymentIntent: {
        create: jest.fn(),
        findUnique: jest.fn(),
        update: jest.fn(),
      },
      payment: {
        findUnique: jest.fn(),
        create: jest.fn(),
      },
      entitlement: {
        create: jest.fn(),
      },
      paymentTransactionIssuance: {
        findFirst: jest.fn().mockResolvedValue(null),
        findMany: jest.fn().mockResolvedValue([]),
        create: jest.fn().mockResolvedValue({}),
        update: jest.fn().mockResolvedValue({}),
        updateMany: jest.fn().mockResolvedValue({ count: 1 }),
      },
      marketplaceEvent: {
        create: jest.fn(),
      },
      $queryRaw: jest.fn().mockResolvedValue([{ id: 'locked' }]),
      $transaction: jest.fn((cb) => cb(prisma)),
    };

    const module: TestingModule = await Test.createTestingModule({
      providers: [
        PaymentsService,
        { provide: PrismaService, useValue: prisma },
        {
          provide: EnvService,
          useValue: {
            solanaRpcUrl: 'https://api.devnet.solana.com',
            usdcMint,
            solarchPlatformWallet: platformWallet,
            feePayerKeypair: feePayer,
            intentHmacSecret: PEPPER,
            publicApiOrigin: 'https://solarch.app',
            isProduction: false,
          },
        },
      ],
    }).compile();

    service = module.get<PaymentsService>(PaymentsService);

    jest.spyOn(service, 'getConnection').mockReturnValue({
      getLatestBlockhash: jest.fn().mockResolvedValue({
        blockhash: 'EkSnNWid2cvwEVnVx9aBqawnmiCNiDcg3iAZ2tFhGuqd',
        lastValidBlockHeight: 123456,
      }),
      getSignaturesForAddress: jest.fn().mockResolvedValue([]),
      getSignatureStatuses: jest.fn().mockResolvedValue({
        value: [{ confirmationStatus: 'finalized', err: null, slot: 100 }],
      }),
      getBlockHeight: jest.fn().mockResolvedValue(100),
      getBlock: jest.fn().mockResolvedValue({ blockHeight: 100 }),
      getParsedTransaction: jest.fn().mockResolvedValue(null),
      getTransaction: jest.fn().mockResolvedValue(null),
    } as any);
  });

  test('creates PaymentIntent with Device A bound, TOKEN32 client secret and 95/5 split', async () => {
    const creatorPayout = Keypair.generate().publicKey.toBase58();
    prisma.archive.findUnique.mockResolvedValue({
      id: 'arc_001',
      priceAmount: '10.00',
      creatorPayoutWallet: creatorPayout,
      creatorUsdcAta: 'CreatorUsdcAta11111111111111111111111111111',
      marketplaceStatus: 'published',
      technicalStatus: 'ready',
      priceCurrency: 'USDC',
      platformFeeBps: 500,
      maxDevices: 1,
      allowExport: false,
      watermarkEnabled: true,
      archiveFingerprint: ARCHIVE_FINGERPRINT,
    });

    prisma.paymentIntent.create.mockImplementation(({ data }: any) => ({
      id: 'pi_001',
      ...data,
    }));

    const res = await service.createPaymentIntent({
      archive_id: 'arc_001',
      device_public_key: DEVICE_A,
    });

    expect(res.payment_intent_id).toBe('pi_001');
    expect(res.amount).toBe('10.00');
    expect(res.creator_share).toBe('9.50');
    expect(res.platform_share).toBe('0.50');
    expect(res.solana_pay_url).toBe('solana:https://solarch.app/v1/solana-pay/payment-intents/pi_001/transaction');
    expect(res.payment_intent_client_secret).toBeDefined();
    expect(res.payment_intent_client_secret.length).toBe(43);

    // Verify raw secret was NOT stored in database
    const savedData = prisma.paymentIntent.create.mock.calls[0][0].data;
    expect(savedData.clientSecretHmac).toBeDefined();
    expect(savedData.clientSecretHmac).not.toBe(res.payment_intent_client_secret);
    expect(savedData.devicePublicKey).toBe(DEVICE_A);
    expect(savedData.archiveFingerprint).toBe(ARCHIVE_FINGERPRINT);
  });

  test('rejects invalid device public key format during intent creation', async () => {
    await expect(
      service.createPaymentIntent({
        archive_id: 'arc_001',
        device_public_key: 'invalid_base64_not_44_chars',
      }),
    ).rejects.toThrow(BadRequestException);
    expect(prisma.archive.findUnique).not.toHaveBeenCalled();
    expect(prisma.paymentIntent.create).not.toHaveBeenCalled();
  });

  test.each([
    Buffer.alloc(32),
    Buffer.from([1, ...new Array(31).fill(0)]),
    Buffer.from([0xec, ...new Array(30).fill(0xff), 0x7f]),
  ])('rejects low-order X25519 Device A key before creating an intent', async (key) => {
    await expect(
      service.createPaymentIntent({
        archive_id: 'arc_001',
        device_public_key: key.toString('base64'),
      }),
    ).rejects.toThrow(BadRequestException);
    expect(prisma.archive.findUnique).not.toHaveBeenCalled();
    expect(prisma.paymentIntent.create).not.toHaveBeenCalled();
  });

  test.each([
    ['missing', null, 404, 'ARCHIVE_NOT_AVAILABLE'],
    ['draft', { marketplaceStatus: 'draft', technicalStatus: 'ready' }, 404, 'ARCHIVE_NOT_AVAILABLE'],
    ['processing', { marketplaceStatus: 'published', technicalStatus: 'processing' }, 404, 'ARCHIVE_NOT_AVAILABLE'],
    ['unpublished', { marketplaceStatus: 'unpublished', technicalStatus: 'ready' }, 404, 'ARCHIVE_NOT_AVAILABLE'],
    ['blocked', { marketplaceStatus: 'blocked', technicalStatus: 'ready' }, 403, 'ARCHIVE_BLOCKED'],
  ])('maps %s archive state to exact API error', async (_label, archive, status, code) => {
    prisma.archive.findUnique.mockResolvedValue(archive);
    await expect(
      service.createPaymentIntent({ archive_id: 'arc_001', device_public_key: DEVICE_A }),
    ).rejects.toMatchObject({ status, response: expect.objectContaining({ code }) });
    expect(prisma.paymentIntent.create).not.toHaveBeenCalled();
  });

  test.each(['', 'not-a-solana-signature'])(
    'rejects malformed Solana transaction signature %p as INVALID_REQUEST',
    async (transactionSignature) => {
      await expect(
        service.verifyPayment('pi_001', 'SolArchIntent invalid', {
          device_public_key: DEVICE_A,
          transaction_signature: transactionSignature,
        }),
      ).rejects.toMatchObject({
        status: 400,
        response: expect.objectContaining({ code: 'INVALID_REQUEST' }),
      });
      expect(prisma.paymentIntent.findUnique).not.toHaveBeenCalled();
    },
  );

  test.each([
    ['', 'pi_guess_missing'],
    ['SolArchIntent malformed', 'pi_guess_malformed'],
  ])('returns stable 401 for missing/malformed intent credential regardless of guessed ID', async (header, pathId) => {
    await expect(
      service.verifyPayment(pathId, header, { device_public_key: DEVICE_A }),
    ).rejects.toMatchObject({
      status: 401,
      response: {
        code: 'INVALID_INTENT_CREDENTIAL',
        message: 'Invalid payment intent credential',
      },
    });
    expect(prisma.paymentIntent.findUnique).not.toHaveBeenCalled();
  });

  test('uses keyed intent HMAC lookup and returns stable 401 for an unmatched valid token', async () => {
    const wrongSecret = Buffer.alloc(32, 88).toString('base64url');
    const wrongHmac = hashIntentClientSecret(wrongSecret, PEPPER);
    prisma.paymentIntent.findUnique.mockResolvedValue(null);

    await expect(
      service.verifyPayment('pi_guess', `SolArchIntent ${wrongSecret}`, {
        device_public_key: DEVICE_A,
      }),
    ).rejects.toMatchObject({
      status: 401,
      response: {
        code: 'INVALID_INTENT_CREDENTIAL',
        message: 'Invalid payment intent credential',
      },
    });
    expect(prisma.paymentIntent.findUnique).toHaveBeenCalledWith({
      where: { clientSecretHmac: wrongHmac },
      include: { archive: true, payment: { include: { entitlement: true } } },
    });
  });

  test('rejects a valid intent credential bound to a different verify path ID', async () => {
    const secret = 'AAECAwQFBgcICQoLDA0ODxAREhMUFRYXGBkaGxwdHh8';
    prisma.paymentIntent.findUnique.mockResolvedValue({
      id: 'pi_authoritative',
      devicePublicKey: DEVICE_A,
      clientSecretHmac: hashIntentClientSecret(secret, PEPPER),
    });

    await expect(
      service.verifyPayment('pi_guessed', `SolArchIntent ${secret}`, {
        device_public_key: DEVICE_A,
      }),
    ).rejects.toMatchObject({
      status: 401,
      response: expect.objectContaining({ code: 'INVALID_INTENT_CREDENTIAL' }),
    });
    expect(prisma.paymentTransactionIssuance.findFirst).not.toHaveBeenCalled();
  });

  test('builds atomic transaction request with SolArch fee payer partial signature', async () => {
    const buyerWallet = Keypair.generate().publicKey.toBase58();
    const creatorAta = Keypair.generate().publicKey.toBase58();
    const platformAta = Keypair.generate().publicKey.toBase58();
    const reference = Keypair.generate().publicKey.toBase58();

    prisma.paymentIntent.findUnique.mockResolvedValue({
      id: 'pi_001',
      expectedPriceAmount: '10.00',
      creatorAta,
      platformAta,
      reference,
      status: 'created',
      expiresAt: new Date(Date.now() + 1800 * 1000),
      archiveFingerprint: ARCHIVE_FINGERPRINT,
      archive: {
        marketplaceStatus: 'published',
        technicalStatus: 'ready',
        priceCurrency: 'USDC',
        platformFeeBps: 500,
        maxDevices: 1,
        allowExport: false,
        watermarkEnabled: true,
        archiveFingerprint: ARCHIVE_FINGERPRINT,
      },
    });

    const res = await service.buildTransaction('pi_001', { account: buyerWallet });
    expect(res.transaction).toBeDefined();

    // Verify transaction can be deserialized and has fee payer
    const txBuf = Buffer.from(res.transaction, 'base64');
    expect(txBuf.length).toBeGreaterThan(100);
    const transaction = Transaction.from(txBuf);
    const transferInstructions = transaction.instructions.filter((instruction) =>
      instruction.programId.equals(new PublicKey('TokenkegQfeZyiNwAJbNbGKPFXCWuBvf9Ss623VQ5DA')),
    );
    expect(transferInstructions).toHaveLength(2);
    expect(transferInstructions[0].keys).toContainEqual({
      pubkey: new PublicKey(reference),
      isSigner: false,
      isWritable: false,
    });
    const memoInstruction = transaction.instructions.find((instruction) =>
      instruction.programId.equals(new PublicKey('MemoSq4gqABAXKb96qnH8TysNcWxMyWCqXgDLGmfcHr')),
    );
    expect(memoInstruction?.keys).toHaveLength(0);
    expect(prisma.paymentTransactionIssuance.create).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({
          expectedTransactionSignature: expect.any(String),
          status: 'active',
        }),
      }),
    );
    expect(prisma.$queryRaw).toHaveBeenCalled();
  });

  test('rejects the SolArch fee payer as the buyer construction account', async () => {
    await expect(
      service.buildTransaction('pi_001', { account: feePayer.publicKey.toBase58() }),
    ).rejects.toMatchObject({
      status: 400,
      response: expect.objectContaining({ code: 'INVALID_PAYMENT_ACCOUNT' }),
    });
    expect(prisma.$transaction).not.toHaveBeenCalled();
  });

  test.each([
    ['same wallet returns the exact same transaction', false],
    ['different wallet receives PAYMENT_TRANSACTION_IN_FLIGHT', true],
  ])('serializes concurrent issuance: %s', async (_label, differentWallet) => {
    const buyerA = Keypair.generate().publicKey.toBase58();
    const buyerB = differentWallet ? Keypair.generate().publicKey.toBase58() : buyerA;
    const intent = {
      id: 'pi_concurrent',
      expectedPriceAmount: '10.00',
      creatorAta: Keypair.generate().publicKey.toBase58(),
      platformAta: Keypair.generate().publicKey.toBase58(),
      reference: Keypair.generate().publicKey.toBase58(),
      status: 'created',
      expiresAt: new Date(Date.now() + 60_000),
      archiveFingerprint: ARCHIVE_FINGERPRINT,
      archive: {
        marketplaceStatus: 'published',
        technicalStatus: 'ready',
        priceCurrency: 'USDC',
        platformFeeBps: 500,
        maxDevices: 1,
        allowExport: false,
        watermarkEnabled: true,
        archiveFingerprint: ARCHIVE_FINGERPRINT,
      },
    };
    let activeIssuance: any = null;
    prisma.paymentIntent.findUnique.mockResolvedValue(intent);
    prisma.paymentTransactionIssuance.findFirst.mockImplementation(({ where }) =>
      where.status === 'active' ? activeIssuance : null,
    );
    prisma.paymentTransactionIssuance.create.mockImplementation(({ data }) => {
      activeIssuance = { id: 'iss_concurrent', issuedAt: new Date(), ...data };
      return activeIssuance;
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

    const [first, second] = await Promise.allSettled([
      service.buildTransaction('pi_concurrent', { account: buyerA }),
      service.buildTransaction('pi_concurrent', { account: buyerB }),
    ]);
    expect(first.status).toBe('fulfilled');
    expect(prisma.paymentTransactionIssuance.create).toHaveBeenCalledTimes(1);
    if (differentWallet) {
      expect(second.status).toBe('rejected');
      expect((second as PromiseRejectedResult).reason.getResponse().code).toBe(
        'PAYMENT_TRANSACTION_IN_FLIGHT',
      );
    } else {
      expect(second.status).toBe('fulfilled');
      expect((second as PromiseFulfilledResult<any>).value.transaction).toBe(
        (first as PromiseFulfilledResult<any>).value.transaction,
      );
    }
  });

  test('non-final failed status cannot retire an issuance or permit replacement', async () => {
    const buyer = Keypair.generate().publicKey.toBase58();
    const issuance = {
      id: 'iss_reorgable_failure',
      paymentIntentId: 'pi_reorgable_failure',
      constructionAccount: buyer,
      expectedTransactionSignature: VALID_SIGNATURE,
      serializedTransaction: 'stored_exact_transaction',
      lastValidBlockHeight: BigInt(100),
      status: 'active',
    };
    prisma.paymentIntent.findUnique.mockResolvedValue({
      id: 'pi_reorgable_failure',
      expectedPriceAmount: '10.00',
      status: 'pending',
      expiresAt: new Date(Date.now() + 60_000),
      archiveFingerprint: ARCHIVE_FINGERPRINT,
      archive: {
        marketplaceStatus: 'published',
        technicalStatus: 'ready',
        priceCurrency: 'USDC',
        platformFeeBps: 500,
        maxDevices: 1,
        allowExport: false,
        watermarkEnabled: true,
        archiveFingerprint: ARCHIVE_FINGERPRINT,
      },
    });
    prisma.paymentTransactionIssuance.findFirst.mockResolvedValue(issuance);
    const getBlockHeight = jest.fn().mockResolvedValue(1_000);
    jest.spyOn(service, 'getConnection').mockReturnValue({
      getSignatureStatuses: jest.fn().mockResolvedValue({
        value: [{ confirmationStatus: 'confirmed', err: { InstructionError: [0, 'Custom'] } }],
      }),
      getBlockHeight,
    } as any);

    await expect(
      service.buildTransaction('pi_reorgable_failure', { account: buyer }),
    ).resolves.toEqual(expect.objectContaining({ transaction: issuance.serializedTransaction }));
    expect(getBlockHeight).not.toHaveBeenCalled();
    expect(prisma.paymentTransactionIssuance.update).not.toHaveBeenCalled();
    expect(prisma.paymentTransactionIssuance.create).not.toHaveBeenCalled();
  });

  test('never returns a pre-expiry serialized transaction from the endpoint after intent TTL', async () => {
    const buyer = Keypair.generate().publicKey.toBase58();
    const issuance = {
      id: 'iss_pre_expiry',
      paymentIntentId: 'pi_expired_wall_clock',
      constructionAccount: buyer,
      expectedTransactionSignature: VALID_SIGNATURE,
      serializedTransaction: 'stored_exact_transaction',
      lastValidBlockHeight: BigInt(200),
      status: 'active',
    };
    prisma.paymentIntent.findUnique.mockResolvedValue({
      id: 'pi_expired_wall_clock',
      status: 'pending',
      expiresAt: new Date(Date.now() - 60_000),
      expectedPriceAmount: '10.00',
      archive: {},
    });
    prisma.paymentTransactionIssuance.findFirst.mockResolvedValue(issuance);
    jest.spyOn(service, 'getConnection').mockReturnValue({
      getSignatureStatuses: jest.fn().mockResolvedValue({ value: [null] }),
      getBlockHeight: jest.fn().mockResolvedValue(150),
    } as any);

    await expect(
      service.buildTransaction('pi_expired_wall_clock', { account: buyer }),
    ).rejects.toMatchObject({
      status: 410,
      response: expect.objectContaining({ code: 'PAYMENT_INTENT_EXPIRED' }),
    });
    expect(prisma.paymentIntent.update).not.toHaveBeenCalled();
    expect(prisma.paymentTransactionIssuance.update).not.toHaveBeenCalled();
  });

  test('expires an intent after TTL only when its issuance window is authoritatively closed', async () => {
    const buyer = Keypair.generate().publicKey.toBase58();
    prisma.paymentIntent.findUnique.mockResolvedValue({
      id: 'pi_closed_window',
      status: 'pending',
      expiresAt: new Date(Date.now() - 60_000),
      expectedPriceAmount: '10.00',
      archive: {},
    });
    prisma.paymentTransactionIssuance.findFirst.mockResolvedValue({
      id: 'iss_closed_window',
      paymentIntentId: 'pi_closed_window',
      constructionAccount: buyer,
      expectedTransactionSignature: VALID_SIGNATURE,
      serializedTransaction: 'stored_exact_transaction',
      lastValidBlockHeight: BigInt(200),
      status: 'active',
    });
    jest.spyOn(service, 'getConnection').mockReturnValue({
      getSignatureStatuses: jest.fn().mockResolvedValue({ value: [null] }),
      getBlockHeight: jest.fn().mockResolvedValue(201),
    } as any);

    await expect(
      service.buildTransaction('pi_closed_window', { account: buyer }),
    ).rejects.toMatchObject({
      status: 410,
      response: expect.objectContaining({ code: 'PAYMENT_INTENT_EXPIRED' }),
    });
    expect(prisma.paymentTransactionIssuance.update).toHaveBeenCalledWith({
      where: { id: 'iss_closed_window' },
      data: { status: 'expired' },
    });
    expect(prisma.paymentIntent.update).toHaveBeenCalledWith({
      where: { id: 'pi_closed_window' },
      data: { status: 'expired' },
    });
  });

  test('terminal expired intent verification is 410 and cannot confirm later', async () => {
    const secret = 'AAECAwQFBgcICQoLDA0ODxAREhMUFRYXGBkaGxwdHh8';
    prisma.paymentIntent.findUnique.mockResolvedValue({
      id: 'pi_terminal_expired',
      archiveId: 'arc_001',
      devicePublicKey: DEVICE_A,
      clientSecretHmac: hashIntentClientSecret(secret, PEPPER),
      status: 'expired',
      expiresAt: new Date(Date.now() - 60_000),
      archiveFingerprint: ARCHIVE_FINGERPRINT,
      archive: { archiveFingerprint: ARCHIVE_FINGERPRINT },
    });
    const connection = service.getConnection() as any;

    await expect(
      service.verifyPayment('pi_terminal_expired', `SolArchIntent ${secret}`, {
        device_public_key: DEVICE_A,
        transaction_signature: VALID_SIGNATURE,
      }),
    ).rejects.toMatchObject({
      status: 410,
      response: expect.objectContaining({ code: 'PAYMENT_INTENT_EXPIRED' }),
    });
    expect(connection.getSignatureStatuses).not.toHaveBeenCalled();
    expect(prisma.payment.create).not.toHaveBeenCalled();
    expect(prisma.paymentIntent.update).not.toHaveBeenCalled();
  });

  test('uses the inclusive expires_at boundary during verify', async () => {
    jest.useFakeTimers();
    try {
      const now = new Date('2026-09-13T12:00:00.000Z');
      jest.setSystemTime(now);
      const secret = 'AAECAwQFBgcICQoLDA0ODxAREhMUFRYXGBkaGxwdHh8';
      prisma.paymentIntent.findUnique.mockResolvedValue({
        id: 'pi_at_expiry',
        archiveId: 'arc_001',
        devicePublicKey: DEVICE_A,
        clientSecretHmac: hashIntentClientSecret(secret, PEPPER),
        status: 'pending',
        expiresAt: now,
        archiveFingerprint: ARCHIVE_FINGERPRINT,
        archive: { archiveFingerprint: ARCHIVE_FINGERPRINT },
      });
      prisma.paymentTransactionIssuance.findFirst.mockResolvedValue(null);

      await expect(
        service.verifyPayment('pi_at_expiry', `SolArchIntent ${secret}`, {
          device_public_key: DEVICE_A,
        }),
      ).rejects.toMatchObject({
        status: 410,
        response: expect.objectContaining({ code: 'PAYMENT_INTENT_EXPIRED' }),
      });
      expect(prisma.paymentIntent.update).toHaveBeenCalledWith({
        where: { id: 'pi_at_expiry' },
        data: { status: 'expired' },
      });
    } finally {
      jest.useRealTimers();
    }
  });

  test('verifies payment when transaction is finalized and matches 95/5 USDC split and reference', async () => {
    const creatorAta = Keypair.generate().publicKey.toBase58();
    const platformAta = Keypair.generate().publicKey.toBase58();
    const reference = Keypair.generate().publicKey.toBase58();
    const secret = 'AAECAwQFBgcICQoLDA0ODxAREhMUFRYXGBkaGxwdHh8';
    const secretHmac = hashIntentClientSecret(secret, PEPPER);

    prisma.paymentIntent.findUnique.mockResolvedValue({
      id: 'pi_001',
      archiveId: 'arc_001',
      devicePublicKey: DEVICE_A,
      clientSecretHmac: secretHmac,
      expectedPriceAmount: '10.00',
      creatorAta,
      platformAta,
      reference,
      status: 'pending',
      expiresAt: new Date(Date.now() + 1800 * 1000),
      archiveFingerprint: ARCHIVE_FINGERPRINT,
      archive: {
        marketplaceStatus: 'published',
        technicalStatus: 'ready',
        allowExport: false,
        watermarkEnabled: true,
        archiveFingerprint: ARCHIVE_FINGERPRINT,
      },
    });
    prisma.payment.findUnique.mockResolvedValue(null);
    const buyerWallet = Keypair.generate().publicKey.toBase58();
    prisma.paymentTransactionIssuance.findFirst.mockResolvedValue({
      id: 'iss_001',
      paymentIntentId: 'pi_001',
      constructionAccount: buyerWallet,
      expectedTransactionSignature: VALID_SIGNATURE,
      transactionMessageHash: mockMessageHash,
      lastValidBlockHeight: BigInt(200_000),
      status: 'active',
    });
    prisma.paymentIntent.update.mockResolvedValue({});
    prisma.payment.create.mockResolvedValue({ id: 'pay_001' });
    prisma.entitlement.create.mockResolvedValue({ id: 'ent_001' });
    prisma.marketplaceEvent.create.mockResolvedValue({});

    // Realistic mocks: getSignatureStatuses has finalized, getParsedTransaction does NOT have confirmationStatus
    jest.spyOn(service, 'getConnection').mockReturnValue({
      getSignatureStatuses: jest.fn().mockResolvedValue({
        value: [{ confirmationStatus: 'finalized', err: null, slot: 100 }],
      }),
      getParsedTransaction: jest.fn().mockResolvedValue({
        slot: 100,
        blockTime: 123456,
        meta: { err: null },
        transaction: {
          message: {
            accountKeys: [
              { pubkey: { toBase58: () => reference }, signer: false },
              { pubkey: feePayer.publicKey, signer: true },
              { pubkey: { toBase58: () => buyerWallet }, signer: true },
            ],
            instructions: [
              {
                parsed: {
                  type: 'transferChecked',
                  info: {
                    destination: creatorAta,
                    amount: '9500000',
                    mint: usdcMint.toBase58(),
                  },
                },
              },
              {
                parsed: {
                  type: 'transferChecked',
                  info: {
                    destination: platformAta,
                    amount: '500000',
                    mint: usdcMint.toBase58(),
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
            serialize: () => mockMessageBytes,
          },
        },
      }),
      getBlock: jest.fn().mockResolvedValue({ blockHeight: 100 }),
    } as any);

    const res = await service.verifyPayment('pi_001', `SolArchIntent ${secret}`, {
      device_public_key: DEVICE_A,
      transaction_signature: VALID_SIGNATURE,
    });

    expect(res.verified).toBe(true);
    expect(res.payment_id).toBe('pay_001');
    expect(res.entitlement_id).toBe('ent_001');
    expect(prisma.paymentIntent.findUnique).toHaveBeenCalledWith({
      where: { clientSecretHmac: secretHmac },
      include: { archive: true, payment: { include: { entitlement: true } } },
    });
    expect(prisma.paymentIntent.update).toHaveBeenCalledWith({
      where: { id: 'pi_001' },
      data: { status: 'confirmed', confirmedBuyerWallet: buyerWallet },
    });
    expect(prisma.payment.create).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({
          buyerWallet,
          devicePublicKey: DEVICE_A,
          transactionSignature: VALID_SIGNATURE,
        }),
      }),
    );
    const verificationConnection = service.getConnection() as any;
    expect(verificationConnection.getParsedTransaction).toHaveBeenCalledWith(VALID_SIGNATURE, {
      commitment: 'finalized',
      maxSupportedTransactionVersion: 0,
    });
    expect(verificationConnection.getTransaction).toHaveBeenCalledWith(VALID_SIGNATURE, {
      commitment: 'finalized',
      maxSupportedTransactionVersion: 0,
    });
    expect(verificationConnection.getBlock).toHaveBeenCalledWith(100, {
      commitment: 'finalized',
      transactionDetails: 'none',
      rewards: false,
      maxSupportedTransactionVersion: 1,
    });

    (service.getConnection() as any).getBlock.mockResolvedValueOnce({ blockHeight: 200_001 });
    await expect(
      service.verifyPayment('pi_001', `SolArchIntent ${secret}`, {
        device_public_key: DEVICE_A,
        transaction_signature: VALID_SIGNATURE,
      }),
    ).rejects.toThrow(BadRequestException);

    (service.getConnection() as any).getBlock.mockResolvedValueOnce(null);
    await expect(
      service.verifyPayment('pi_001', `SolArchIntent ${secret}`, {
        device_public_key: DEVICE_A,
        transaction_signature: VALID_SIGNATURE,
      }),
    ).rejects.toMatchObject({ status: 503 });
  });

  test('rejects an unrelated failed signature without changing issuance or intent state', async () => {
    const secret = 'AAECAwQFBgcICQoLDA0ODxAREhMUFRYXGBkaGxwdHh8';
    prisma.paymentIntent.findUnique.mockResolvedValue({
      id: 'pi_001',
      archiveId: 'arc_001',
      devicePublicKey: DEVICE_A,
      clientSecretHmac: hashIntentClientSecret(secret, PEPPER),
      status: 'pending',
      expiresAt: new Date(Date.now() + 60_000),
      archiveFingerprint: ARCHIVE_FINGERPRINT,
      archive: { archiveFingerprint: ARCHIVE_FINGERPRINT },
    });
    prisma.paymentTransactionIssuance.findFirst.mockResolvedValue(null);
    const connection = service.getConnection() as any;

    await expect(
      service.verifyPayment('pi_001', `SolArchIntent ${secret}`, {
        device_public_key: DEVICE_A,
        transaction_signature: UNRELATED_SIGNATURE,
      }),
    ).rejects.toThrow(BadRequestException);
    expect(connection.getSignatureStatuses).not.toHaveBeenCalled();
    expect(prisma.paymentTransactionIssuance.updateMany).not.toHaveBeenCalled();
    expect(prisma.paymentIntent.update).not.toHaveBeenCalled();
  });

  test('keeps a landed pre-expiry issuance awaiting finality after intent TTL', async () => {
    const secret = 'AAECAwQFBgcICQoLDA0ODxAREhMUFRYXGBkaGxwdHh8';
    prisma.paymentIntent.findUnique.mockResolvedValue({
      id: 'pi_001',
      archiveId: 'arc_001',
      devicePublicKey: DEVICE_A,
      clientSecretHmac: hashIntentClientSecret(secret, PEPPER),
      status: 'pending',
      expiresAt: new Date(Date.now() - 60_000),
      archiveFingerprint: ARCHIVE_FINGERPRINT,
      archive: { archiveFingerprint: ARCHIVE_FINGERPRINT },
    });
    prisma.paymentTransactionIssuance.findFirst.mockResolvedValue({
      id: 'iss_001',
      expectedTransactionSignature: VALID_SIGNATURE,
      lastValidBlockHeight: BigInt(200),
      status: 'active',
    });
    jest.spyOn(service, 'getConnection').mockReturnValue({
      getSignatureStatuses: jest.fn().mockResolvedValue({
        value: [{ confirmationStatus: 'confirmed', err: null, slot: 100 }],
      }),
    } as any);

    await expect(
      service.verifyPayment('pi_001', `SolArchIntent ${secret}`, {
        device_public_key: DEVICE_A,
        transaction_signature: VALID_SIGNATURE,
      }),
    ).resolves.toEqual({ verified: false, status: 'awaiting_finality' });
    expect(prisma.paymentIntent.update).toHaveBeenCalledWith({
      where: { id: 'pi_001' },
      data: { status: 'awaiting_finality' },
    });
  });

  test('does not fail an issuance or intent for a non-final Solana error', async () => {
    const secret = 'AAECAwQFBgcICQoLDA0ODxAREhMUFRYXGBkaGxwdHh8';
    prisma.paymentIntent.findUnique.mockResolvedValue({
      id: 'pi_001',
      archiveId: 'arc_001',
      archiveFingerprint: ARCHIVE_FINGERPRINT,
      devicePublicKey: DEVICE_A,
      clientSecretHmac: hashIntentClientSecret(secret, PEPPER),
      status: 'pending',
      expiresAt: new Date(Date.now() + 60_000),
      archive: { archiveFingerprint: ARCHIVE_FINGERPRINT },
    });
    prisma.paymentTransactionIssuance.findFirst.mockResolvedValue({
      id: 'iss_001',
      expectedTransactionSignature: VALID_SIGNATURE,
      lastValidBlockHeight: BigInt(200),
      status: 'active',
    });
    jest.spyOn(service, 'getConnection').mockReturnValue({
      getSignatureStatuses: jest.fn().mockResolvedValue({
        value: [{ confirmationStatus: 'confirmed', err: { InstructionError: [0, 'Custom'] }, slot: 100 }],
      }),
    } as any);

    await expect(
      service.verifyPayment('pi_001', `SolArchIntent ${secret}`, {
        device_public_key: DEVICE_A,
        transaction_signature: VALID_SIGNATURE,
      }),
    ).resolves.toEqual({ verified: false, status: 'pending' });
    expect(prisma.paymentTransactionIssuance.updateMany).not.toHaveBeenCalled();
    expect(prisma.paymentIntent.update).not.toHaveBeenCalled();
  });

  test('only a finalized failure of the exact issuance can terminal-fail an expired intent', async () => {
    const secret = 'AAECAwQFBgcICQoLDA0ODxAREhMUFRYXGBkaGxwdHh8';
    prisma.paymentIntent.findUnique.mockResolvedValue({
      id: 'pi_001',
      archiveId: 'arc_001',
      archiveFingerprint: ARCHIVE_FINGERPRINT,
      devicePublicKey: DEVICE_A,
      clientSecretHmac: hashIntentClientSecret(secret, PEPPER),
      status: 'pending',
      expiresAt: new Date(Date.now() - 60_000),
      archive: { archiveFingerprint: ARCHIVE_FINGERPRINT },
    });
    prisma.paymentTransactionIssuance.findFirst.mockResolvedValue({
      id: 'iss_001',
      expectedTransactionSignature: VALID_SIGNATURE,
      lastValidBlockHeight: BigInt(200),
      status: 'active',
    });
    jest.spyOn(service, 'getConnection').mockReturnValue({
      getSignatureStatuses: jest.fn().mockResolvedValue({
        value: [{ confirmationStatus: 'finalized', err: { InstructionError: [0, 'Custom'] }, slot: 100 }],
      }),
    } as any);

    await expect(
      service.verifyPayment('pi_001', `SolArchIntent ${secret}`, {
        device_public_key: DEVICE_A,
        transaction_signature: VALID_SIGNATURE,
      }),
    ).rejects.toMatchObject({
      status: 403,
      response: expect.objectContaining({ code: 'PAYMENT_FAILED' }),
    });
    expect(prisma.paymentTransactionIssuance.updateMany).toHaveBeenCalledWith({
      where: { id: 'iss_001', status: 'active' },
      data: { status: 'failed' },
    });
    expect(prisma.paymentIntent.update).toHaveBeenCalledWith({
      where: { id: 'pi_001' },
      data: { status: 'failed' },
    });
  });

  test('fails closed when the immutable PaymentIntent fingerprint snapshot no longer matches Archive', async () => {
    const secret = 'AAECAwQFBgcICQoLDA0ODxAREhMUFRYXGBkaGxwdHh8';
    prisma.paymentIntent.findUnique.mockResolvedValue({
      id: 'pi_001',
      archiveId: 'arc_001',
      archiveFingerprint: ARCHIVE_FINGERPRINT,
      devicePublicKey: DEVICE_A,
      clientSecretHmac: hashIntentClientSecret(secret, PEPPER),
      status: 'pending',
      archive: { archiveFingerprint: 'b'.repeat(64) },
    });

    await expect(
      service.verifyPayment('pi_001', `SolArchIntent ${secret}`, {
        device_public_key: DEVICE_A,
        transaction_signature: VALID_SIGNATURE,
      }),
    ).rejects.toMatchObject({ status: 503 });
    expect((service.getConnection() as any).getSignatureStatuses).not.toHaveBeenCalled();
  });

  test('rejects payment when reference is missing in on-chain transaction', async () => {
    const creatorAta = Keypair.generate().publicKey.toBase58();
    const platformAta = Keypair.generate().publicKey.toBase58();
    const reference = Keypair.generate().publicKey.toBase58();
    const secret = 'AAECAwQFBgcICQoLDA0ODxAREhMUFRYXGBkaGxwdHh8';
    const secretHmac = hashIntentClientSecret(secret, PEPPER);

    prisma.paymentIntent.findUnique.mockResolvedValue({
      id: 'pi_001',
      archiveId: 'arc_001',
      devicePublicKey: DEVICE_A,
      clientSecretHmac: secretHmac,
      expectedPriceAmount: '10.00',
      creatorAta,
      platformAta,
      reference,
      status: 'pending',
      expiresAt: new Date(Date.now() + 1800 * 1000),
      archiveFingerprint: ARCHIVE_FINGERPRINT,
      archive: { archiveFingerprint: ARCHIVE_FINGERPRINT },
    });
    prisma.payment.findUnique.mockResolvedValue(null);
    prisma.paymentTransactionIssuance.findFirst.mockResolvedValue({
      id: 'iss_001',
      paymentIntentId: 'pi_001',
      constructionAccount: Keypair.generate().publicKey.toBase58(),
      expectedTransactionSignature: VALID_SIGNATURE,
      transactionMessageHash: mockMessageHash,
      lastValidBlockHeight: BigInt(200_000),
      status: 'active',
    });

    jest.spyOn(service, 'getConnection').mockReturnValue({
      getSignatureStatuses: jest.fn().mockResolvedValue({
        value: [{ confirmationStatus: 'finalized', err: null, slot: 100 }],
      }),
      getParsedTransaction: jest.fn().mockResolvedValue({
        slot: 100,
        meta: { err: null },
        transaction: {
          message: {
            accountKeys: [
              { pubkey: { toBase58: () => 'AnotherKey' }, signer: false },
              { pubkey: { toBase58: () => 'BuyerWallet' }, signer: true },
            ],
            instructions: [],
          },
        },
      }),
      getTransaction: jest.fn().mockResolvedValue({
        slot: 100,
        transaction: {
          message: {
            serialize: () => mockMessageBytes,
          },
        },
      }),
      getBlock: jest.fn().mockResolvedValue({ blockHeight: 100 }),
    } as any);

    await expect(
      service.verifyPayment('pi_001', `SolArchIntent ${secret}`, {
        device_public_key: DEVICE_A,
        transaction_signature: VALID_SIGNATURE,
      }),
    ).rejects.toThrow(BadRequestException);
  });
});
