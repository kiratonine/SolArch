import { Test, TestingModule } from '@nestjs/testing';
import { MarketplaceService } from './marketplace.service';
import { PrismaService } from '@/common/prisma.service';

describe('MarketplaceService Hardening', () => {
  let service: MarketplaceService;
  let prisma: any;

  beforeEach(async () => {
    prisma = {
      archiveListing: {
        findUnique: jest.fn(),
      },
      archive: {
        findMany: jest.fn(),
        count: jest.fn(),
      },
      marketplaceEvent: {
        findFirst: jest.fn(),
        create: jest.fn(),
      },
    };

    const module: TestingModule = await Test.createTestingModule({
      providers: [
        MarketplaceService,
        { provide: PrismaService, useValue: prisma },
      ],
    }).compile();

    service = module.get<MarketplaceService>(MarketplaceService);
  });

  test('deduplicates archive_view within 15-minute window for same session', async () => {
    const mockListing = {
      slug: 'test-slug',
      marketplaceStatus: 'published',
      archive: {
        id: 'arc_001',
        title: 'Test Course',
        shortDescription: '',
        description: '',
        priceAmount: '10.00',
        priceCurrency: 'USDC',
        creatorPayoutWallet: '11111111111111111111111111111111',
        creator: { wallets: [] },
        publicFiles: [],
        events: [{ eventType: 'archive_view' }],
        payments: [],
        technicalStatus: 'ready',
      },
    };

    prisma.archiveListing.findUnique.mockResolvedValue(mockListing);
    // Recent view found
    prisma.marketplaceEvent.findFirst.mockResolvedValue({ id: 'evt_recent' });

    const res = await service.getArchiveBySlug('test-slug', 'session_abc_123');
    // Did not create duplicate event
    expect(prisma.marketplaceEvent.create).not.toHaveBeenCalled();
    expect(res.metrics.views).toBe(1); // not incremented
  });

  test('records archive_view when no recent view from session exists', async () => {
    const mockListing = {
      slug: 'test-slug',
      marketplaceStatus: 'published',
      archive: {
        id: 'arc_001',
        title: 'Test Course',
        shortDescription: '',
        description: '',
        priceAmount: '10.00',
        priceCurrency: 'USDC',
        creatorPayoutWallet: '11111111111111111111111111111111',
        creator: { wallets: [] },
        publicFiles: [],
        events: [{ eventType: 'archive_view' }],
        payments: [],
        technicalStatus: 'ready',
      },
    };

    prisma.archiveListing.findUnique.mockResolvedValue(mockListing);
    // No recent view
    prisma.marketplaceEvent.findFirst.mockResolvedValue(null);

    const res = await service.getArchiveBySlug('test-slug', 'session_new_user');
    expect(prisma.marketplaceEvent.create).toHaveBeenCalled();
    expect(res.metrics.views).toBe(2);
  });
});
