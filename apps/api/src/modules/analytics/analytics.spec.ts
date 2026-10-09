import { Test, TestingModule } from '@nestjs/testing';
import { AnalyticsService } from './analytics.service';
import { PrismaService } from '@/common/prisma.service';

describe('AnalyticsService', () => {
  let service: AnalyticsService;
  let prisma: any;

  beforeEach(async () => {
    prisma = {
      archive: {
        findUnique: jest.fn(),
      },
      marketplaceEvent: {
        findMany: jest.fn(),
      },
      payment: {
        findMany: jest.fn(),
      },
    };

    const module: TestingModule = await Test.createTestingModule({
      providers: [
        AnalyticsService,
        { provide: PrismaService, useValue: prisma },
      ],
    }).compile();

    service = module.get<AnalyticsService>(AnalyticsService);
  });

  test('calculates correct conversions, views, downloads and 95/5 gross/creator/platform revenue', async () => {
    prisma.archive.findUnique.mockResolvedValue({
      id: 'arc_001',
      creatorUserId: 'usr_001',
      priceAmount: '10.00',
      platformFeeBps: 500,
    });

    // 100 views, 25 downloads
    const events = [
      ...Array(100).fill({ eventType: 'archive_view' }),
      ...Array(25).fill({ eventType: 'archive_download' }),
    ];
    prisma.marketplaceEvent.findMany.mockResolvedValue(events);

    // 5 confirmed payments
    const payments = Array(5).fill({
      status: 'confirmed',
      paymentIntent: {},
    });
    prisma.payment.findMany.mockResolvedValue(payments);

    const res = await service.getArchiveAnalytics('arc_001', 'usr_001', 'all');

    expect(res.views).toBe(100);
    expect(res.downloads).toBe(25);
    expect(res.paid_unlocks).toBe(5);

    // conversions: view_to_download = 25/100 = 0.25
    // download_to_purchase = 5/25 = 0.20
    expect(res.conversions.view_to_download).toBe(0.25);
    expect(res.conversions.download_to_purchase).toBe(0.2);

    // revenue: 5 * 10 = 50.00 gross; creator = 47.50; platform = 2.50
    expect(res.revenue.gross).toBe('50.00');
    expect(res.revenue.creator).toBe('47.50');
    expect(res.revenue.platform).toBe('2.50');
    expect(res.revenue.currency).toBe('USDC');
  });
});
