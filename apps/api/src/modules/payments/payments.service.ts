import {
  Injectable,
  BadRequestException,
  NotFoundException,
  UnauthorizedException,
  ForbiddenException,
  ConflictException,
  ServiceUnavailableException,
  HttpException,
  HttpStatus,
  Logger,
} from '@nestjs/common';
import { createHash } from 'crypto';
import bs58 from 'bs58';
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

  private async lockPaymentIntent(tx: any, intentId: string): Promise<void> {
    await tx.$queryRaw`SELECT "id" FROM "payment_intents" WHERE "id" = ${intentId} FOR UPDATE`;
  }

  private invalidIntentCredential(): UnauthorizedException {
    return new UnauthorizedException({
      code: 'INVALID_INTENT_CREDENTIAL',
      message: 'Invalid payment intent credential',
    });
  }

  private isCanonicalTransactionSignature(value: string): boolean {
    try {
      if (typeof value !== 'string' || value.length === 0 || value.trim() !== value) {
        return false;
      }
      const decoded = bs58.decode(value);
      return decoded.length === 64 && bs58.encode(decoded) === value;
    } catch {
      return false;
    }
  }

  private canonicalTransactionSignature(value: string): string {
    if (!this.isCanonicalTransactionSignature(value)) {
      throw new BadRequestException({
        code: 'INVALID_REQUEST',
        message: 'transaction_signature must be canonical Base58 for exactly 64 bytes',
      });
    }
    return value;
  }

  private signatureFromSerializedTransaction(serializedTransaction: string): string {
    try {
      const bytes = Buffer.from(serializedTransaction, 'base64');
      if (bytes.length === 0 || bytes.toString('base64') !== serializedTransaction) {
        throw new Error('non-canonical transaction');
      }
      const transaction = Transaction.from(bytes);
      const signature = transaction.signature;
      if (!signature || signature.length !== 64) {
        throw new Error('missing fee-payer signature');
      }
      const encoded = bs58.encode(signature);
      if (!this.isCanonicalTransactionSignature(encoded)) {
        throw new Error('invalid stored fee-payer signature');
      }
      return encoded;
    } catch (error) {
      if (error instanceof BadRequestException) throw error;
      throw new ServiceUnavailableException({
        code: 'PAYMENT_TRANSACTION_UNAVAILABLE',
        message: 'Stored payment issuance is unavailable',
      });
    }
  }

  private async requireExpectedSignature(tx: any, issuance: any): Promise<string> {
    if (issuance.expectedTransactionSignature) {
      if (!this.isCanonicalTransactionSignature(issuance.expectedTransactionSignature)) {
        throw new ServiceUnavailableException({
          code: 'PAYMENT_TRANSACTION_UNAVAILABLE',
          message: 'Stored payment issuance signature is invalid',
        });
      }
      return issuance.expectedTransactionSignature;
    }
    const signature = this.signatureFromSerializedTransaction(issuance.serializedTransaction);
    await tx.paymentTransactionIssuance.update({
      where: { id: issuance.id },
      data: { expectedTransactionSignature: signature },
    });
    return signature;
  }

  private async issuanceChainState(
    connection: Connection,
    signature: string,
    lastValidBlockHeight: bigint,
  ): Promise<'payable' | 'landed' | 'failed' | 'expired'> {
    try {
      const statuses = await connection.getSignatureStatuses([signature], {
        searchTransactionHistory: true,
      });
      const status = statuses?.value?.[0];
      if (status) {
        if (!status.err) return 'landed';
        if (status.confirmationStatus === 'finalized') return 'failed';
        // A processed/confirmed result is reorgable even when it currently
        // carries an error. It cannot retire this exact issuance or authorize
        // a replacement transaction before authoritative finalization.
        return 'payable';
      }
      const finalizedBlockHeight = await connection.getBlockHeight('finalized');
      return BigInt(finalizedBlockHeight) > lastValidBlockHeight ? 'expired' : 'payable';
    } catch (error) {
      this.logger.warn(`Unable to arbitrate stored payment issuance: ${error.message}`);
      throw new ServiceUnavailableException({
        code: 'PAYMENT_TRANSACTION_UNAVAILABLE',
        message: 'Solana RPC unavailable for payment issuance arbitration',
      });
    }
  }

  private assertArchivePaymentPolicy(archive: any): void {
    if (
      archive.priceCurrency !== 'USDC' ||
      archive.platformFeeBps !== 500 ||
      archive.maxDevices !== 1 ||
      archive.allowExport !== false ||
      archive.watermarkEnabled !== true
    ) {
      throw new BadRequestException({
        code: 'INVALID_REQUEST',
        message: 'Archive policy does not match the frozen MVP payment policy',
      });
    }
  }

  private assertArchiveFingerprintSnapshot(intent: any): void {
    if (
      !/^[0-9a-f]{64}$/.test(intent.archiveFingerprint || '') ||
      intent.archive?.archiveFingerprint !== intent.archiveFingerprint
    ) {
      throw new ServiceUnavailableException({
        code: 'BACKEND_UNAVAILABLE',
        message: 'Archive fingerprint no longer matches the immutable PaymentIntent snapshot',
      });
    }
  }

  private assertConfirmedPaymentBindings(intent: any, payment: any): void {
    if (
      !payment ||
      intent.confirmedBuyerWallet !== payment.buyerWallet ||
      payment.archiveId !== intent.archiveId ||
      payment.devicePublicKey !== intent.devicePublicKey
    ) {
      throw new ServiceUnavailableException({
        code: 'BACKEND_UNAVAILABLE',
        message: 'Confirmed payment audit binding is inconsistent',
      });
    }
  }

  private expiredIntentError(): HttpException {
    return new HttpException(
      { code: 'PAYMENT_INTENT_EXPIRED', message: 'Payment intent has expired' },
      HttpStatus.GONE,
    );
  }

  async createPaymentIntent(dto: CreatePaymentIntentDto) {
    // Validate device public key format
    try {
      await validateDevicePublicKey(dto.device_public_key);
    } catch (e) {
      throw new BadRequestException(`Invalid device public key: ${e.message}`);
    }

    const archive = await this.prisma.archive.findUnique({
      where: { id: dto.archive_id },
    });

    if (!archive) {
      throw new NotFoundException({
        code: 'ARCHIVE_NOT_AVAILABLE',
        message: 'Archive is not available',
      });
    }

    if (archive.marketplaceStatus === 'blocked') {
      throw new ForbiddenException({
        code: 'ARCHIVE_BLOCKED',
        message: 'Archive is blocked',
      });
    }
    if (archive.marketplaceStatus !== 'published' || archive.technicalStatus !== 'ready') {
      throw new NotFoundException({
        code: 'ARCHIVE_NOT_AVAILABLE',
        message: 'Archive is not available',
      });
    }
    this.assertArchivePaymentPolicy(archive);
    if (!/^[0-9a-f]{64}$/.test(archive.archiveFingerprint || '')) {
      throw new ServiceUnavailableException({
        code: 'BACKEND_UNAVAILABLE',
        message: 'Ready archive fingerprint is unavailable',
      });
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
        archiveFingerprint: archive.archiveFingerprint,
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
      archive_fingerprint: intent.archiveFingerprint,
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
      icon: `${this.env.publicApiOrigin}/assets/solarch-pay-icon.svg`,
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
    if (buyerPubKey.equals(this.env.feePayerKeypair.publicKey)) {
      throw new BadRequestException({
        code: 'INVALID_PAYMENT_ACCOUNT',
        message: 'Buyer account must be distinct from the SolArch fee payer',
      });
    }

    const connection = this.getConnection();
    return this.prisma.$transaction(
      async (txPrisma) => {
        await this.lockPaymentIntent(txPrisma, intentId);
        const intent = await txPrisma.paymentIntent.findUnique({
          where: { id: intentId },
          include: { archive: true },
        });
        if (!intent) {
          throw new NotFoundException({
            code: 'PAYMENT_INTENT_NOT_AVAILABLE',
            message: 'Payment intent not available',
          });
        }
        if (new Date() >= intent.expiresAt) {
          let mayStillConfirm = false;
          const activeIssuance = await txPrisma.paymentTransactionIssuance.findFirst({
            where: { paymentIntentId: intent.id, status: 'active' },
            orderBy: { issuedAt: 'desc' },
          });
          if (activeIssuance) {
            try {
              const expectedSignature = await this.requireExpectedSignature(
                txPrisma,
                activeIssuance,
              );
              const chainState = await this.issuanceChainState(
                connection,
                expectedSignature,
                activeIssuance.lastValidBlockHeight,
              );
              mayStillConfirm = chainState === 'payable' || chainState === 'landed';
              if (!mayStillConfirm) {
                await txPrisma.paymentTransactionIssuance.update({
                  where: { id: activeIssuance.id },
                  data: { status: chainState },
                });
              }
            } catch (error) {
              // Public issuance is expired regardless. Failure to prove the
              // issuance closed must preserve pending/awaiting state.
              this.logger.warn(
                `Unable to close expired PaymentIntent issuance ${activeIssuance.id}: ${error.message}`,
              );
              mayStillConfirm = true;
            }
          }
          if (
            !mayStillConfirm &&
            intent.status !== 'confirmed' &&
            intent.status !== 'failed' &&
            intent.status !== 'expired'
          ) {
            await txPrisma.paymentIntent.update({
              where: { id: intent.id },
              data: { status: 'expired' },
            });
          }
          throw this.expiredIntentError();
        }
        if (intent.status === 'confirmed') {
          throw new ConflictException({
            code: 'PAYMENT_TRANSACTION_IN_FLIGHT',
            message: 'Payment intent already confirmed',
          });
        }
        if (
          intent.archive.marketplaceStatus !== 'published' ||
          intent.archive.technicalStatus !== 'ready'
        ) {
          throw new NotFoundException({
            code: 'PAYMENT_INTENT_NOT_AVAILABLE',
            message: 'Payment intent not available',
          });
        }
        this.assertArchivePaymentPolicy(intent.archive);
        this.assertArchiveFingerprintSnapshot(intent);

        const activeIssuance = await txPrisma.paymentTransactionIssuance.findFirst({
          where: { paymentIntentId: intent.id, status: 'active' },
          orderBy: { issuedAt: 'desc' },
        });
        if (activeIssuance) {
          const expectedSignature = await this.requireExpectedSignature(txPrisma, activeIssuance);
          const chainState = await this.issuanceChainState(
            connection,
            expectedSignature,
            activeIssuance.lastValidBlockHeight,
          );
          if (chainState === 'payable' || chainState === 'landed') {
            if (activeIssuance.constructionAccount !== buyerPubKey.toBase58()) {
              throw new ConflictException({
                code: 'PAYMENT_TRANSACTION_IN_FLIGHT',
                message: 'Another payment transaction is in flight for this payment intent',
              });
            }
            return {
              transaction: activeIssuance.serializedTransaction,
              message: `Pay ${Number(intent.expectedPriceAmount).toFixed(2)} USDC to unlock this SolArch archive`,
            };
          }
          await txPrisma.paymentTransactionIssuance.update({
            where: { id: activeIssuance.id },
            data: { status: chainState },
          });
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

        let latest: { blockhash: string; lastValidBlockHeight: number };
        try {
          latest = await connection.getLatestBlockhash('confirmed');
        } catch (error) {
          this.logger.error(`RPC error fetching latest blockhash: ${error.message}`);
          throw new ServiceUnavailableException({
            code: 'PAYMENT_TRANSACTION_UNAVAILABLE',
            message: 'Solana RPC unavailable for transaction blockhash',
          });
        }

        const transaction = new Transaction({
          recentBlockhash: latest.blockhash,
          feePayer: feePayer.publicKey,
        });
        transaction.add(
          createTransferCheckedInstruction(
            buyerAta,
            this.env.usdcMint,
            creatorAta,
            buyerPubKey,
            BigInt(creatorUnits),
            6,
          ),
          createTransferCheckedInstruction(
            buyerAta,
            this.env.usdcMint,
            platformAta,
            buyerPubKey,
            BigInt(platformUnits),
            6,
          ),
          new TransactionInstruction({
            keys: [{ pubkey: referencePubKey, isSigner: false, isWritable: false }],
            programId: new PublicKey('MemoSq4gqABAXKb96qnH8TysNcWxMyWCqXgDLGmfcHr'),
            data: Buffer.from(`SolArch:${intent.id}`, 'utf8'),
          }),
        );
        transaction.partialSign(feePayer);
        if (!transaction.verifySignatures(false) || !transaction.signature) {
          throw new ServiceUnavailableException({
            code: 'PAYMENT_TRANSACTION_UNAVAILABLE',
            message: 'SolArch fee-payer signature could not be verified',
          });
        }

        const messageBytes = transaction.compileMessage().serialize();
        const transactionMessageHash = createHash('sha256')
          .update(messageBytes)
          .digest('hex')
          .toLowerCase();
        const expectedTransactionSignature = bs58.encode(transaction.signature);
        const serialized = transaction
          .serialize({ requireAllSignatures: false, verifySignatures: false })
          .toString('base64');

        await txPrisma.paymentTransactionIssuance.create({
          data: {
            paymentIntentId: intent.id,
            constructionAccount: buyerPubKey.toBase58(),
            expectedTransactionSignature,
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
        return {
          transaction: serialized,
          message: `Pay ${Number(intent.expectedPriceAmount).toFixed(2)} USDC to unlock this SolArch archive`,
        };
      },
      { timeout: 30_000 },
    );
  }

  async verifyPayment(intentId: string, authHeader: string, dto: VerifyPaymentDto) {
    if (dto.transaction_signature !== undefined) {
      this.canonicalTransactionSignature(dto.transaction_signature);
    }
    try {
      await validateDevicePublicKey(dto.device_public_key);
    } catch {
      throw new BadRequestException({
        code: 'INVALID_REQUEST',
        message: 'Invalid device public key',
      });
    }

    // 1. Mandatory credential authentication precedence (API §9.1, §10)
    if (!authHeader || !authHeader.startsWith('SolArchIntent ')) {
      throw this.invalidIntentCredential();
    }

    const secret = authHeader.replace('SolArchIntent ', '').trim();
    if (!validateToken32(secret)) {
      throw this.invalidIntentCredential();
    }

    const credentialHmac = hashIntentClientSecret(secret, this.env.intentHmacSecret);
    const intent = await this.prisma.paymentIntent.findUnique({
      where: { clientSecretHmac: credentialHmac },
      include: { archive: true, payment: { include: { entitlement: true } } },
    });

    if (
      !intent ||
      !verifyIntentClientSecret(secret, intent.clientSecretHmac, this.env.intentHmacSecret) ||
      intent.id !== intentId
    ) {
      throw this.invalidIntentCredential();
    }

    // 2. Resource & binding validations after credential authentication
    if (intent.devicePublicKey !== dto.device_public_key) {
      throw new ConflictException({
        code: 'DEVICE_BINDING_MISMATCH',
        message: 'Device public key does not match PaymentIntent binding',
      });
    }

    // Terminal states are closed before any chain lookup and cannot transition
    // back to confirmed. Authentication and Device A binding still precede
    // this resource-state disclosure.
    if (intent.status === 'failed') {
      throw new HttpException(
        { code: 'PAYMENT_FAILED', message: 'Payment intent failed' },
        HttpStatus.FORBIDDEN,
      );
    }
    if (intent.status === 'expired') {
      throw this.expiredIntentError();
    }

    this.assertArchiveFingerprintSnapshot(intent);

    // Idempotency: If already confirmed, return closed confirmed response
    if (intent.status === 'confirmed') {
      if (!intent.payment?.entitlement) {
        throw new ServiceUnavailableException({
          code: 'BACKEND_UNAVAILABLE',
          message: 'Confirmed payment is missing its active entitlement record',
        });
      }
      this.assertConfirmedPaymentBindings(intent, intent.payment);
      return {
        verified: true,
        status: 'confirmed',
        payment_id: intent.payment.id,
        entitlement_id: intent.payment.entitlement.id,
        archive_id: intent.archiveId,
        archive_fingerprint: intent.archiveFingerprint,
        device_public_key: intent.devicePublicKey,
        next_step: 'activate_device',
      };
    }

    // 3. Bind the candidate to an exact Backend-issued fee-payer signature.
    const connection = this.getConnection();
    let matchingIssuance: any = null;
    let signature = dto.transaction_signature;
    if (signature) {
      matchingIssuance = await this.prisma.paymentTransactionIssuance.findFirst({
        where: {
          paymentIntentId: intent.id,
          expectedTransactionSignature: signature,
        },
      });
      if (!matchingIssuance) {
        throw new BadRequestException({
          code: 'INVALID_REQUEST',
          message: 'Transaction signature does not match a Backend issuance for this intent',
        });
      }
    } else {
      matchingIssuance = await this.prisma.paymentTransactionIssuance.findFirst({
        where: { paymentIntentId: intent.id, status: 'active' },
        orderBy: { issuedAt: 'desc' },
      });
      if (matchingIssuance) {
        if (
          matchingIssuance.expectedTransactionSignature &&
          !this.isCanonicalTransactionSignature(matchingIssuance.expectedTransactionSignature)
        ) {
          throw new ServiceUnavailableException({
            code: 'BACKEND_UNAVAILABLE',
            message: 'Stored payment issuance signature is invalid',
          });
        }
        signature =
          matchingIssuance.expectedTransactionSignature ||
          this.signatureFromSerializedTransaction(matchingIssuance.serializedTransaction);
      }
    }

    if (!matchingIssuance || !signature) {
      if (new Date() >= intent.expiresAt) {
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

    // A committed payment is idempotent, but only for the exact matching issuance.
    const existingPayment = await this.prisma.payment.findUnique({
      where: { transactionSignature: signature },
      include: { entitlement: true },
    });

    if (existingPayment) {
      if (existingPayment.paymentIntentId !== intent.id) {
        throw new ConflictException({
          code: 'INVALID_REQUEST',
          message: 'Transaction signature already used for another purchase',
        });
      }
      if (!existingPayment.entitlement) {
        throw new ServiceUnavailableException({
          code: 'BACKEND_UNAVAILABLE',
          message: 'Confirmed payment is missing its active entitlement record',
        });
      }
      this.assertConfirmedPaymentBindings(intent, existingPayment);
      return {
        verified: true,
        status: 'confirmed',
        payment_id: existingPayment.id,
        entitlement_id: existingPayment.entitlement.id,
        archive_id: intent.archiveId,
        archive_fingerprint: intent.archiveFingerprint,
        device_public_key: intent.devicePublicKey,
        next_step: 'activate_device',
      };
    }

    // 4. Authoritative Solana status for this exact issuance signature.
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
      let finalizedBlockHeight: number;
      try {
        finalizedBlockHeight = await connection.getBlockHeight('finalized');
      } catch (error) {
        this.logger.warn(`Unable to resolve issuance validity window: ${error.message}`);
        throw new ServiceUnavailableException({
          code: 'BACKEND_UNAVAILABLE',
          message: 'Solana RPC unavailable for issuance validity verification',
        });
      }
      if (BigInt(finalizedBlockHeight) > matchingIssuance.lastValidBlockHeight) {
        await this.prisma.paymentTransactionIssuance.updateMany({
          where: { id: matchingIssuance.id, status: 'active' },
          data: { status: 'expired' },
        });
        if (new Date() >= intent.expiresAt) {
          await this.prisma.paymentIntent.update({
            where: { id: intent.id },
            data: { status: 'expired' },
          });
          throw new HttpException(
            { code: 'PAYMENT_INTENT_EXPIRED', message: 'Payment intent has expired' },
            HttpStatus.GONE,
          );
        }
      }
      return { verified: false, status: 'pending' };
    }

    if (sigStatus.confirmationStatus !== 'finalized') {
      if (sigStatus.err) {
        return { verified: false, status: 'pending' };
      }
      await this.prisma.paymentIntent.update({
        where: { id: intent.id },
        data: { status: 'awaiting_finality' },
      });
      return { verified: false, status: 'awaiting_finality' };
    }

    if (sigStatus.err) {
      await this.prisma.paymentTransactionIssuance.updateMany({
        where: { id: matchingIssuance.id, status: 'active' },
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

    if (!Number.isSafeInteger(sigStatus.slot) || sigStatus.slot < 0) {
      throw new ServiceUnavailableException({
        code: 'BACKEND_UNAVAILABLE',
        message: 'Finalized signature status is missing a valid slot',
      });
    }

    // 5. Resolve the landing height from finalized slot -> finalized block.
    let txInfo: any = null;
    let rawTx: any = null;
    let landedBlock: any = null;
    try {
      [txInfo, rawTx, landedBlock] = await Promise.all([
        connection.getParsedTransaction(signature, {
          maxSupportedTransactionVersion: 0,
          commitment: 'finalized',
        }),
        connection.getTransaction(signature, {
          maxSupportedTransactionVersion: 0,
          commitment: 'finalized',
        }),
        connection.getBlock(sigStatus.slot, {
          commitment: 'finalized',
          maxSupportedTransactionVersion: 0,
        }),
      ]);
    } catch (e) {
      this.logger.warn(`Failed to fetch finalized transaction data for ${signature}: ${e.message}`);
      throw new ServiceUnavailableException({
        code: 'BACKEND_UNAVAILABLE',
        message: 'Unable to fetch finalized transaction from Solana RPC',
      });
    }

    if (
      !txInfo ||
      !rawTx ||
      !rawTx.transaction?.message ||
      txInfo.slot !== sigStatus.slot ||
      rawTx.slot !== sigStatus.slot ||
      !landedBlock ||
      !Number.isSafeInteger(landedBlock.blockHeight) ||
      landedBlock.blockHeight < 0
    ) {
      this.logger.warn(`Finalized transaction not returned by RPC for ${signature}`);
      throw new ServiceUnavailableException({
        code: 'BACKEND_UNAVAILABLE',
        message: 'Finalized transaction data unavailable from RPC',
      });
    }

    if (txInfo.meta?.err) {
      await this.prisma.paymentTransactionIssuance.updateMany({
        where: { id: matchingIssuance.id, status: 'active' },
        data: { status: 'failed' },
      });
      return { verified: false, status: 'pending' };
    }

    // 6. Verification Checklist on Finalized Transaction
    const messageBytes = rawTx.transaction.message.serialize();
    const onChainMessageHash = createHash('sha256').update(messageBytes).digest('hex').toLowerCase();
    if (onChainMessageHash !== matchingIssuance.transactionMessageHash) {
      this.logger.warn(
        `Transaction message does not match the exact issuance for intent ${intent.id}`,
      );
      throw new BadRequestException({
        code: 'INVALID_REQUEST',
        message: 'Transaction message does not match any issued PaymentIntent transaction',
      });
    }

    if (BigInt(landedBlock.blockHeight) > matchingIssuance.lastValidBlockHeight) {
      throw new BadRequestException({
        code: 'INVALID_REQUEST',
        message: 'Transaction landed after issuance blockhash validity window',
      });
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

    // Reference is additional evidence; exact signature and message are identity.
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
      if (ix.parsed?.type === 'transferChecked') {
        const info = ix.parsed.info;
        const dest = info?.destination;
        const amount = BigInt(info?.amount || info?.tokenAmount?.amount || 0);
        const mint = info?.mint;

        if (mint === usdcMintStr && dest === intent.creatorAta && amount === BigInt(creatorUnits)) {
          foundCreatorTransfer = true;
        }
        if (mint === usdcMintStr && dest === intent.platformAta && amount === BigInt(platformUnits)) {
          foundPlatformTransfer = true;
        }
      }
    }
    if (!foundCreatorTransfer || !foundPlatformTransfer) {
      throw new BadRequestException({
        code: 'INVALID_REQUEST',
        message: 'Transaction does not contain valid 95/5 USDC split transfers',
      });
    }

    const signerKeys = txInfo.transaction.message.accountKeys
      .filter((key: any) => key.signer)
      .map((key: any) => key.pubkey.toBase58());
    if (
      !signerKeys.includes(this.env.feePayerKeypair.publicKey.toBase58()) ||
      !signerKeys.includes(matchingIssuance.constructionAccount)
    ) {
      throw new BadRequestException({
        code: 'INVALID_REQUEST',
        message: 'Transaction signer set does not match the Backend issuance',
      });
    }
    const buyerWallet = matchingIssuance.constructionAccount;

    // 7. Serialize the idempotent Payment + Entitlement commit on the intent row.
    const result = await this.prisma.$transaction(
      async (txPrisma) => {
        await this.lockPaymentIntent(txPrisma, intent.id);
        const lockedIntent = await txPrisma.paymentIntent.findUnique({
          where: { id: intent.id },
          include: { archive: true, payment: { include: { entitlement: true } } },
        });
        if (!lockedIntent) {
          throw new ServiceUnavailableException({
            code: 'BACKEND_UNAVAILABLE',
            message: 'PaymentIntent disappeared during finalized payment commit',
          });
        }
        this.assertArchiveFingerprintSnapshot(lockedIntent);
        if (lockedIntent?.status === 'confirmed' && lockedIntent.payment?.entitlement) {
          this.assertConfirmedPaymentBindings(lockedIntent, lockedIntent.payment);
          return {
            payment: lockedIntent.payment,
            entitlement: lockedIntent.payment.entitlement,
          };
        }
        const lockedIssuance = await txPrisma.paymentTransactionIssuance.findFirst({
          where: {
            id: matchingIssuance.id,
            paymentIntentId: intent.id,
            expectedTransactionSignature: signature,
          },
        });
        if (!lockedIssuance || lockedIssuance.status !== 'active') {
          throw new BadRequestException({
            code: 'INVALID_REQUEST',
            message: 'Payment issuance is no longer eligible for confirmation',
          });
        }

        await txPrisma.paymentTransactionIssuance.update({
          where: { id: lockedIssuance.id },
          data: { status: 'consumed' },
        });
        await txPrisma.paymentIntent.update({
          where: { id: intent.id },
          data: { status: 'confirmed', confirmedBuyerWallet: buyerWallet },
        });
        const payment = await txPrisma.payment.create({
          data: {
            paymentIntentId: intent.id,
            archiveId: intent.archiveId,
            buyerWallet,
            devicePublicKey: lockedIntent.devicePublicKey,
            transactionSignature: signature,
            status: 'confirmed',
            rawTxSafeJson: {
              slot: sigStatus.slot,
              blockTime: txInfo.blockTime,
              blockHeight: landedBlock.blockHeight,
            },
          },
        });
        const entitlement = await txPrisma.entitlement.create({
          data: {
            archiveId: intent.archiveId,
            buyerWallet,
            devicePublicKey: lockedIntent.devicePublicKey,
            paymentId: payment.id,
            maxDevices: 1,
            devicesActivated: 0,
            status: 'active',
            policySnapshot: {
              max_devices: 1,
              allow_export: false,
              watermark_enabled: true,
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
      },
      { timeout: 30_000 },
    );

    return {
      verified: true,
      status: 'confirmed',
      payment_id: result.payment.id,
      entitlement_id: result.entitlement.id,
      archive_id: intent.archiveId,
      archive_fingerprint: intent.archiveFingerprint,
      device_public_key: intent.devicePublicKey,
      next_step: 'activate_device',
    };
  }
}
