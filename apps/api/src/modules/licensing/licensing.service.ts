import {
  Injectable,
  NotFoundException,
  UnauthorizedException,
  ForbiddenException,
  ConflictException,
  Logger,
} from '@nestjs/common';
import { randomUUID } from 'crypto';
import { PrismaService } from '@/common/prisma.service';
import { EnvService } from '@/config/env.service';
import { wrapContentKey, validateDevicePublicKey } from '@/crypto/hpke.util';
import { signLicenseEnvelope } from '@/crypto/ed25519.util';
import {
  generateToken32,
  hashSecretToken,
  verifySecretToken,
  hashRequestNonce,
} from '@/crypto/token32.util';
import { ActivateDeviceDto, RefreshLicenseDto, CheckLicenseDto } from './licensing.dto';

@Injectable()
export class LicensingService {
  private readonly logger = new Logger(LicensingService.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly env: EnvService,
  ) {}

  async activateDevice(
    intentIdOrEntitlementId: string,
    authHeader: string,
    dto: ActivateDeviceDto,
  ) {
    validateDevicePublicKey(dto.device_public_key);

    // Try finding by PaymentIntent first
    let entitlement = await this.prisma.entitlement.findFirst({
      where: {
        OR: [
          { id: intentIdOrEntitlementId },
          { payment: { paymentIntentId: intentIdOrEntitlementId } },
        ],
      },
      include: {
        archive: true,
        payment: { include: { paymentIntent: true } },
        activations: true,
      },
    });

    if (!entitlement) {
      throw new NotFoundException('Entitlement or PaymentIntent not found');
    }

    // Verify credential (mandatory for initial activation)
    if (!authHeader || !authHeader.startsWith('SolArchIntent ')) {
      throw new UnauthorizedException('Missing or invalid SolArchIntent authorization header');
    }

    const secret = authHeader.replace('SolArchIntent ', '').trim();
    const clientHmac = entitlement.payment?.paymentIntent?.clientSecretHmac;
    if (clientHmac) {
      const isValid = verifySecretToken(secret, clientHmac, this.env.intentHmacSecret);
      if (!isValid) {
        throw new UnauthorizedException('Invalid payment intent secret credential');
      }
    }

    // Enforce pre-payment Device A binding
    if (entitlement.devicePublicKey !== dto.device_public_key) {
      throw new ForbiddenException({
        code: 'DEVICE_LIMIT_REACHED',
        message: 'This entitlement allows only Device A bound during payment intent creation.',
      });
    }

    // Enforce max_devices = 1
    const otherActivation = entitlement.activations.find(
      (a) => a.devicePublicKey !== dto.device_public_key && a.status === 'active',
    );
    if (otherActivation) {
      throw new ForbiddenException({
        code: 'DEVICE_LIMIT_REACHED',
        message: 'This entitlement allows only one device.',
      });
    }

    // Replay protection for request_nonce
    const nonceHash = hashRequestNonce(dto.request_nonce);
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

    await this.prisma.requestNonceRecord.create({
      data: {
        credentialRecordId: entitlement.id,
        requestNonceHash: nonceHash,
      },
    });

    // Upsert activation
    let activation = entitlement.activations.find(
      (a) => a.devicePublicKey === dto.device_public_key,
    );
    if (!activation) {
      activation = await this.prisma.deviceActivation.create({
        data: {
          entitlementId: entitlement.id,
          devicePublicKey: dto.device_public_key,
          deviceLabel: dto.device_name || 'Windows PC',
          viewerVersion: dto.viewer_version || '0.1.0',
          status: 'active',
        },
      });
      await this.prisma.entitlement.update({
        where: { id: entitlement.id },
        data: { devicesActivated: entitlement.devicesActivated + 1 },
      });
    }

    // Prepare 72-hour offline lease
    const now = new Date();
    const issuedAt = now;
    const offlineValidUntil = new Date(now.getTime() + 259200 * 1000); // exactly 72h

    const licenseId = `lic_${randomUUID().replace(/-/g, '').slice(0, 16)}`;

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
      issued_at: issuedAt.toISOString(),
      offline_valid_until: offlineValidUntil.toISOString(),
      request_nonce: dto.request_nonce,
      rights: {
        open: true,
        export: entitlement.archive.allowExport,
        max_devices: 1,
        watermark_enabled: entitlement.archive.watermarkEnabled,
      },
    };

    // Load content key (ACK)
    let rawAck: Buffer;
    if (entitlement.archive.contentKeyRef) {
      rawAck = Buffer.from(entitlement.archive.contentKeyRef, 'hex');
    } else {
      rawAck = Buffer.from('12345678901234567890123456789012', 'utf8');
    }

    // HPKE wrap ACK
    const wrappedContentKey = await wrapContentKey(
      dto.device_public_key,
      rawAck,
      payloadP,
    );

    // Pure Ed25519 signature over JCS({ payload: P, wrapped_content_key: W })
    const { signatureBase64 } = signLicenseEnvelope(
      {
        payload: payloadP,
        wrapped_content_key: wrappedContentKey,
      },
      this.env.licenseSigningKeypair.secretKey,
    );

    // Issue device_refresh_token (TOKEN32)
    const refreshToken = generateToken32();
    const refreshTokenHmac = hashSecretToken(refreshToken, this.env.intentHmacSecret);

    // Store license in DB
    await this.prisma.deviceLicense.create({
      data: {
        id: licenseId,
        entitlementId: entitlement.id,
        deviceActivationId: activation.id,
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
    if (!authHeader || !authHeader.startsWith('DeviceRefresh ')) {
      throw new UnauthorizedException('Missing or invalid DeviceRefresh authorization');
    }

    const token = authHeader.replace('DeviceRefresh ', '').trim();
    const license = await this.prisma.deviceLicense.findUnique({
      where: { id: licenseId },
      include: {
        entitlement: { include: { archive: true } },
      },
    });

    if (!license) {
      throw new NotFoundException('Device license not found');
    }

    // Verify token HMAC
    const isValidToken = verifySecretToken(token, license.refreshTokenHmac || '', this.env.intentHmacSecret);
    if (!isValidToken) {
      throw new UnauthorizedException('Invalid device refresh token');
    }

    // Verify device
    if (license.devicePublicKey !== dto.device_public_key) {
      throw new ForbiddenException('Device key does not match license');
    }

    if (license.status !== 'active' || license.entitlement.status !== 'active') {
      throw new ForbiddenException('License or Entitlement is revoked or inactive');
    }

    if (license.entitlement.archive.marketplaceStatus === 'blocked') {
      throw new ForbiddenException('Archive is blocked');
    }

    // Nonce replay protection
    const nonceHash = hashRequestNonce(dto.request_nonce);
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

    await this.prisma.requestNonceRecord.create({
      data: {
        credentialRecordId: license.id,
        requestNonceHash: nonceHash,
      },
    });

    // Issue fresh 72h window
    const now = new Date();
    const issuedAt = now;
    const offlineValidUntil = new Date(now.getTime() + 259200 * 1000);

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
      issued_at: issuedAt.toISOString(),
      offline_valid_until: offlineValidUntil.toISOString(),
      request_nonce: dto.request_nonce,
      rights: {
        open: true,
        export: license.entitlement.archive.allowExport,
        max_devices: 1,
        watermark_enabled: license.entitlement.archive.watermarkEnabled,
      },
    };

    let rawAck: Buffer;
    if (license.entitlement.archive.contentKeyRef) {
      rawAck = Buffer.from(license.entitlement.archive.contentKeyRef, 'hex');
    } else {
      rawAck = Buffer.from('12345678901234567890123456789012', 'utf8');
    }

    const freshWrapped = await wrapContentKey(
      dto.device_public_key,
      rawAck,
      freshPayloadP,
    );

    const { signatureBase64 } = signLicenseEnvelope(
      {
        payload: freshPayloadP,
        wrapped_content_key: freshWrapped,
      },
      this.env.licenseSigningKeypair.secretKey,
    );

    await this.prisma.deviceLicense.update({
      where: { id: license.id },
      data: {
        issuedAt,
        offlineValidUntil,
        serverSignature: signatureBase64,
      },
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
      throw new NotFoundException('License not found');
    }

    if (
      license.archiveId !== dto.archive_id ||
      license.devicePublicKey !== dto.device_public_key
    ) {
      throw new ForbiddenException('License does not match archive or device');
    }

    return {
      status: license.status,
      rights: license.rightsJson,
    };
  }
}
