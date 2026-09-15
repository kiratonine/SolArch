import {
  Injectable,
  BadRequestException,
  UnauthorizedException,
  ForbiddenException,
  ConflictException,
  ServiceUnavailableException,
  HttpException,
  HttpStatus,
} from '@nestjs/common';
import { randomUUID } from 'crypto';
import { PrismaService } from '@/common/prisma.service';
import { EnvService } from '@/config/env.service';
import { wrapContentKey, validateDevicePublicKey } from '@/crypto/hpke.util';
import { signLicenseEnvelope } from '@/crypto/ed25519.util';
import {
  generateToken32,
  hashIntentClientSecret,
  hashDeviceRefreshToken,
  verifyDeviceRefreshToken,
  verifyIntentClientSecret,
  validateToken32,
  hashRequestNonce,
  formatExactSecondUtc,
  zeroizeBuffer,
} from '@/crypto/token32.util';
import { AckCustodyService } from '@/modules/uploads/ack-custody.service';
import { ActivateDeviceDto, RefreshLicenseDto } from './licensing.dto';

const OFFLINE_WINDOW_MS = 259_200 * 1000;
const ACTIVATION_RECOVERY_MS = 10 * 60 * 1000;
const VIEWER_VERSION = /^[0-9]{1,3}\.[0-9]{1,3}\.[0-9]{1,3}$/;
const CONTROL_CHARACTER = /[\u0000-\u001f\u007f]/u;

@Injectable()
export class LicensingService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly env: EnvService,
    private readonly ackCustody: AckCustodyService,
  ) {}

  private invalidRequest(message: string): BadRequestException {
    return new BadRequestException({ code: 'INVALID_REQUEST', message });
  }

  private invalidIntentCredential(): UnauthorizedException {
    return new UnauthorizedException({
      code: 'INVALID_INTENT_CREDENTIAL',
      message: 'Invalid payment intent credential',
    });
  }

  private invalidRefreshCredential(): UnauthorizedException {
    return new UnauthorizedException({
      code: 'INVALID_REFRESH_CREDENTIAL',
      message: 'Invalid device refresh credential',
    });
  }

  private validateNonce(requestNonce: string): string {
    try {
      return hashRequestNonce(requestNonce);
    } catch {
      throw this.invalidRequest('request_nonce must be canonical Base64 for exactly 32 bytes');
    }
  }

  private async validateDevice(devicePublicKey: string): Promise<void> {
    try {
      await validateDevicePublicKey(devicePublicKey);
    } catch {
      throw this.invalidRequest('device_public_key is not a valid canonical X25519 public key');
    }
  }

  private async validateActivationRequest(dto: ActivateDeviceDto): Promise<string> {
    const nonceHash = this.validateNonce(dto.request_nonce);
    if (
      typeof dto.device_name !== 'string' ||
      Buffer.byteLength(dto.device_name, 'utf8') < 1 ||
      Buffer.byteLength(dto.device_name, 'utf8') > 128 ||
      CONTROL_CHARACTER.test(dto.device_name)
    ) {
      throw this.invalidRequest('device_name must be 1..128 UTF-8 bytes without control characters');
    }
    if (typeof dto.viewer_version !== 'string' || !VIEWER_VERSION.test(dto.viewer_version)) {
      throw this.invalidRequest('viewer_version must match x.y.z');
    }
    await this.validateDevice(dto.device_public_key);
    return nonceHash;
  }

  private async validateRefreshRequest(dto: RefreshLicenseDto): Promise<string> {
    const nonceHash = this.validateNonce(dto.request_nonce);
    await this.validateDevice(dto.device_public_key);
    return nonceHash;
  }

  private async lockEntitlement(tx: any, entitlementId: string): Promise<void> {
    await tx.$queryRaw`SELECT "id" FROM "entitlements" WHERE "id" = ${entitlementId} FOR UPDATE`;
  }

  private async lockLicense(tx: any, licenseId: string): Promise<void> {
    await tx.$queryRaw`SELECT "id" FROM "device_licenses" WHERE "id" = ${licenseId} FOR UPDATE`;
  }

  private assertEntitlementAuthority(entitlement: any, now: Date): string {
    if (entitlement.payment?.status !== 'confirmed') {
      throw new ForbiddenException({
        code: 'PAYMENT_NOT_CONFIRMED',
        message: 'Payment is not confirmed',
      });
    }
    if (entitlement.status === 'expired' || (entitlement.expiresAt && now >= entitlement.expiresAt)) {
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
    if (entitlement.maxDevices !== 1 || entitlement.archive.maxDevices !== 1) {
      throw new ConflictException({
        code: 'DEVICE_LIMIT_REACHED',
        message: 'The frozen MVP allows exactly one device',
      });
    }
    if (entitlement.archive.technicalStatus !== 'ready') {
      throw new ServiceUnavailableException({
        code: 'BACKEND_UNAVAILABLE',
        message: 'Archive technical status is not ready',
      });
    }
    if (
      !['published', 'unpublished'].includes(entitlement.archive.marketplaceStatus) ||
      entitlement.archive.priceCurrency !== 'USDC' ||
      entitlement.archive.platformFeeBps !== 500 ||
      entitlement.archive.allowExport !== false ||
      entitlement.archive.watermarkEnabled !== true
    ) {
      throw new ForbiddenException({
        code: 'ARCHIVE_BLOCKED',
        message: 'Archive is not eligible for license issuance',
      });
    }
    if (!/^[0-9a-f]{64}$/.test(entitlement.archive.archiveFingerprint || '')) {
      throw new ServiceUnavailableException({
        code: 'BACKEND_UNAVAILABLE',
        message: 'Archive fingerprint is unavailable',
      });
    }
    const payment = entitlement.payment;
    const intent = payment?.paymentIntent;
    if (
      !intent ||
      !/^[0-9a-f]{64}$/.test(intent.archiveFingerprint || '') ||
      intent.archiveId !== entitlement.archiveId ||
      intent.archiveFingerprint !== entitlement.archive.archiveFingerprint ||
      intent.devicePublicKey !== entitlement.devicePublicKey ||
      intent.confirmedBuyerWallet !== entitlement.buyerWallet ||
      payment.archiveId !== entitlement.archiveId ||
      payment.buyerWallet !== entitlement.buyerWallet ||
      payment.devicePublicKey !== entitlement.devicePublicKey
    ) {
      throw new ServiceUnavailableException({
        code: 'BACKEND_UNAVAILABLE',
        message: 'Payment, entitlement and immutable archive snapshot are inconsistent',
      });
    }
    return intent.archiveFingerprint;
  }

  private assertOfflineDeadline(entitlement: any, offlineValidUntil: Date): void {
    if (entitlement.expiresAt && offlineValidUntil > entitlement.expiresAt) {
      throw new HttpException(
        {
          code: 'ENTITLEMENT_EXPIRED',
          message: 'Offline lease exceeds entitlement expiry deadline',
        },
        HttpStatus.GONE,
      );
    }
  }

  private assertActiveLicense(license: any): void {
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
  }

  private assertActiveActivation(activation: any, devicePublicKey: string): void {
    if (
      !activation ||
      activation.status !== 'active' ||
      activation.devicePublicKey !== devicePublicKey
    ) {
      throw new ConflictException({
        code: 'DEVICE_BINDING_MISMATCH',
        message: 'Device activation is not active for the requested Device A',
      });
    }
  }

  async activateDevice(
    paymentIntentId: string,
    authHeader: string,
    dto: ActivateDeviceDto,
  ) {
    const nonceHash = await this.validateActivationRequest(dto);
    if (!authHeader || !authHeader.startsWith('SolArchIntent ')) {
      throw this.invalidIntentCredential();
    }
    const secret = authHeader.replace('SolArchIntent ', '').trim();
    if (!validateToken32(secret)) {
      throw this.invalidIntentCredential();
    }

    const credentialHmac = hashIntentClientSecret(secret, this.env.intentHmacSecret);
    const credentialIntent = await this.prisma.paymentIntent.findUnique({
      where: { clientSecretHmac: credentialHmac },
      include: { payment: { include: { entitlement: true } } },
    });
    if (
      !credentialIntent ||
      !verifyIntentClientSecret(
        secret,
        credentialIntent.clientSecretHmac,
        this.env.intentHmacSecret,
      ) ||
      credentialIntent.id !== paymentIntentId
    ) {
      throw this.invalidIntentCredential();
    }
    if (credentialIntent.devicePublicKey !== dto.device_public_key) {
      throw new ConflictException({
        code: 'DEVICE_BINDING_MISMATCH',
        message: 'PaymentIntent is bound to another device',
      });
    }
    if (!credentialIntent.payment || credentialIntent.payment.status !== 'confirmed') {
      throw new ForbiddenException({
        code: 'PAYMENT_NOT_CONFIRMED',
        message: 'Payment is not confirmed',
      });
    }
    const credentialEntitlement = credentialIntent.payment.entitlement;
    if (!credentialEntitlement) {
      throw new ServiceUnavailableException({
        code: 'BACKEND_UNAVAILABLE',
        message: 'Confirmed payment is missing its entitlement record',
      });
    }

    return this.prisma.$transaction(
      async (tx) => {
        await this.lockEntitlement(tx, credentialEntitlement.id);
        const entitlement = await tx.entitlement.findUnique({
          where: { id: credentialEntitlement.id },
          include: {
            archive: true,
            payment: { include: { paymentIntent: true } },
            activations: { include: { licenses: true } },
          },
        });
        const lockedHmac = entitlement?.payment?.paymentIntent?.clientSecretHmac;
        if (
          !entitlement ||
          !lockedHmac ||
          !verifyIntentClientSecret(secret, lockedHmac, this.env.intentHmacSecret) ||
          entitlement.payment.paymentIntent.id !== paymentIntentId
        ) {
          throw this.invalidIntentCredential();
        }
        if (entitlement.devicePublicKey !== dto.device_public_key) {
          throw new ConflictException({
            code: 'DEVICE_BINDING_MISMATCH',
            message: 'Entitlement is bound to another device',
          });
        }

        const issuedAt = new Date(Math.floor(this.env.currentTime.getTime() / 1000) * 1000);
        const offlineValidUntil = new Date(issuedAt.getTime() + OFFLINE_WINDOW_MS);
        const archiveFingerprint = this.assertEntitlementAuthority(entitlement, issuedAt);
        this.assertOfflineDeadline(entitlement, offlineValidUntil);

        const existingNonce = await tx.requestNonceRecord.findUnique({
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

        const existingActivation = entitlement.activations.find(
          (activation) => activation.devicePublicKey === dto.device_public_key,
        );
        let activationId: string;
        let licenseId: string;
        let createLicense = false;

        if (existingActivation) {
          this.assertActiveActivation(existingActivation, dto.device_public_key);
          if (issuedAt.getTime() - existingActivation.activatedAt.getTime() > ACTIVATION_RECOVERY_MS) {
            throw new HttpException(
              {
                code: 'PAYMENT_INTENT_EXPIRED',
                message: 'Payment intent activation-recovery window has expired',
              },
              HttpStatus.GONE,
            );
          }
          activationId = existingActivation.id;
          if (existingActivation.licenses.length !== 1) {
            throw new ServiceUnavailableException({
              code: 'BACKEND_UNAVAILABLE',
              message: 'License authority state is inconsistent',
            });
          }
          const existingLicense = existingActivation.licenses[0];
          this.assertActiveLicense(existingLicense);
          if (
            existingLicense.entitlementId !== entitlement.id ||
            existingLicense.deviceActivationId !== activationId ||
            existingLicense.archiveId !== entitlement.archiveId ||
            existingLicense.devicePublicKey !== dto.device_public_key
          ) {
            throw new ConflictException({
              code: 'DEVICE_BINDING_MISMATCH',
              message: 'Existing license binding is inconsistent',
            });
          }
          licenseId = existingLicense.id;
        } else {
          if (entitlement.activations.length >= 1 || entitlement.devicesActivated >= 1) {
            throw new ConflictException({
              code: 'DEVICE_LIMIT_REACHED',
              message: 'This entitlement already has its sole Device A',
            });
          }
          activationId = `act_${randomUUID().replace(/-/g, '').slice(0, 16)}`;
          licenseId = `lic_${randomUUID().replace(/-/g, '').slice(0, 16)}`;
          createLicense = true;
        }

        await tx.requestNonceRecord.create({
          data: { credentialRecordId: entitlement.id, requestNonceHash: nonceHash },
        });
        if (!existingActivation) {
          await tx.deviceActivation.create({
            data: {
              id: activationId,
              entitlementId: entitlement.id,
              devicePublicKey: dto.device_public_key,
              deviceLabel: dto.device_name,
              viewerVersion: dto.viewer_version,
              status: 'active',
            },
          });
          await tx.entitlement.update({
            where: { id: entitlement.id },
            data: { devicesActivated: { increment: 1 } },
          });
        }

        const payload = {
          version: 1,
          key_id: this.env.licenseKeyId,
          license_id: licenseId,
          entitlement_id: entitlement.id,
          archive_id: entitlement.archiveId,
          archive_fingerprint: archiveFingerprint,
          buyer_wallet: entitlement.buyerWallet,
          device_public_key: dto.device_public_key,
          status: 'active',
          issued_at: formatExactSecondUtc(issuedAt),
          offline_valid_until: formatExactSecondUtc(offlineValidUntil),
          request_nonce: dto.request_nonce,
          rights: { export: false, max_devices: 1, open: true, watermark_enabled: true },
        };
        const rawAck = await this.ackCustody.unseal(
          entitlement.archiveId,
          archiveFingerprint,
          entitlement.archive.contentKeyRef,
        );
        let wrappedContentKey: any;
        try {
          wrappedContentKey = await wrapContentKey(dto.device_public_key, rawAck, payload);
        } finally {
          zeroizeBuffer(rawAck);
        }
        const { signatureBase64 } = signLicenseEnvelope(
          { payload, wrapped_content_key: wrappedContentKey },
          this.env.licenseSigningKeypair.secretKey,
        );
        const refreshToken = generateToken32();
        const refreshTokenHmac = hashDeviceRefreshToken(
          refreshToken,
          this.env.deviceRefreshHmacSecret,
        );

        if (createLicense) {
          await tx.deviceLicense.create({
            data: {
              id: licenseId,
              entitlementId: entitlement.id,
              deviceActivationId: activationId,
              archiveId: entitlement.archiveId,
              devicePublicKey: dto.device_public_key,
              status: 'active',
              rightsJson: payload.rights,
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
              rightsJson: payload.rights,
              issuedAt,
              offlineValidUntil,
              serverSignature: signatureBase64,
              refreshTokenHmac,
            },
          });
        }

        return {
          license: { payload, server_signature: signatureBase64 },
          wrapped_content_key: wrappedContentKey,
          device_refresh_token: refreshToken,
        };
      },
      { timeout: 30_000 },
    );
  }

  async refreshLicense(licenseId: string, authHeader: string, dto: RefreshLicenseDto) {
    const nonceHash = await this.validateRefreshRequest(dto);
    if (!authHeader || !authHeader.startsWith('DeviceRefresh ')) {
      throw this.invalidRefreshCredential();
    }
    const token = authHeader.replace('DeviceRefresh ', '').trim();
    if (!validateToken32(token)) {
      throw this.invalidRefreshCredential();
    }

    const credentialHmac = hashDeviceRefreshToken(token, this.env.deviceRefreshHmacSecret);
    const credentialLicense = await this.prisma.deviceLicense.findUnique({
      where: { refreshTokenHmac: credentialHmac },
    });
    if (
      !credentialLicense ||
      !verifyDeviceRefreshToken(
        token,
        credentialLicense.refreshTokenHmac || '',
        this.env.deviceRefreshHmacSecret,
      ) ||
      credentialLicense.id !== licenseId
    ) {
      throw this.invalidRefreshCredential();
    }

    return this.prisma.$transaction(
      async (tx) => {
        await this.lockLicense(tx, credentialLicense.id);
        const license = await tx.deviceLicense.findUnique({
          where: { id: credentialLicense.id },
          include: {
            deviceActivation: true,
            entitlement: {
              include: { archive: true, payment: { include: { paymentIntent: true } } },
            },
          },
        });
        if (
          !license ||
          !verifyDeviceRefreshToken(
            token,
            license.refreshTokenHmac || '',
            this.env.deviceRefreshHmacSecret,
          ) ||
          license.id !== licenseId
        ) {
          throw this.invalidRefreshCredential();
        }
        if (
          license.archiveId !== dto.archive_id ||
          license.devicePublicKey !== dto.device_public_key ||
          license.entitlementId !== license.entitlement.id ||
          license.deviceActivationId !== license.deviceActivation.id ||
          license.deviceActivation.entitlementId !== license.entitlementId
        ) {
          throw new ConflictException({
            code: 'DEVICE_BINDING_MISMATCH',
            message: 'License, archive, entitlement or device binding does not match',
          });
        }
        this.assertActiveLicense(license);
        this.assertActiveActivation(license.deviceActivation, dto.device_public_key);
        if (license.entitlement.devicePublicKey !== dto.device_public_key) {
          throw new ConflictException({
            code: 'DEVICE_BINDING_MISMATCH',
            message: 'Entitlement is bound to another device',
          });
        }

        const issuedAt = new Date(Math.floor(this.env.currentTime.getTime() / 1000) * 1000);
        const offlineValidUntil = new Date(issuedAt.getTime() + OFFLINE_WINDOW_MS);
        const archiveFingerprint = this.assertEntitlementAuthority(license.entitlement, issuedAt);
        this.assertOfflineDeadline(license.entitlement, offlineValidUntil);

        const existingNonce = await tx.requestNonceRecord.findUnique({
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
        await tx.requestNonceRecord.create({
          data: { credentialRecordId: license.id, requestNonceHash: nonceHash },
        });

        const payload = {
          version: 1,
          key_id: this.env.licenseKeyId,
          license_id: license.id,
          entitlement_id: license.entitlementId,
          archive_id: license.archiveId,
          archive_fingerprint: archiveFingerprint,
          buyer_wallet: license.entitlement.buyerWallet,
          device_public_key: dto.device_public_key,
          status: 'active',
          issued_at: formatExactSecondUtc(issuedAt),
          offline_valid_until: formatExactSecondUtc(offlineValidUntil),
          request_nonce: dto.request_nonce,
          rights: { export: false, max_devices: 1, open: true, watermark_enabled: true },
        };
        const rawAck = await this.ackCustody.unseal(
          license.archiveId,
          archiveFingerprint,
          license.entitlement.archive.contentKeyRef,
        );
        let wrappedContentKey: any;
        try {
          wrappedContentKey = await wrapContentKey(dto.device_public_key, rawAck, payload);
        } finally {
          zeroizeBuffer(rawAck);
        }
        const { signatureBase64 } = signLicenseEnvelope(
          { payload, wrapped_content_key: wrappedContentKey },
          this.env.licenseSigningKeypair.secretKey,
        );
        await tx.deviceLicense.update({
          where: { id: license.id },
          data: {
            rightsJson: payload.rights,
            issuedAt,
            offlineValidUntil,
            serverSignature: signatureBase64,
          },
        });
        await tx.deviceActivation.update({
          where: { id: license.deviceActivation.id },
          data: { lastSeenAt: issuedAt },
        });

        return {
          license: { payload, server_signature: signatureBase64 },
          wrapped_content_key: wrappedContentKey,
        };
      },
      { timeout: 30_000 },
    );
  }

}
