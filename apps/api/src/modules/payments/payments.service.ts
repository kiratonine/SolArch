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
  hashIntentClientSecret,
  verifyIntentClientSecret,
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

  async createPaymentIntent(dto: CreatePaymentIntentDto) {
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

    if (archive.marketplaceStatus !== 'published' || archive.technicalStatus !== 'ready') {
      throw new BadRequestException('Archive is not available for purchase');
    }

    // Economics (USDC 6 decimals)
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

    // Private TOKEN32 credential for client with purpose-separated domain and pepper
    const clientSecret = generateToken32();
    const clientSecretHmac = hashIntentClientSecret(clientSecret, this.env.intentHmacSecret);

    // Unique reference public key (canonical Solana Base58 32 bytes)
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

    // Use explicit validated HTTPS origin from EnvService (never untrusted Host header)
    const solanaPayUrl = `solana:${this.env.publicApiOrigin}/v1/solana-pay/payment-intents/${intent.id}/transaction`;

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

    if (
      !intent ||
      intent.archive.marketplaceStatus !== 'published' ||
      intent.archive.technicalStatus !== 'ready'
    ) {
      throw new NotFoundException({
        code: 'PAYMENT_INTENT_NOT_AVAILABLE',
        message: 'Payment intent not available',
      });
    }

    if (new Date() >= intent.expiresAt) {
      throw new HttpException(
        {
          code: 'PAYMENT_INTENT_EXPIRED',
          message: 'Payment intent has expired',
        },
        HttpStatus.GONE,
      );
    }

    // Exact Solana Pay metadata object (API §7.1)
    return {
      label: 'SolArch',
      icon: `${this.env.publicApiOrigin}/assets/solarch-pay-icon.png`,
    };
  }

  async buildTransaction(intentId: string, dto: SolanaPayTransactionRequestDto) {
    let buyerPubKey: PublicKey;
    try {
      if (!dto.account || typeof dto.account !== 'string') {
        throw new Error('Account must be a string');
      }
      buyerPubKey = new PublicKey(dto.account);
      if (buyerPubKey.toBase58() !== dto.account) {
        throw new Error('Non-canonical Solana address');
      }
    } catch {
      throw new BadRequestException({
        code: 'INVALID_PAYMENT_ACCOUNT',
        message: 'Invalid payment account Solana public key',
      });
    }

    const intent = await this.prisma.paymentIntent.findUnique({
      where: { id: intentId },
      include: { archive: true },
    });

    if (
      !intent ||
      intent.archive.marketplaceStatus !== 'published' ||
      intent.archive.technicalStatus !== 'ready'
    ) {
      throw new NotFoundException({
        code: 'PAYMENT_INTENT_NOT_AVAILABLE',
        message: 'Payment intent not available',
      });
    }

    if (new Date() >= intent.expiresAt) {
      throw new HttpException(
        {
          code: 'PAYMENT_INTENT_EXPIRED',
          message: 'Payment intent has expired',
        },
        HttpStatus.GONE,
      );
    }

    if (intent.status === 'confirmed') {
      throw new ConflictException({
        code: 'PAYMENT_TRANSACTION_IN_FLIGHT',
        message: 'Payment intent already confirmed',
      });
    }

    const connection = this.getConnection();

    // Check existing active issuance for this intent
    const activeIssuances = await this.prisma.paymentTransactionIssuance.findMany({
      where: {
        paymentIntentId: intent.id,
        status: 'active',
      },
      orderBy: { issuedAt: 'desc' },
    });

    if (activeIssuances.length > 0) {
      const activeIssuance = activeIssuances[0];
      let isStillValid = false;
      try {
        const check = await connection.isBlockhashValid(activeIssuance.recentBlockhash, {
          commitment: 'confirmed',
        });
        isStillValid = check.value;
      } catch {
        isStillValid = false;
      }

      if (isStillValid) {
        if (activeIssuance.constructionAccount === buyerPubKey.toBase58()) {
          // Same account -> return same transaction idempotently
          return {
            transaction: activeIssuance.serializedTransaction,
            message: `Pay ${Number(intent.expectedPriceAmount).toFixed(2)} USDC to unlock this SolArch archive`,
          };
        } else {
          // Different account during active window -> 409 PAYMENT_TRANSACTION_IN_FLIGHT
          throw new ConflictException({
            code: 'PAYMENT_TRANSACTION_IN_FLIGHT',
            message: 'Another payment transaction is in flight for this payment intent',
          });
        }
      } else {
        // Do not reissue simply because isBlockhashValid is false if transaction could have landed on-chain!
        let hasLanded = false;
        try {
          const refSigs = await connection.getSignaturesForAddress(new PublicKey(intent.reference), {
            limit: 1,
          });
          if (refSigs && refSigs.length > 0) {
            const statusRes = await connection.getSignatureStatuses([refSigs[0].signature], {
              searchTransactionHistory: true,
            });
            const sigStatus = statusRes?.value?.[0];
            if (sigStatus && !sigStatus.err) {
              hasLanded = true;
            }
          }
        } catch (e) {
          this.logger.warn(`Reference landing check error: ${e.message}`);
        }

        if (hasLanded) {
          throw new ConflictException({
            code: 'PAYMENT_TRANSACTION_IN_FLIGHT',
            message: 'A payment transaction has landed on chain and is awaiting finality',
          });
        }

        // Conclusively no longer payable: mark old issuance expired
        await this.prisma.paymentTransactionIssuance.update({
          where: { id: activeIssuance.id },
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
      throw new ServiceUnavailableException({
        code: 'PAYMENT_TRANSACTION_UNAVAILABLE',
        message: 'Solana RPC unavailable for transaction blockhash',
      });
    }

    const tx = new Transaction({
      recentBlockhash: latest.blockhash,
      feePayer: feePayer.publicKey,
    });

    // Instruction 1: Buyer -> Creator ATA (95% USDC)
    const creatorTransferIx = createTransferCheckedInstruction(
      buyerAta,
      this.env.usdcMint,
      creatorAta,
      buyerPubKey,
      BigInt(creatorUnits),
      6,
    );

    // Instruction 2: Buyer -> SolArch Platform ATA (5% USDC)
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

    // SolArch partial sign as fee payer (first required signer slot)
    tx.partialSign(feePayer);

    const messageBytes = tx.compileMessage().serialize();
    const transactionMessageHash = createHash('sha256').update(messageBytes).digest('hex').toLowerCase();

    const serialized = tx.serialize({
      requireAllSignatures: false,
      verifySignatures: false,
    }).toString('base64');

    // Atomically deactivate prior issuances and record new active issuance
    await this.prisma.$transaction(async (txPrisma) => {
      await txPrisma.paymentTransactionIssuance.updateMany({
        where: { paymentIntentId: intent.id, status: 'active' },
        data: { status: 'expired' },
      });

      await txPrisma.paymentTransactionIssuance.create({
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

      if (intent.status === 'created') {
        await txPrisma.paymentIntent.update({
          where: { id: intent.id },
          data: { status: 'pending' },
        });
      }
    });

    return {
      transaction: serialized,
      message: `Pay ${Number(intent.expectedPriceAmount).toFixed(2)} USDC to unlock this SolArch archive`,
    };
  }

  async verifyPayment(intentId: string, authHeader: string, dto: VerifyPaymentDto) {
    // 1. Mandatory credential authentication precedence (API §9.1, §10)
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

    const isValidSecret = verifyIntentClientSecret(secret, intent.clientSecretHmac, this.env.intentHmacSecret);
    if (!isValidSecret) {
      throw new UnauthorizedException({
        code: 'INVALID_INTENT_CREDENTIAL',
        message: 'Invalid payment intent client secret',
      });
    }

    // 2. Resource & binding validations after credential authentication
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

    if (intent.status === 'failed') {
      throw new HttpException(
        { code: 'PAYMENT_FAILED', message: 'Payment intent failed' },
        HttpStatus.FORBIDDEN,
      );
    }

    // 3. Find candidate transaction signature
    let signature = dto.transaction_signature;
    if (signature) {
      if (signature.startsWith('sim_')) {
        throw new BadRequestException({
          code: 'INVALID_REQUEST',
          message: 'Simulated payment signatures are strictly rejected',
        });
      }
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
      // If intent TTL passed and no signature / candidate exists
      if (new Date() > intent.expiresAt) {
        await this.prisma.paymentIntent.update({
          where: { id: intent.id },
          data: { status: 'expired' },
        });
        throw new HttpException(
          { code: 'PAYMENT_INTENT_EXPIRED', message: 'Payment intent has expired' },
          HttpStatus.GONE,
        );
      }
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

    // 4. Authoritative Solana Finality Check
    // getParsedTransaction() does NOT contain confirmationStatus; use getSignatureStatuses
    let statusRes: any = null;
    try {
      statusRes = await connection.getSignatureStatuses([signature], {
        searchTransactionHistory: true,
      });
    } catch (err) {
      this.logger.warn(`Solana RPC error checking signature status: ${err.message}`);
      throw new ServiceUnavailableException({
        code: 'BACKEND_UNAVAILABLE',
        message: 'Solana RPC unavailable for signature verification',
      });
    }

    const sigStatus = statusRes?.value?.[0];
    if (!sigStatus) {
      // Transaction not yet visible on chain
      if (new Date() > intent.expiresAt) {
        await this.prisma.paymentIntent.update({
          where: { id: intent.id },
          data: { status: 'expired' },
        });
        throw new HttpException(
          { code: 'PAYMENT_INTENT_EXPIRED', message: 'Payment intent has expired' },
          HttpStatus.GONE,
        );
      }
      return { verified: false, status: 'pending' };
    }

    // Check for execution error on chain
    if (sigStatus.err) {
      // Mark issuance failed, but do NOT terminal-fail intent if reissue is allowed
      await this.prisma.paymentTransactionIssuance.updateMany({
        where: { paymentIntentId: intent.id, status: 'active' },
        data: { status: 'failed' },
      });

      if (new Date() < intent.expiresAt) {
        return { verified: false, status: 'pending' };
      } else {
        await this.prisma.paymentIntent.update({
          where: { id: intent.id },
          data: { status: 'failed' },
        });
        throw new HttpException(
          { code: 'PAYMENT_FAILED', message: 'Transaction execution failed on chain' },
          HttpStatus.FORBIDDEN,
        );
      }
    }

    // Strict Finality: only 'finalized' commitment proceeds to confirmation
    if (sigStatus.confirmationStatus !== 'finalized') {
      await this.prisma.paymentIntent.update({
        where: { id: intent.id },
        data: { status: 'awaiting_finality' },
      });
      return { verified: false, status: 'awaiting_finality' };
    }

    // 5. Authoritative transaction fetch under commitment: finalized
    let txInfo: any = null;
    let rawTx: any = null;
    try {
      [txInfo, rawTx] = await Promise.all([
        connection.getParsedTransaction(signature, {
          maxSupportedTransactionVersion: 0,
          commitment: 'finalized',
        }),
        connection.getTransaction(signature, {
          maxSupportedTransactionVersion: 0,
          commitment: 'finalized',
        }),
      ]);
    } catch (e) {
      this.logger.warn(`Failed to fetch finalized transaction data for ${signature}: ${e.message}`);
      throw new ServiceUnavailableException({
        code: 'BACKEND_UNAVAILABLE',
        message: 'Unable to fetch finalized transaction from Solana RPC',
      });
    }

    if (!txInfo || !rawTx || !rawTx.transaction?.message) {
      this.logger.warn(`Finalized transaction not returned by RPC for ${signature}`);
      throw new ServiceUnavailableException({
        code: 'BACKEND_UNAVAILABLE',
        message: 'Finalized transaction data unavailable from RPC',
      });
    }

    if (txInfo.meta?.err) {
      await this.prisma.paymentTransactionIssuance.updateMany({
        where: { paymentIntentId: intent.id, status: 'active' },
        data: { status: 'failed' },
      });
      return { verified: false, status: 'pending' };
    }

    // 6. Verification Checklist on Finalized Transaction
    // Exact transaction message SHA-256 matching recorded issuance (fail closed if unavailable)
    const messageBytes = rawTx.transaction.message.serialize();
    const onChainMessageHash = createHash('sha256').update(messageBytes).digest('hex').toLowerCase();

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

    // Verify landing <= recorded lastValidBlockHeight
    if (rawTx.blockHeight !== null && rawTx.blockHeight !== undefined) {
      if (BigInt(rawTx.blockHeight) > matchingIssuance.lastValidBlockHeight) {
        throw new BadRequestException({
          code: 'INVALID_REQUEST',
          message: 'Transaction landed after issuance blockhash validity window',
        });
      }
    }

    // Verify reference key presence in transaction account keys
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
          continue; // Not configured canonical USDC
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

    // Derive buyer wallet from authoritative transaction signers
    let buyerWallet = '11111111111111111111111111111111';
    const signers = txInfo.transaction.message.accountKeys.filter((k: any) => k.signer);
    if (signers.length > 0) {
      const nonFeePayer = signers.find(
        (k: any) => k.pubkey.toBase58() !== this.env.feePayerKeypair.publicKey.toBase58(),
      );
      buyerWallet = nonFeePayer ? nonFeePayer.pubkey.toBase58() : signers[0].pubkey.toBase58();
    }

    // 7. Atomic DB Commit: Payment + Entitlement + MarketplaceEvent + PaymentIntent update
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
