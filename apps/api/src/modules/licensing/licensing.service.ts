import {
  Injectable,
  NotFoundException,
  UnauthorizedException,
  ForbiddenException,
  ConflictException,
  ServiceUnavailableException,
  HttpException,
  HttpStatus,
  Logger,
} from '@nestjs/common';
import { randomUUID } from 'crypto';
import { PrismaService } from '@/common/prisma.service';
import { EnvService } from '@/config/env.service';
import { wrapContentKey, validateDevicePublicKey } from '@/crypto/hpke.util';
import { signLicenseEnvelope } from '@/crypto/ed25519.util';
import {
  generateToken32,
  hashDeviceRefreshToken,
  verifyDeviceRefreshToken,
  verifyIntentClientSecret,
  validateToken32,
  hashRequestNonce,
  formatExactSecondUtc,
  zeroizeBuffer,
} from '@/crypto/token32.util';
import { AckCustodyService } from '@/modules/uploads/ack-custody.service';
import { ActivateDeviceDto, RefreshLicenseDto, CheckLicenseDto } from './licensing.dto';

@Injectable()
export class LicensingService {
  private readonly logger = new Logger(LicensingService.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly env: EnvService,
    private readonly ackCustody: AckCustodyService,
  ) {}

  async activateDevice(
    intentIdOrEntitlementId: string,
    authHeader: string,
    dto: ActivateDeviceDto,
  ) {
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

    const entitlement = await this.prisma.entitlement.findFirst({
      where: {
        OR: [
          { id: intentIdOrEntitlementId },
          { payment: { paymentIntentId: intentIdOrEntitlementId } },
        ],
      },
      include: {
        archive: true,
        payment: { include: { paymentIntent: true } },
        activations: { include: { licenses: true } },
      },
    });

    if (!entitlement) {
      throw new UnauthorizedException({
        code: 'INVALID_INTENT_CREDENTIAL',
        message: 'Invalid payment intent credential',
      });
    }

    const clientHmac = entitlement.payment?.paymentIntent?.clientSecretHmac;
    if (!clientHmac || !verifyIntentClientSecret(secret, clientHmac, this.env.intentHmacSecret)) {
      throw new UnauthorizedException({
        code: 'INVALID_INTENT_CREDENTIAL',
        message: 'Invalid payment intent secret credential',
      });
    }

    // 2. Post-credential re-checks before P/W and ACK unsealing
    try {
      validateDevicePublicKey(dto.device_public_key);
    } catch {
      throw new ConflictException({
        code: 'DEVICE_BINDING_MISMATCH',
        message: 'Invalid device public key',
      });
    }

    // Enforce pre-payment Device A binding
    if (entitlement.devicePublicKey !== dto.device_public_key) {
      throw new ConflictException({
        code: 'DEVICE_BINDING_MISMATCH',
        message: 'This entitlement allows only Device A bound during payment intent creation.',
      });
    }

    // Check payment confirmation
    if (entitlement.payment?.status !== 'confirmed') {
      throw new ForbiddenException({
        code: 'PAYMENT_NOT_CONFIRMED',
        message: 'Payment is not confirmed',
      });
    }

    // Check entitlement status
    if (entitlement.status === 'revoked') {
      throw new ForbiddenException({
        code: 'ENTITLEMENT_REVOKED',
        message: 'Entitlement has been revoked',
      });
    }
    if (entitlement.status === 'expired') {
      throw new HttpException(
        { code: 'ENTITLEMENT_EXPIRED', message: 'Entitlement has expired' },
        HttpStatus.GONE,
      );
    }
    if (entitlement.status !== 'active') {
      throw new ForbiddenException({
        code: 'ENTITLEMENT_REVOKED',
        message: 'Entitlement is not active',
      });
    }

    // Check archive technical & marketplace status
    if (entitlement.archive.technicalStatus !== 'ready') {
      throw new ServiceUnavailableException({
        code: 'BACKEND_UNAVAILABLE',
        message: 'Archive technical status is not ready',
      });
    }
    if (entitlement.archive.marketplaceStatus === 'blocked') {
      throw new ForbiddenException({
        code: 'ARCHIVE_BLOCKED',
        message: 'Archive is blocked',
      });
    }
    if (!['published', 'unpublished'].includes(entitlement.archive.marketplaceStatus)) {
      throw new ForbiddenException({
        code: 'ARCHIVE_BLOCKED',
        message: 'Archive is not available for license issuance',
      });
    }

    // Check proposed 72h offline lease against known entitlement expiry deadline
    const issuedAt = new Date(Math.floor(Date.now() / 1000) * 1000);
    const offlineValidUntil = new Date(issuedAt.getTime() + 259200 * 1000);
    if (entitlement.expiresAt && offlineValidUntil > entitlement.expiresAt) {
      throw new HttpException(
        {
          code: 'ENTITLEMENT_EXPIRED',
          message: 'Offline lease exceeds entitlement expiry deadline',
        },
        HttpStatus.GONE,
      );
    }

    // Replay protection for request_nonce (canonical 32-byte Base64)
    let nonceHash: string;
    try {
      nonceHash = hashRequestNonce(dto.request_nonce);
    } catch (e) {
      throw new ConflictException({
        code: 'INVALID_REQUEST',
        message: `Invalid request_nonce: ${e.message}`,
      });
    }

    const existingNonce = await this.prisma.requestNonceRecord.findUnique({
      where: {
        credentialRecordId_requestNonceHash: {
          credentialRecordId: entitlement.id,
          requestNonceHash: nonceHash,
        },
      },
    });

    if (existingNonce) {
      throw new ConflictException({
        code: 'REQUEST_NONCE_REPLAY',
        message: 'Request nonce has already been consumed for this credential',
      });
    }

    // 3. Activation & 10-minute lost-response recovery handling
    const existingActivation = entitlement.activations.find(
      (a) => a.devicePublicKey === dto.device_public_key,
    );

    let licenseId: string;
    let isRecovery = false;
    let needCreateLicense = false;
    let activationId: string;

    if (existingActivation) {
      const elapsedMs = Date.now() - existingActivation.activatedAt.getTime();
      const tenMinutesMs = 10 * 60 * 1000;
      if (elapsedMs > tenMinutesMs) {
        throw new HttpException(
          {
            code: 'PAYMENT_INTENT_EXPIRED',
            message: 'Payment intent secret credential has expired after the 10-minute activation window',
          },
          HttpStatus.GONE,
        );
      }

      isRecovery = true;
      activationId = existingActivation.id;
      const existingLicense =
        existingActivation.licenses.find((l) => l.status === 'active') || existingActivation.licenses[0];

      if (existingLicense) {
        licenseId = existingLicense.id;
        needCreateLicense = false;
      } else {
        // Recovery of partial state: activation existed but license was never created!
        licenseId = `lic_${randomUUID().replace(/-/g, '').slice(0, 16)}`;
        needCreateLicense = true;
      }
    } else {
      if (entitlement.activations.length >= entitlement.maxDevices) {
        throw new ConflictException({
          code: 'DEVICE_LIMIT_REACHED',
          message: 'This entitlement allows only one device.',
        });
      }

      licenseId = `lic_${randomUUID().replace(/-/g, '').slice(0, 16)}`;
      activationId = `act_${randomUUID().replace(/-/g, '').slice(0, 16)}`;
      needCreateLicense = true;
    }

    // 4. Unseal Content Key (ACK) from encrypted custody
    const rawAck = await this.ackCustody.unseal(
      entitlement.archiveId,
      entitlement.archive.archiveFingerprint || '',
      entitlement.archive.contentKeyRef,
    );

    const payloadP = {
      version: 1,
      key_id: this.env.licenseKeyId,
      license_id: licenseId,
      entitlement_id: entitlement.id,
      archive_id: entitlement.archiveId,
      archive_fingerprint: entitlement.archive.archiveFingerprint || '',
      buyer_wallet: entitlement.buyerWallet,
      device_public_key: dto.device_public_key,
      status: 'active',
      issued_at: formatExactSecondUtc(issuedAt),
      offline_valid_until: formatExactSecondUtc(offlineValidUntil),
      request_nonce: dto.request_nonce,
      rights: {
        export: entitlement.archive.allowExport,
        max_devices: 1,
        open: true,
        watermark_enabled: entitlement.archive.watermarkEnabled,
      },
    };

    // HPKE wrap ACK
    let wrappedContentKey: any;
    try {
      wrappedContentKey = await wrapContentKey(
        dto.device_public_key,
        rawAck,
        payloadP,
      );
    } finally {
      // Best-effort zeroize raw ACK buffer immediately after wrapping
      zeroizeBuffer(rawAck);
    }

    // Pure Ed25519 signature over JCS({ payload: P, wrapped_content_key: W })
    const { signatureBase64 } = signLicenseEnvelope(
      {
        payload: payloadP,
        wrapped_content_key: wrappedContentKey,
      },
      this.env.licenseSigningKeypair.secretKey,
    );

    // Issue fresh device_refresh_token (TOKEN32) hashed with dedicated domain and pepper
    const refreshToken = generateToken32();
    const refreshTokenHmac = hashDeviceRefreshToken(refreshToken, this.env.deviceRefreshHmacSecret);

    // Atomic persistence
    await this.prisma.$transaction(async (tx) => {
      // Reserve request nonce
      await tx.requestNonceRecord.create({
        data: {
          credentialRecordId: entitlement.id,
          requestNonceHash: nonceHash,
        },
      });

      if (!existingActivation) {
        await tx.deviceActivation.create({
          data: {
            id: activationId,
            entitlementId: entitlement.id,
            devicePublicKey: dto.device_public_key,
            deviceLabel: dto.device_name || 'Windows PC',
            viewerVersion: dto.viewer_version || '0.1.0',
            status: 'active',
          },
        });
        await tx.entitlement.update({
          where: { id: entitlement.id },
          data: { devicesActivated: entitlement.devicesActivated + 1 },
        });
      }

      if (needCreateLicense) {
        await tx.deviceLicense.create({
          data: {
            id: licenseId,
            entitlementId: entitlement.id,
            deviceActivationId: activationId,
            archiveId: entitlement.archiveId,
            devicePublicKey: dto.device_public_key,
            status: 'active',
            rightsJson: payloadP.rights,
            serverSignature: signatureBase64,
            issuedAt,
            offlineValidUntil,
            refreshTokenHmac,
          },
        });
      } else {
        await tx.deviceLicense.update({
          where: { id: licenseId },
          data: {
            issuedAt,
            offlineValidUntil,
            serverSignature: signatureBase64,
            refreshTokenHmac,
          },
        });
      }
    });

    return {
      license: {
        payload: payloadP,
        server_signature: signatureBase64,
      },
      wrapped_content_key: wrappedContentKey,
      device_refresh_token: refreshToken,
    };
  }

  async refreshLicense(licenseId: string, authHeader: string, dto: RefreshLicenseDto) {
    // 1. Mandatory credential authentication precedence
    if (!authHeader || !authHeader.startsWith('DeviceRefresh ')) {
      throw new UnauthorizedException({
        code: 'INVALID_REFRESH_CREDENTIAL',
        message: 'Missing or invalid DeviceRefresh authorization',
      });
    }

    const token = authHeader.replace('DeviceRefresh ', '').trim();
    if (!validateToken32(token)) {
      throw new UnauthorizedException({
        code: 'INVALID_REFRESH_CREDENTIAL',
        message: 'Invalid device refresh token format',
      });
    }

    const license = await this.prisma.deviceLicense.findUnique({
      where: { id: licenseId },
      include: {
        entitlement: { include: { archive: true } },
      },
    });

    if (!license) {
      throw new UnauthorizedException({
        code: 'INVALID_REFRESH_CREDENTIAL',
        message: 'Invalid device refresh credential',
      });
    }

    // Verify token HMAC using purpose-separated domain and deviceRefreshHmacSecret
    const isValidToken = verifyDeviceRefreshToken(
      token,
      license.refreshTokenHmac || '',
      this.env.deviceRefreshHmacSecret,
    );
    if (!isValidToken) {
      throw new UnauthorizedException({
        code: 'INVALID_REFRESH_CREDENTIAL',
        message: 'Invalid device refresh token',
      });
    }

    // 2. Post-credential re-checks before P/W and ACK unsealing
    try {
      validateDevicePublicKey(dto.device_public_key);
    } catch {
      throw new ConflictException({
        code: 'DEVICE_BINDING_MISMATCH',
        message: 'Invalid device public key',
      });
    }

    // Verify archive binding
    if (license.archiveId !== dto.archive_id) {
      throw new ConflictException({
        code: 'DEVICE_BINDING_MISMATCH',
        message: 'Archive ID does not match license',
      });
    }

    // Verify device binding
    if (license.devicePublicKey !== dto.device_public_key) {
      throw new ConflictException({
        code: 'DEVICE_BINDING_MISMATCH',
        message: 'Device key does not match license',
      });
    }

    // Check license status
    if (license.status === 'revoked') {
      throw new ForbiddenException({
        code: 'LICENSE_REVOKED',
        message: 'License has been revoked',
      });
    }
    if (license.status === 'expired') {
      throw new HttpException(
        { code: 'LICENSE_EXPIRED', message: 'License has expired' },
        HttpStatus.GONE,
      );
    }
    if (license.status !== 'active') {
      throw new ForbiddenException({
        code: 'LICENSE_REVOKED',
        message: 'License is not active',
      });
    }

    // Check entitlement status
    if (license.entitlement.status === 'revoked') {
      throw new ForbiddenException({
        code: 'ENTITLEMENT_REVOKED',
        message: 'Entitlement has been revoked',
      });
    }
    if (license.entitlement.status === 'expired') {
      throw new HttpException(
        { code: 'ENTITLEMENT_EXPIRED', message: 'Entitlement has expired' },
        HttpStatus.GONE,
      );
    }
    if (license.entitlement.status !== 'active') {
      throw new ForbiddenException({
        code: 'ENTITLEMENT_REVOKED',
        message: 'Entitlement is not active',
      });
    }

    // Check archive technical & marketplace status
    if (license.entitlement.archive.technicalStatus !== 'ready') {
      throw new ServiceUnavailableException({
        code: 'BACKEND_UNAVAILABLE',
        message: 'Archive technical status is not ready',
      });
    }
    if (license.entitlement.archive.marketplaceStatus === 'blocked') {
      throw new ForbiddenException({
        code: 'ARCHIVE_BLOCKED',
        message: 'Archive is blocked',
      });
    }
    if (!['published', 'unpublished'].includes(license.entitlement.archive.marketplaceStatus)) {
      throw new ForbiddenException({
        code: 'ARCHIVE_BLOCKED',
        message: 'Archive is not available for license renewal',
      });
    }

    // Check proposed 72h offline lease against known entitlement expiry deadline
    const issuedAt = new Date(Math.floor(Date.now() / 1000) * 1000);
    const offlineValidUntil = new Date(issuedAt.getTime() + 259200 * 1000);
    if (license.entitlement.expiresAt && offlineValidUntil > license.entitlement.expiresAt) {
      throw new HttpException(
        {
          code: 'ENTITLEMENT_EXPIRED',
          message: 'Offline lease exceeds entitlement expiry deadline',
        },
        HttpStatus.GONE,
      );
    }

    // Nonce replay protection
    let nonceHash: string;
    try {
      nonceHash = hashRequestNonce(dto.request_nonce);
    } catch (e) {
      throw new ConflictException({
        code: 'INVALID_REQUEST',
        message: `Invalid request_nonce: ${e.message}`,
      });
    }

    const existingNonce = await this.prisma.requestNonceRecord.findUnique({
      where: {
        credentialRecordId_requestNonceHash: {
          credentialRecordId: license.id,
          requestNonceHash: nonceHash,
        },
      },
    });

    if (existingNonce) {
      throw new ConflictException({
        code: 'REQUEST_NONCE_REPLAY',
        message: 'Request nonce has already been consumed for this license',
      });
    }

    // 3. Unseal Content Key (ACK)
    const rawAck = await this.ackCustody.unseal(
      license.archiveId,
      license.entitlement.archive.archiveFingerprint || '',
      license.entitlement.archive.contentKeyRef,
    );

    const freshPayloadP = {
      version: 1,
      key_id: this.env.licenseKeyId,
      license_id: license.id,
      entitlement_id: license.entitlementId,
      archive_id: license.archiveId,
      archive_fingerprint: license.entitlement.archive.archiveFingerprint || '',
      buyer_wallet: license.entitlement.buyerWallet,
      device_public_key: dto.device_public_key,
      status: 'active',
      issued_at: formatExactSecondUtc(issuedAt),
      offline_valid_until: formatExactSecondUtc(offlineValidUntil),
      request_nonce: dto.request_nonce,
      rights: {
        export: license.entitlement.archive.allowExport,
        max_devices: 1,
        open: true,
        watermark_enabled: license.entitlement.archive.watermarkEnabled,
      },
    };

    let freshWrapped: any;
    try {
      freshWrapped = await wrapContentKey(
        dto.device_public_key,
        rawAck,
        freshPayloadP,
      );
    } finally {
      zeroizeBuffer(rawAck);
    }

    const { signatureBase64 } = signLicenseEnvelope(
      {
        payload: freshPayloadP,
        wrapped_content_key: freshWrapped,
      },
      this.env.licenseSigningKeypair.secretKey,
    );

    await this.prisma.$transaction(async (tx) => {
      await tx.requestNonceRecord.create({
        data: {
          credentialRecordId: license.id,
          requestNonceHash: nonceHash,
        },
      });

      await tx.deviceLicense.update({
        where: { id: license.id },
        data: {
          issuedAt,
          offlineValidUntil,
          serverSignature: signatureBase64,
        },
      });
    });

    return {
      license: {
        payload: freshPayloadP,
        server_signature: signatureBase64,
      },
      wrapped_content_key: freshWrapped,
    };
  }

  async checkLicense(dto: CheckLicenseDto) {
    const license = await this.prisma.deviceLicense.findUnique({
      where: { id: dto.license_id },
      include: { entitlement: { include: { archive: true } } },
    });

    if (!license) {
      throw new NotFoundException({
        code: 'LICENSE_NOT_FOUND',
        message: 'License not found',
      });
    }

    if (
      license.archiveId !== dto.archive_id ||
      license.devicePublicKey !== dto.device_public_key
    ) {
      throw new ForbiddenException({
        code: 'DEVICE_BINDING_MISMATCH',
        message: 'License does not match archive or device',
      });
    }

    return {
      status: license.status,
      rights: license.rightsJson,
    };
  }
}
