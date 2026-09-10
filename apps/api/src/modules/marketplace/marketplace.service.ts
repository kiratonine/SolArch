import { Injectable, NotFoundException } from '@nestjs/common';
import { PrismaService } from '@/common/prisma.service';

export interface QueryMarketplaceArchives {
  sort?: string;
  search?: string;
  category?: string;
  page?: number;
  limit?: number;
}

@Injectable()
export class MarketplaceService {
  constructor(private readonly prisma: PrismaService) {}

  async listArchives(query: QueryMarketplaceArchives) {
    const page = Math.max(Number(query.page) || 1, 1);
    const limit = Math.min(Math.max(Number(query.limit) || 20, 1), 100);
    const skip = (page - 1) * limit;

    const where: any = {
      marketplaceStatus: 'published',
      technicalStatus: 'ready',
    };

    if (query.search) {
      where.OR = [
        { title: { contains: query.search, mode: 'insensitive' } },
        { shortDescription: { contains: query.search, mode: 'insensitive' } },
        { description: { contains: query.search, mode: 'insensitive' } },
      ];
    }

    if (query.category) {
      where.listing = { category: query.category };
    }

    let orderBy: any = { createdAt: 'desc' };
    if (query.sort === 'price_asc') {
      orderBy = { priceAmount: 'asc' };
    } else if (query.sort === 'price_desc') {
      orderBy = { priceAmount: 'desc' };
    }

    const [archives, total] = await Promise.all([
      this.prisma.archive.findMany({
        where,
        skip,
        take: limit,
        orderBy,
        include: {
          listing: true,
          publicFiles: true,
          creator: { include: { wallets: true } },
          events: true,
          payments: true,
        },
      }),
      this.prisma.archive.count({ where }),
    ]);

    const items = archives.map((arc) => {
      const views = arc.events.filter((e) => e.eventType === 'archive_view').length;
      const downloads = arc.events.filter((e) => e.eventType === 'archive_download').length;
      const paidUnlocks = arc.payments.filter((p) => p.status === 'confirmed').length;

      const sizeBytes = arc.publicFiles.reduce((acc, f) => acc + Number(f.sizeBytes), 0);

      return {
        archive_id: arc.id,
        slug: arc.listing?.slug || arc.id,
        title: arc.title,
        short_description: arc.shortDescription,
        cover_url: arc.listing?.coverStorageKey || null,
        creator: {
          display_name: arc.creator.wallets[0]?.address
            ? `${arc.creator.wallets[0].address.slice(0, 4)}...${arc.creator.wallets[0].address.slice(-4)}`
            : 'Creator',
        },
        price: {
          amount: arc.priceAmount,
          currency: arc.priceCurrency,
        },
        file_count: arc.publicFiles.length,
        size_bytes: sizeBytes,
        metrics: {
          views,
          downloads,
          paid_unlocks: paidUnlocks,
        },
      };
    });

    // Handle popularity / most_downloaded in-memory sort if requested
    if (query.sort === 'most_downloaded') {
      items.sort((a, b) => b.metrics.downloads - a.metrics.downloads);
    } else if (query.sort === 'popular_week' || query.sort === 'popular_month') {
      items.sort((a, b) => {
        if (b.metrics.paid_unlocks !== a.metrics.paid_unlocks) {
          return b.metrics.paid_unlocks - a.metrics.paid_unlocks;
        }
        return b.metrics.downloads - a.metrics.downloads;
      });
    }

    return {
      items,
      pagination: {
        page,
        limit,
        total,
        total_pages: Math.ceil(total / limit),
      },
    };
  }

  async getArchiveBySlug(slug: string, sessionId?: string) {
    const listing = await this.prisma.archiveListing.findUnique({
      where: { slug },
      include: {
        archive: {
          include: {
            publicFiles: true,
            creator: { include: { wallets: true } },
            events: true,
            payments: true,
          },
        },
      },
    });

    if (!listing || listing.marketplaceStatus !== 'published') {
      throw new NotFoundException('Archive not found or not published');
    }

    const arc = listing.archive;
    const views = arc.events.filter((e) => e.eventType === 'archive_view').length;
    const downloads = arc.events.filter((e) => e.eventType === 'archive_download').length;
    const paidUnlocks = arc.payments.filter((p) => p.status === 'confirmed').length;
    const sizeBytes = arc.publicFiles.reduce((acc, f) => acc + Number(f.sizeBytes), 0);

    // Record archive_view event
    await this.prisma.marketplaceEvent.create({
      data: {
        archiveId: arc.id,
        eventType: 'archive_view',
        anonymousSessionId: sessionId || null,
      },
    });

    return {
      archive_id: arc.id,
      slug: listing.slug,
      title: arc.title,
      short_description: arc.shortDescription,
      description: arc.description,
      price: {
        amount: arc.priceAmount,
        currency: arc.priceCurrency,
      },
      creator: {
        display_name: arc.creator.wallets[0]?.address
          ? `${arc.creator.wallets[0].address.slice(0, 4)}...${arc.creator.wallets[0].address.slice(-4)}`
          : 'Creator',
        wallet: arc.creator.wallets[0]?.address,
      },
      file_count: arc.publicFiles.length,
      size_bytes: sizeBytes,
      access_rules: {
        max_devices: arc.maxDevices,
        allow_export: arc.allowExport,
        watermark_enabled: arc.watermarkEnabled,
      },
      metrics: {
        views: views + 1,
        downloads,
        paid_unlocks: paidUnlocks,
      },
      download_availability: arc.technicalStatus === 'ready',
    };
  }

  async getFilesBySlug(slug: string) {
    const listing = await this.prisma.archiveListing.findUnique({
      where: { slug },
      include: {
        archive: {
          include: {
            publicFiles: {
              where: { isPubliclyListed: true },
              orderBy: { sortOrder: 'asc' },
            },
          },
        },
      },
    });

    if (!listing || listing.marketplaceStatus !== 'published') {
      throw new NotFoundException('Archive not found');
    }

    return {
      files: listing.archive.publicFiles.map((f) => ({
        display_path: f.displayPath,
        display_name: f.displayName,
        extension: f.fileExtension,
        mime_type: f.mimeType,
        size_bytes: Number(f.sizeBytes),
      })),
    };
  }

  async recordDownload(archiveId: string, sessionId?: string) {
    await this.prisma.marketplaceEvent.create({
      data: {
        archiveId,
        eventType: 'archive_download',
        anonymousSessionId: sessionId || null,
      },
    });
  }

  async getViewerArchiveMetadata(archiveId: string) {
    const archive = await this.prisma.archive.findUnique({
      where: { id: archiveId },
    });

    if (!archive) {
      throw new NotFoundException('Archive not found');
    }

    return {
      archive_id: archive.id,
      status: archive.marketplaceStatus,
      title: archive.title,
      price: {
        amount: archive.priceAmount,
        currency: archive.priceCurrency,
      },
      creator: {
        wallet: archive.creatorPayoutWallet,
      },
      license_policy: {
        max_devices: archive.maxDevices,
        allow_export: archive.allowExport,
        watermark_enabled: archive.watermarkEnabled,
      },
      archive_fingerprint: archive.archiveFingerprint,
    };
  }
}
