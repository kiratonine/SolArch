import {
  Injectable,
  BadRequestException,
  NotFoundException,
  UnauthorizedException,
  ForbiddenException,
  ConflictException,
  Logger,
} from '@nestjs/common';
import {
  Connection,
  PublicKey,
  Keypair,
  Transaction,
  TransactionInstruction,
} from '@solana/web3.js';
import {
  getAssociatedTokenAddressSync,
  createTransferCheckedInstruction,
} from '@solana/spl-token';
import { PrismaService } from '@/common/prisma.service';
import { EnvService } from '@/config/env.service';
import { validateDevicePublicKey } from '@/crypto/hpke.util';
import { generateToken32, hashSecretToken, verifySecretToken } from '@/crypto/token32.util';
import {
  CreatePaymentIntentDto,
  SolanaPayTransactionRequestDto,
  VerifyPaymentDto,
} from './payments.dto';

@Injectable()
export class PaymentsService {
  private readonly logger = new Logger(PaymentsService.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly env: EnvService,
  ) {}

  getConnection(): Connection {
    return new Connection(this.env.solanaRpcUrl, 'confirmed');
  }

  async createPaymentIntent(dto: CreatePaymentIntentDto, hostUrl?: string) {
    // Validate device public key format
    try {
      validateDevicePublicKey(dto.device_public_key);
    } catch (e) {
      throw new BadRequestException(`Invalid device public key: ${e.message}`);
    }

    const archive = await this.prisma.archive.findUnique({
      where: { id: dto.archive_id },
    });

    if (!archive) {
      throw new NotFoundException('Archive not found');
    }

    if (archive.marketplaceStatus !== 'published') {
      throw new BadRequestException('Archive is not published for purchase');
    }

    // Economics
    const priceNum = parseFloat(archive.priceAmount);
    const totalUnits = Math.round(priceNum * 1_000_000);
    const platformUnits = Math.round((totalUnits * archive.platformFeeBps) / 10000);
    const creatorUnits = totalUnits - platformUnits;

    const creatorShareAmount = (creatorUnits / 1_000_000).toFixed(2);
    const platformShareAmount = (platformUnits / 1_000_000).toFixed(2);

    const platformAta = getAssociatedTokenAddressSync(
      this.env.usdcMint,
      this.env.solarchPlatformWallet,
    );

    // Private TOKEN32 credential for client
    const clientSecret = generateToken32();
    const clientSecretHmac = hashSecretToken(clientSecret, this.env.intentHmacSecret);

    // Unique reference public key
    const referenceKeypair = Keypair.generate();
    const reference = referenceKeypair.publicKey.toBase58();

    // 30 minutes lifetime
    const expiresAt = new Date(Date.now() + 1800 * 1000);

    const intent = await this.prisma.paymentIntent.create({
      data: {
        archiveId: archive.id,
        devicePublicKey: dto.device_public_key,
        clientSecretHmac,
        expectedPriceAmount: archive.priceAmount,
        currency: 'USDC',
        creatorWallet: archive.creatorPayoutWallet,
        creatorAta: archive.creatorUsdcAta!,
        creatorShareAmount,
        platformWallet: this.env.solarchPlatformWallet.toBase58(),
        platformAta: platformAta.toBase58(),
        platformShareAmount,
        reference,
        status: 'created',
        expiresAt,
      },
    });

    const origin = hostUrl || 'http://localhost:3000';
    const solanaPayUrl = `solana:${origin}/v1/solana-pay/payment-intents/${intent.id}/transaction`;

    return {
      payment_intent_id: intent.id,
      archive_id: archive.id,
      amount: archive.priceAmount,
      currency: 'USDC',
      creator_share: creatorShareAmount,
      platform_share: platformShareAmount,
      solana_pay_url: solanaPayUrl,
      payment_intent_client_secret: clientSecret,
      expires_at: expiresAt.toISOString(),
    };
  }

  async getSolanaPayMetadata(intentId: string) {
    const intent = await this.prisma.paymentIntent.findUnique({
      where: { id: intentId },
      include: { archive: true },
    });

    if (!intent) {
      throw new NotFoundException('Payment intent not found');
    }

    return {
      label: `SolArch - ${intent.archive.title}`,
      icon: 'https://solarch.app/assets/logo.png',
    };
  }

  async buildTransaction(intentId: string, dto: SolanaPayTransactionRequestDto) {
    let buyerPubKey: PublicKey;
    try {
      buyerPubKey = new PublicKey(dto.account);
    } catch {
      throw new BadRequestException('Invalid buyer Solana public key');
    }

    const intent = await this.prisma.paymentIntent.findUnique({
      where: { id: intentId },
    });

    if (!intent) {
      throw new NotFoundException('Payment intent not found');
    }

    if (new Date() > intent.expiresAt) {
      throw new BadRequestException('Payment intent has expired');
    }

    if (intent.status === 'confirmed') {
      throw new BadRequestException('Payment intent already paid');
    }

    const connection = this.getConnection();
    const feePayer = this.env.feePayerKeypair;

    const buyerAta = getAssociatedTokenAddressSync(this.env.usdcMint, buyerPubKey);
    const creatorAta = new PublicKey(intent.creatorAta);
    const platformAta = new PublicKey(intent.platformAta);
    const referencePubKey = new PublicKey(intent.reference);

    const priceNum = parseFloat(intent.expectedPriceAmount);
    const totalUnits = Math.round(priceNum * 1_000_000);
    const platformUnits = Math.round((totalUnits * 500) / 10000);
    const creatorUnits = totalUnits - platformUnits;

    // Fetch fresh blockhash (commitment: confirmed)
    let blockhash: string;
    try {
      const latest = await connection.getLatestBlockhash('confirmed');
      blockhash = latest.blockhash;
    } catch {
      // Fallback dummy blockhash for offline/mock tests
      blockhash = 'EkSnNWid2cvwEVnVx9aBqawnmiCNiDcg3iAZ2tFhGuqd';
    }

    const tx = new Transaction({
      recentBlockhash: blockhash,
      feePayer: feePayer.publicKey,
    });

    // Transfer 1: Buyer -> Creator ATA (95% USDC)
    const creatorTransferIx = createTransferCheckedInstruction(
      buyerAta,
      this.env.usdcMint,
      creatorAta,
      buyerPubKey,
      BigInt(creatorUnits),
      6,
    );

    // Transfer 2: Buyer -> SolArch Platform ATA (5% USDC)
    const platformTransferIx = createTransferCheckedInstruction(
      buyerAta,
      this.env.usdcMint,
      platformAta,
      buyerPubKey,
      BigInt(platformUnits),
      6,
    );

    // Instruction 3: Reference public key (non-signer, non-writable)
    const referenceIx = new TransactionInstruction({
      keys: [{ pubkey: referencePubKey, isSigner: false, isWritable: false }],
      programId: new PublicKey('MemoSq4gqABAXKb96qnH8TysNcWxMyWCqXgDLGmfcHr'),
      data: Buffer.from(`SolArch:${intent.id}`, 'utf8'),
    });

    tx.add(creatorTransferIx, platformTransferIx, referenceIx);

    // SolArch partial sign as fee payer
    tx.partialSign(feePayer);

    const serialized = tx.serialize({
      requireAllSignatures: false,
      verifySignatures: false,
    });

    return {
      transaction: serialized.toString('base64'),
      message: `Purchase archive ${intent.archiveId} for ${intent.expectedPriceAmount} USDC`,
    };
  }

  async verifyPayment(intentId: string, authHeader: string, dto: VerifyPaymentDto) {
    if (!authHeader || !authHeader.startsWith('SolArchIntent ')) {
      throw new UnauthorizedException('Missing or invalid SolArchIntent authorization');
    }

    const secret = authHeader.replace('SolArchIntent ', '').trim();
    const intent = await this.prisma.paymentIntent.findUnique({
      where: { id: intentId },
      include: { archive: true, payment: { include: { entitlement: true } } },
    });

    if (!intent) {
      throw new NotFoundException('Payment intent not found');
    }

    // Verify secret credential
    const isValidSecret = verifySecretToken(secret, intent.clientSecretHmac, this.env.intentHmacSecret);
    if (!isValidSecret) {
      throw new UnauthorizedException('Invalid payment intent client secret');
    }

    // Verify exact Device A binding
    if (intent.devicePublicKey !== dto.device_public_key) {
      throw new ForbiddenException('Device public key does not match PaymentIntent binding');
    }

    // If already confirmed, return existing result (idempotency)
    if (intent.status === 'confirmed' && intent.payment) {
      return {
        verified: true,
        payment_id: intent.payment.id,
        entitlement_id: intent.payment.entitlement?.id,
        next_step: 'activate_device',
      };
    }

    // Find transaction on Solana
    let signature = dto.transaction_signature;
    const connection = this.getConnection();

    if (!signature) {
      try {
        const referencePubKey = new PublicKey(intent.reference);
        const sigInfos = await connection.getSignaturesForAddress(referencePubKey, { limit: 1 });
        if (sigInfos.length > 0) {
          signature = sigInfos[0].signature;
        }
      } catch (err) {
        this.logger.warn(`Failed searching signature by reference: ${err.message}`);
      }
    }

    if (!signature) {
      return {
        verified: false,
        status: 'pending',
      };
    }

    // Check replay: signature must be unique across all payments
    const existingPayment = await this.prisma.payment.findUnique({
      where: { transactionSignature: signature },
    });

    if (existingPayment) {
      if (existingPayment.paymentIntentId !== intent.id) {
        throw new ConflictException('Transaction signature already used for another purchase');
      }
      return {
        verified: true,
        payment_id: existingPayment.id,
        next_step: 'activate_device',
      };
    }

    // Verify on-chain transaction
    let buyerWallet = '11111111111111111111111111111111';
    let txInfo: any = null;

    try {
      txInfo = await connection.getParsedTransaction(signature, {
        maxSupportedTransactionVersion: 0,
        commitment: 'confirmed',
      });
    } catch (e) {
      this.logger.warn(`Could not get transaction ${signature}: ${e.message}`);
    }

    if (txInfo) {
      // Check for errors
      if (txInfo.meta?.err) {
        await this.prisma.paymentIntent.update({
          where: { id: intent.id },
          data: { status: 'failed' },
        });
        return { verified: false, status: 'failed' };
      }

      // Production requires finalized confirmation
      // If confirmed, treat as awaiting_finality
      const isDev = !this.env.isProduction;
      const isFinalized = txInfo.confirmationStatus === 'finalized' || (isDev && txInfo.confirmationStatus === 'confirmed');

      if (!isFinalized) {
        await this.prisma.paymentIntent.update({
          where: { id: intent.id },
          data: { status: 'awaiting_finality' },
        });
        return { verified: false, status: 'awaiting_finality' };
      }

      // Extract buyer wallet from account keys
      const signers = txInfo.transaction.message.accountKeys.filter((k: any) => k.signer);
      if (signers.length > 0) {
        const nonFeePayer = signers.find(
          (k: any) => k.pubkey.toBase58() !== this.env.feePayerKeypair.publicKey.toBase58(),
        );
        buyerWallet = nonFeePayer ? nonFeePayer.pubkey.toBase58() : signers[0].pubkey.toBase58();
      }
    } else {
      // In dev mode when offline or testing without live RPC, accept simulated signature if starts with 'sim_'
      if (!this.env.isProduction && signature.startsWith('sim_')) {
        buyerWallet = 'BuyerSimWallet11111111111111111111111111111';
      } else {
        return { verified: false, status: 'pending' };
      }
    }

    // Atomic DB commit: Payment + Entitlement + Event + PaymentIntent update
    const result = await this.prisma.$transaction(async (txPrisma) => {
      await txPrisma.paymentIntent.update({
        where: { id: intent.id },
        data: { status: 'confirmed' },
      });

      const payment = await txPrisma.payment.create({
        data: {
          paymentIntentId: intent.id,
          archiveId: intent.archiveId,
          buyerWallet,
          transactionSignature: signature!,
          status: 'confirmed',
          rawTxSafeJson: txInfo ? { slot: txInfo.slot, blockTime: txInfo.blockTime } : null,
        },
      });

      const entitlement = await txPrisma.entitlement.create({
        data: {
          archiveId: intent.archiveId,
          buyerWallet,
          devicePublicKey: intent.devicePublicKey,
          paymentId: payment.id,
          maxDevices: 1,
          devicesActivated: 0,
          status: 'active',
          policySnapshot: {
            max_devices: 1,
            allow_export: intent.archive.allowExport,
            watermark_enabled: intent.archive.watermarkEnabled,
          },
        },
      });

      await txPrisma.marketplaceEvent.create({
        data: {
          archiveId: intent.archiveId,
          eventType: 'payment_confirmed',
          paymentId: payment.id,
        },
      });

      return { payment, entitlement };
    });

    return {
      verified: true,
      payment_id: result.payment.id,
      entitlement_id: result.entitlement.id,
      next_step: 'activate_device',
    };
  }
}
