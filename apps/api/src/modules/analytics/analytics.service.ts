import {
  Injectable,
  NotFoundException,
  ForbiddenException,
} from '@nestjs/common';
import { PrismaService } from '@/common/prisma.service';

@Injectable()
export class AnalyticsService {
  constructor(private readonly prisma: PrismaService) {}

  async getArchiveAnalytics(archiveId: string, userId: string, period = 'all') {
    const archive = await this.prisma.archive.findUnique({
      where: { id: archiveId },
    });

    if (!archive) {
      throw new NotFoundException('Archive not found');
    }

    if (archive.creatorUserId !== userId) {
      throw new ForbiddenException('You do not own this archive');
    }

    let sinceDate: Date | null = null;
    const now = new Date();
    if (period === '7d') {
      sinceDate = new Date(now.getTime() - 7 * 24 * 60 * 60 * 1000);
    } else if (period === '30d') {
      sinceDate = new Date(now.getTime() - 30 * 24 * 60 * 60 * 1000);
    }

    const eventWhere: any = { archiveId };
    const paymentWhere: any = { archiveId, status: 'confirmed' };
    if (sinceDate) {
      eventWhere.occurredAt = { gte: sinceDate };
      paymentWhere.confirmedAt = { gte: sinceDate };
    }

    const [events, payments] = await Promise.all([
      this.prisma.marketplaceEvent.findMany({ where: eventWhere }),
      this.prisma.payment.findMany({
        where: paymentWhere,
        include: { paymentIntent: true },
      }),
    ]);

    const views = events.filter((e) => e.eventType === 'archive_view').length;
    const downloads = events.filter((e) => e.eventType === 'archive_download').length;
    const paidUnlocks = payments.length;

    const viewToDownload = views > 0 ? parseFloat((downloads / views).toFixed(4)) : 0;
    const downloadToPurchase = downloads > 0 ? parseFloat((paidUnlocks / downloads).toFixed(4)) : 0;

    let grossUnits = 0;
    let creatorUnits = 0;
    let platformUnits = 0;

    for (const payment of payments) {
      const priceNum = parseFloat(archive.priceAmount);
      const units = Math.round(priceNum * 1_000_000);
      const plat = Math.round((units * archive.platformFeeBps) / 10000);
      const creat = units - plat;

      grossUnits += units;
      creatorUnits += creat;
      platformUnits += plat;
    }

    return {
      period,
      views,
      downloads,
      paid_unlocks: paidUnlocks,
      conversions: {
        view_to_download: viewToDownload,
        download_to_purchase: downloadToPurchase,
      },
      revenue: {
        gross: (grossUnits / 1_000_000).toFixed(2),
        creator: (creatorUnits / 1_000_000).toFixed(2),
        platform: (platformUnits / 1_000_000).toFixed(2),
        currency: 'USDC',
      },
    };
  }
}
