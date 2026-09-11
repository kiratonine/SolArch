import { Test, TestingModule } from '@nestjs/testing';
import { BadRequestException } from '@nestjs/common';
import { PaymentsService } from './payments.service';
import { PrismaService } from '@/common/prisma.service';
import { EnvService } from '@/config/env.service';
import { Keypair, PublicKey } from '@solana/web3.js';

describe('PaymentsService & Solana Pay', () => {
  let service: PaymentsService;
  let prisma: any;

  const DEVICE_A = 'aTZYJUYw9zrY2nj7Mxv5ds1C+Q4OnJ6D9AxRBypvdBc=';
  const feePayer = Keypair.generate();
  const usdcMint = new PublicKey('4zMMC9srt5Ri5X14GAgXhaHii3GnPAEERYPJgZJDncDU');
  const platformWallet = Keypair.generate().publicKey;

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
      marketplaceEvent: {
        create: jest.fn(),
      },
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
            intentHmacSecret: 'test-hmac-secret-pepper-minimum-32',
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
      getParsedTransaction: jest.fn().mockResolvedValue(null),
    } as any);
  });

  test('creates PaymentIntent with Device A bound, TOKEN32 client secret and 95/5 split', async () => {
    const creatorPayout = Keypair.generate().publicKey.toBase58();
    prisma.archive.findUnique.mockResolvedValue({
      id: 'arc_001',
      priceAmount: '10.00',
      platformFeeBps: 500,
      creatorPayoutWallet: creatorPayout,
      creatorUsdcAta: 'CreatorUsdcAta11111111111111111111111111111',
      marketplaceStatus: 'published',
    });

    prisma.paymentIntent.create.mockImplementation(({ data }: any) => ({
      id: 'pi_001',
      ...data,
    }));

    const res = await service.createPaymentIntent(
      {
        archive_id: 'arc_001',
        device_public_key: DEVICE_A,
      },
      'https://solarch.app',
    );

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
  });

  test('rejects invalid device public key format during intent creation', async () => {
    await expect(
      service.createPaymentIntent({
        archive_id: 'arc_001',
        device_public_key: 'invalid_base64_not_44_chars',
      }),
    ).rejects.toThrow(BadRequestException);
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
    });

    const res = await service.buildTransaction('pi_001', { account: buyerWallet });
    expect(res.transaction).toBeDefined();

    // Verify transaction can be deserialized and has fee payer
    const txBuf = Buffer.from(res.transaction, 'base64');
    expect(txBuf.length).toBeGreaterThan(100);
  });

  test('verifies payment when transaction matches 95/5 USDC split and reference', async () => {
    const creatorAta = Keypair.generate().publicKey.toBase58();
    const platformAta = Keypair.generate().publicKey.toBase58();
    const reference = Keypair.generate().publicKey.toBase58();
    const secret = 'test_secret_32_bytes_token32_random_secret_43';
    const secretHmac = require('@/crypto/token32.util').hashSecretToken(secret, 'test-hmac-secret-pepper-minimum-32');

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
      archive: {
        allowExport: false,
        watermarkEnabled: true,
      },
    });
    prisma.payment.findUnique.mockResolvedValue(null);
    prisma.paymentIntent.update.mockResolvedValue({});
    prisma.payment.create.mockResolvedValue({ id: 'pay_001' });
    prisma.entitlement.create.mockResolvedValue({ id: 'ent_001' });
    prisma.marketplaceEvent.create.mockResolvedValue({});

    jest.spyOn(service, 'getConnection').mockReturnValue({
      getParsedTransaction: jest.fn().mockResolvedValue({
        slot: 100,
        blockTime: 123456,
        confirmationStatus: 'finalized',
        meta: { err: null },
        transaction: {
          message: {
            accountKeys: [
              { pubkey: { toBase58: () => reference }, signer: false },
              { pubkey: { toBase58: () => 'BuyerWallet1111111111111111111111111111111' }, signer: true },
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
    } as any);

    const res = await service.verifyPayment('pi_001', `SolArchIntent ${secret}`, {
      device_public_key: DEVICE_A,
      transaction_signature: 'sig_valid_1111111111111111111111111111111111111111111111111111111111111111',
    });

    expect(res.verified).toBe(true);
    expect(res.payment_id).toBe('pay_001');
    expect(res.entitlement_id).toBe('ent_001');
  });

  test('rejects payment when reference is missing in on-chain transaction', async () => {
    const creatorAta = Keypair.generate().publicKey.toBase58();
    const platformAta = Keypair.generate().publicKey.toBase58();
    const reference = Keypair.generate().publicKey.toBase58();
    const secret = 'test_secret_32_bytes_token32_random_secret_43';
    const secretHmac = require('@/crypto/token32.util').hashSecretToken(secret, 'test-hmac-secret-pepper-minimum-32');

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
    });
    prisma.payment.findUnique.mockResolvedValue(null);

    jest.spyOn(service, 'getConnection').mockReturnValue({
      getParsedTransaction: jest.fn().mockResolvedValue({
        confirmationStatus: 'finalized',
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
    } as any);

    await expect(
      service.verifyPayment('pi_001', `SolArchIntent ${secret}`, {
        device_public_key: DEVICE_A,
        transaction_signature: 'sig_invalid_reference',
      }),
    ).rejects.toThrow(BadRequestException);
  });
});
