import {
  Injectable,
  BadRequestException,
  NotFoundException,
  ForbiddenException,
  Logger,
} from '@nestjs/common';
import { PublicKey, Connection, Transaction, sendAndConfirmTransaction } from '@solana/web3.js';
import { getAssociatedTokenAddressSync, createAssociatedTokenAccountInstruction, getAccount } from '@solana/spl-token';
import { PrismaService } from '@/common/prisma.service';
import { EnvService } from '@/config/env.service';
import { CreateArchiveDto, UpdateArchiveDto } from './archives.dto';

@Injectable()
export class ArchivesService {
  private readonly logger = new Logger(ArchivesService.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly env: EnvService,
  ) {}

  calculateEconomics(amountStr: string) {
    const amountNum = parseFloat(amountStr);
    if (isNaN(amountNum) || amountNum <= 0) {
      throw new BadRequestException('Price amount must be a positive number');
    }
    const totalUnits = Math.round(amountNum * 1_000_000);
    const platformUnits = Math.round((totalUnits * 500) / 10000);
    const creatorUnits = totalUnits - platformUnits;

    return {
      platform_fee_bps: 500,
      creator_share: (creatorUnits / 1_000_000).toFixed(2),
      platform_share: (platformUnits / 1_000_000).toFixed(2),
      network_fees_paid_by: 'solarch',
    };
  }

  async create(userId: string, dto: CreateArchiveDto) {
    if (dto.price.currency !== 'USDC') {
      throw new BadRequestException('Only USDC currency is accepted in MVP');
    }

    let creatorPubKey: PublicKey;
    try {
      creatorPubKey = new PublicKey(dto.creator_payout_wallet);
    } catch {
      throw new BadRequestException('Invalid creator payout wallet Solana public key');
    }

    const creatorAta = getAssociatedTokenAddressSync(this.env.usdcMint, creatorPubKey);
    const economics = this.calculateEconomics(dto.price.amount);

    const slugBase = dto.title
      .toLowerCase()
      .replace(/[^a-z0-9]+/g, '-')
      .replace(/^-+|-+$/g, '') || 'archive';
    const slug = `${slugBase}-${Math.random().toString(36).substring(2, 6)}`;

    const archive = await this.prisma.archive.create({
      data: {
        creatorUserId: userId,
        title: dto.title,
        shortDescription: dto.short_description || '',
        description: dto.description || '',
        priceCurrency: 'USDC',
        priceAmount: parseFloat(dto.price.amount).toFixed(2),
        platformFeeBps: 500,
        creatorPayoutWallet: dto.creator_payout_wallet,
        creatorUsdcAta: creatorAta.toBase58(),
        maxDevices: dto.license_policy?.max_devices ?? 1,
        allowExport: dto.license_policy?.allow_export ?? false,
        watermarkEnabled: dto.license_policy?.watermark_enabled ?? true,
        listing: {
          create: {
            slug,
            title: dto.title,
            shortDescription: dto.short_description || '',
            description: dto.description || '',
          },
        },
      },
      include: { listing: true },
    });

    return {
      archive_id: archive.id,
      technical_status: archive.technicalStatus,
      marketplace_status: archive.marketplaceStatus,
      price: {
        currency: archive.priceCurrency,
        amount: archive.priceAmount,
      },
      economics,
    };
  }

  async findOne(archiveId: string, userId: string) {
    const archive = await this.prisma.archive.findUnique({
      where: { id: archiveId },
      include: { listing: true, publicFiles: true },
    });

    if (!archive) {
      throw new NotFoundException('Archive not found');
    }

    if (archive.creatorUserId !== userId) {
      throw new ForbiddenException('You do not own this archive');
    }

    const economics = this.calculateEconomics(archive.priceAmount);

    return {
      ...archive,
      economics,
    };
  }

  async update(archiveId: string, userId: string, dto: UpdateArchiveDto) {
    const archive = await this.prisma.archive.findUnique({
      where: { id: archiveId },
      include: { listing: true },
    });

    if (!archive) {
      throw new NotFoundException('Archive not found');
    }

    if (archive.creatorUserId !== userId) {
      throw new ForbiddenException('You do not own this archive');
    }

    const updated = await this.prisma.archive.update({
      where: { id: archiveId },
      data: {
        title: dto.title ?? archive.title,
        shortDescription: dto.short_description ?? archive.shortDescription,
        description: dto.description ?? archive.description,
        listing: {
          update: {
            title: dto.title ?? archive.title,
            shortDescription: dto.short_description ?? archive.shortDescription,
            description: dto.description ?? archive.description,
            coverStorageKey: dto.cover_storage_key,
            category: dto.category,
            tags: dto.tags,
          },
        },
      },
      include: { listing: true },
    });

    return updated;
  }

  async publish(archiveId: string, userId: string) {
    const archive = await this.prisma.archive.findUnique({
      where: { id: archiveId },
      include: { listing: true },
    });

    if (!archive) {
      throw new NotFoundException('Archive not found');
    }

    if (archive.creatorUserId !== userId) {
      throw new ForbiddenException('You do not own this archive');
    }

    if (archive.technicalStatus !== 'ready') {
      throw new BadRequestException(`Archive is not ready for publication (technical status: ${archive.technicalStatus})`);
    }

    // Check or auto-create creator USDC ATA on Solana
    try {
      const connection = new Connection(this.env.solanaRpcUrl, 'confirmed');
      const creatorPubKey = new PublicKey(archive.creatorPayoutWallet);
      const creatorAta = new PublicKey(archive.creatorUsdcAta!);

      try {
        await getAccount(connection, creatorAta);
        this.logger.log(`Creator USDC ATA ${creatorAta.toBase58()} already exists`);
      } catch {
        // Account does not exist, auto-create using SolArch fee payer
        this.logger.log(`Creator USDC ATA missing. Creating ATA on-chain sponsored by SolArch...`);
        const tx = new Transaction().add(
          createAssociatedTokenAccountInstruction(
            this.env.feePayerKeypair.publicKey,
            creatorAta,
            creatorPubKey,
            this.env.usdcMint,
          ),
        );
        const sig = await sendAndConfirmTransaction(connection, tx, [this.env.feePayerKeypair]);
        this.logger.log(`Creator USDC ATA created. Signature: ${sig}`);
      }
    } catch (err) {
      this.logger.warn(`Could not verify/create creator ATA on-chain (continuing for dev/test): ${err.message}`);
    }

    const updated = await this.prisma.archive.update({
      where: { id: archiveId },
      data: {
        marketplaceStatus: 'published',
        listing: {
          update: {
            marketplaceStatus: 'published',
            publishedAt: new Date(),
          },
        },
      },
      include: { listing: true },
    });

    return {
      archive_id: updated.id,
      marketplace_status: updated.marketplaceStatus,
      published_at: updated.listing?.publishedAt,
    };
  }

  async unpublish(archiveId: string, userId: string) {
    const archive = await this.prisma.archive.findUnique({
      where: { id: archiveId },
    });

    if (!archive) {
      throw new NotFoundException('Archive not found');
    }

    if (archive.creatorUserId !== userId) {
      throw new ForbiddenException('You do not own this archive');
    }

    const updated = await this.prisma.archive.update({
      where: { id: archiveId },
      data: {
        marketplaceStatus: 'unpublished',
        listing: {
          update: {
            marketplaceStatus: 'unpublished',
          },
        },
      },
    });

    return {
      archive_id: updated.id,
      marketplace_status: updated.marketplaceStatus,
    };
  }
}
