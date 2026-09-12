import {
  Injectable,
  BadRequestException,
  NotFoundException,
  UnauthorizedException,
  ConflictException,
  ServiceUnavailableException,
  HttpException,
  HttpStatus,
  Logger,
} from '@nestjs/common';
import { createHash } from 'crypto';
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
import {
  generateToken32,
  hashSecretToken,
  verifySecretToken,
  validateToken32,
  formatExactSecondUtc,
} from '@/crypto/token32.util';
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

    // Exact second timestamps: 30 minutes lifetime
    const createdAt = new Date(Math.floor(Date.now() / 1000) * 1000);
    const expiresAt = new Date(createdAt.getTime() + 1800 * 1000);

    const intent = await this.prisma.paymentIntent.create({
      data: {
        archiveId: archive.id,
        devicePublicKey: dto.device_public_key,
        clientSecretHmac,
        expectedPriceAmount: Number(archive.priceAmount).toFixed(2),
        currency: 'USDC',
        creatorWallet: archive.creatorPayoutWallet,
        creatorAta: archive.creatorUsdcAta!,
        creatorShareAmount,
        platformWallet: this.env.solarchPlatformWallet.toBase58(),
        platformAta: platformAta.toBase58(),
        platformShareAmount,
        reference,
        status: 'created',
        createdAt,
        expiresAt,
      },
    });

    const origin = hostUrl || 'http://localhost:3000';
    const solanaPayUrl = `solana:${origin}/v1/solana-pay/payment-intents/${intent.id}/transaction`;

    // Strict closed schema matching PaymentIntentResponse in Viewer DTO
    return {
      payment_intent_id: intent.id,
      archive_id: archive.id,
      archive_fingerprint: archive.archiveFingerprint || '',
      device_public_key: dto.device_public_key,
      payment_intent_client_secret: clientSecret,
      amount: Number(archive.priceAmount).toFixed(2),
      currency: 'USDC',
      creator_share: creatorShareAmount,
      platform_share: platformShareAmount,
      payment_reference: reference,
      solana_pay_url: solanaPayUrl,
      created_at: formatExactSecondUtc(createdAt),
      expires_at: formatExactSecondUtc(expiresAt),
      status: 'created',
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
      include: { archive: true },
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

    // Check existing active issuance for this intent & construction account
    const existingIssuance = await this.prisma.paymentTransactionIssuance.findFirst({
      where: {
        paymentIntentId: intent.id,
        constructionAccount: buyerPubKey.toBase58(),
        status: 'active',
      },
      orderBy: { issuedAt: 'desc' },
    });

    if (existingIssuance) {
      let isStillValid = false;
      try {
        const check = await connection.isBlockhashValid(existingIssuance.recentBlockhash, {
          commitment: 'confirmed',
        });
        isStillValid = check.value;
      } catch {
        isStillValid = false;
      }

      if (isStillValid) {
        return {
          transaction: existingIssuance.serializedTransaction,
          message: `Purchase archive ${intent.archiveId} for ${intent.expectedPriceAmount} USDC`,
        };
      } else {
        await this.prisma.paymentTransactionIssuance.update({
          where: { id: existingIssuance.id },
          data: { status: 'expired' },
        });
      }
    }

    const feePayer = this.env.feePayerKeypair;
    const buyerAta = getAssociatedTokenAddressSync(this.env.usdcMint, buyerPubKey);
    const creatorAta = new PublicKey(intent.creatorAta);
    const platformAta = new PublicKey(intent.platformAta);
    const referencePubKey = new PublicKey(intent.reference);

    const priceNum = parseFloat(intent.expectedPriceAmount);
    const totalUnits = Math.round(priceNum * 1_000_000);
    const platformUnits = Math.round((totalUnits * 500) / 10000);
    const creatorUnits = totalUnits - platformUnits;

    // Fetch fresh blockhash (commitment: confirmed) - Fail closed on RPC error
    let latest: { blockhash: string; lastValidBlockHeight: number };
    try {
      latest = await connection.getLatestBlockhash('confirmed');
    } catch (err) {
      this.logger.error(`RPC error fetching latest blockhash: ${err.message}`);
      throw new ServiceUnavailableException('Solana RPC unavailable for transaction blockhash');
    }

    const tx = new Transaction({
      recentBlockhash: latest.blockhash,
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

    const messageBytes = tx.compileMessage().serialize();
    const transactionMessageHash = createHash('sha256').update(messageBytes).digest('hex').toLowerCase();

    const serialized = tx.serialize({
      requireAllSignatures: false,
      verifySignatures: false,
    }).toString('base64');

    // Deactivate any earlier active issuances for this intent
    await this.prisma.paymentTransactionIssuance.updateMany({
      where: { paymentIntentId: intent.id, status: 'active' },
      data: { status: 'expired' },
    });

    // Save frozen issuance record
    await this.prisma.paymentTransactionIssuance.create({
      data: {
        paymentIntentId: intent.id,
        constructionAccount: buyerPubKey.toBase58(),
        transactionMessageHash,
        recentBlockhash: latest.blockhash,
        lastValidBlockHeight: BigInt(latest.lastValidBlockHeight),
        serializedTransaction: serialized,
        status: 'active',
      },
    });

    return {
      transaction: serialized,
      message: `Purchase archive ${intent.archiveId} for ${intent.expectedPriceAmount} USDC`,
    };
  }

  async verifyPayment(intentId: string, authHeader: string, dto: VerifyPaymentDto) {
    // 1. Mandatory credential authentication precedence
    if (!authHeader || !authHeader.startsWith('SolArchIntent ')) {
      throw new UnauthorizedException({
        code: 'INVALID_INTENT_CREDENTIAL',
        message: 'Missing or invalid SolArchIntent authorization header',
      });
    }

    const secret = authHeader.replace('SolArchIntent ', '').trim();
    if (!validateToken32(secret)) {
      throw new UnauthorizedException({
        code: 'INVALID_INTENT_CREDENTIAL',
        message: 'Invalid payment intent client secret format',
      });
    }

    const intent = await this.prisma.paymentIntent.findUnique({
      where: { id: intentId },
      include: { archive: true, payment: { include: { entitlement: true } } },
    });

    if (!intent) {
      throw new UnauthorizedException({
        code: 'INVALID_INTENT_CREDENTIAL',
        message: 'Invalid payment intent credential',
      });
    }

    const isValidSecret = verifySecretToken(secret, intent.clientSecretHmac, this.env.intentHmacSecret);
    if (!isValidSecret) {
      throw new UnauthorizedException({
        code: 'INVALID_INTENT_CREDENTIAL',
        message: 'Invalid payment intent client secret',
      });
    }

    // 2. Resource & binding validations after credential authentication
    if (new Date() > intent.expiresAt) {
      throw new HttpException(
        { code: 'PAYMENT_INTENT_EXPIRED', message: 'Payment intent has expired' },
        HttpStatus.GONE,
      );
    }

    // Exact Device A binding: Conflict 409
    if (intent.devicePublicKey !== dto.device_public_key) {
      throw new ConflictException({
        code: 'DEVICE_BINDING_MISMATCH',
        message: 'Device public key does not match PaymentIntent binding',
      });
    }

    // Idempotency: If already confirmed, return closed confirmed response
    if (intent.status === 'confirmed' && intent.payment) {
      return {
        verified: true,
        status: 'confirmed',
        payment_id: intent.payment.id,
        entitlement_id: intent.payment.entitlement?.id,
        archive_id: intent.archiveId,
        archive_fingerprint: intent.archive.archiveFingerprint || '',
        device_public_key: intent.devicePublicKey,
        next_step: 'activate_device',
      };
    }

    // 3. Find transaction on Solana
    let signature = dto.transaction_signature;
    if (signature && signature.startsWith('sim_')) {
      throw new BadRequestException({
        code: 'INVALID_REQUEST',
        message: 'Simulated payment signatures are strictly rejected',
      });
    }

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
        throw new ConflictException({
          code: 'INVALID_REQUEST',
          message: 'Transaction signature already used for another purchase',
        });
      }
      return {
        verified: true,
        status: 'confirmed',
        payment_id: existingPayment.id,
        entitlement_id: intent.payment?.entitlement?.id,
        archive_id: intent.archiveId,
        archive_fingerprint: intent.archive.archiveFingerprint || '',
        device_public_key: intent.devicePublicKey,
        next_step: 'activate_device',
      };
    }

    // 4. Verify on-chain transaction
    let txInfo: any = null;
    try {
      txInfo = await connection.getParsedTransaction(signature, {
        maxSupportedTransactionVersion: 0,
        commitment: 'confirmed',
      });
    } catch (e) {
      this.logger.warn(`Could not get transaction ${signature}: ${e.message}`);
    }

    if (!txInfo) {
      return { verified: false, status: 'pending' };
    }

    // Check for transaction execution error
    if (txInfo.meta?.err) {
      await this.prisma.paymentIntent.update({
        where: { id: intent.id },
        data: { status: 'failed' },
      });
      return { verified: false, status: 'pending' };
    }

    // Strict Finality: Only authoritative 'finalized' commitment confirms payment
    if (txInfo.confirmationStatus !== 'finalized') {
      await this.prisma.paymentIntent.update({
        where: { id: intent.id },
        data: { status: 'awaiting_finality' },
      });
      return { verified: false, status: 'awaiting_finality' };
    }

    // 5. Verification checklist on finalized transaction
    // Exact transaction message SHA-256 matching recorded issuance
    let onChainMessageHash: string | null = null;
    try {
      const rawTx = await connection.getTransaction(signature, {
        maxSupportedTransactionVersion: 0,
        commitment: 'finalized',
      });
      if (rawTx?.transaction?.message) {
        const messageBytes = rawTx.transaction.message.serialize();
        onChainMessageHash = createHash('sha256').update(messageBytes).digest('hex').toLowerCase();
      }
    } catch (e) {
      this.logger.warn(`Could not fetch raw transaction message for ${signature}: ${e.message}`);
    }

    if (onChainMessageHash) {
      const matchingIssuance = await this.prisma.paymentTransactionIssuance.findFirst({
        where: {
          paymentIntentId: intent.id,
          transactionMessageHash: onChainMessageHash,
        },
      });

      if (!matchingIssuance) {
        this.logger.warn(
          `Transaction message hash ${onChainMessageHash} does not match any Backend issuance for intent ${intent.id}`,
        );
        throw new BadRequestException({
          code: 'INVALID_REQUEST',
          message: 'Transaction message does not match any issued PaymentIntent transaction',
        });
      }
    }

    // Verify reference key presence
    const accountKeyStrings = txInfo.transaction?.message?.accountKeys?.map((k: any) =>
      typeof k === 'string' ? k : k.pubkey?.toBase58?.() || k.pubkey?.toString?.() || String(k),
    ) || [];

    if (intent.reference && !accountKeyStrings.includes(intent.reference)) {
      throw new BadRequestException({
        code: 'INVALID_REQUEST',
        message: 'Transaction does not contain the required PaymentIntent reference',
      });
    }

    // Verify 95/5 USDC split token transfer instructions
    const priceNum = parseFloat(intent.expectedPriceAmount);
    const totalUnits = Math.round(priceNum * 1_000_000);
    const platformUnits = Math.round((totalUnits * 500) / 10000);
    const creatorUnits = totalUnits - platformUnits;

    const allInstructions = [
      ...(txInfo.transaction?.message?.instructions || []),
      ...(txInfo.meta?.innerInstructions?.flatMap((i: any) => i.instructions) || []),
    ];

    const usdcMintStr = this.env.usdcMint.toBase58();
    let foundCreatorTransfer = false;
    let foundPlatformTransfer = false;

    for (const ix of allInstructions) {
      if (ix.parsed && (ix.parsed.type === 'transfer' || ix.parsed.type === 'transferChecked')) {
        const info = ix.parsed.info;
        const dest = info?.destination;
        const amount = BigInt(info?.amount || info?.tokenAmount?.amount || 0);
        const mint = info?.mint;

        if (mint && mint !== usdcMintStr) {
          continue; // Not configured USDC
        }

        if (dest === intent.creatorAta && amount === BigInt(creatorUnits)) {
          foundCreatorTransfer = true;
        }
        if (dest === intent.platformAta && amount === BigInt(platformUnits)) {
          foundPlatformTransfer = true;
        }
      }
    }

    const hasParsedInstructions = allInstructions.some((i: any) => i.parsed);
    if (hasParsedInstructions) {
      if (!foundCreatorTransfer || !foundPlatformTransfer) {
        throw new BadRequestException({
          code: 'INVALID_REQUEST',
          message: 'Transaction does not contain valid 95/5 USDC split transfers',
        });
      }
    }

    // Derive buyer wallet from authoritative signers
    let buyerWallet = '11111111111111111111111111111111';
    const signers = txInfo.transaction.message.accountKeys.filter((k: any) => k.signer);
    if (signers.length > 0) {
      const nonFeePayer = signers.find(
        (k: any) => k.pubkey.toBase58() !== this.env.feePayerKeypair.publicKey.toBase58(),
      );
      buyerWallet = nonFeePayer ? nonFeePayer.pubkey.toBase58() : signers[0].pubkey.toBase58();
    }

    // 6. Atomic DB commit: Payment + Entitlement + Event + PaymentIntent update
    const result = await this.prisma.$transaction(async (txPrisma) => {
      await txPrisma.paymentTransactionIssuance.updateMany({
        where: { paymentIntentId: intent.id, status: 'active' },
        data: { status: 'consumed' },
      });

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

    // Exact VerifyConfirmedResponse
    return {
      verified: true,
      status: 'confirmed',
      payment_id: result.payment.id,
      entitlement_id: result.entitlement.id,
      archive_id: intent.archiveId,
      archive_fingerprint: intent.archive.archiveFingerprint || '',
      device_public_key: intent.devicePublicKey,
      next_step: 'activate_device',
    };
  }
}

