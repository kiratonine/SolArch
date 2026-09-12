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

  test('getArchiveBySlug includes cover_url and id alias (B2)', async () => {
    const mockListing = {
      slug: 'cover-slug',
      coverStorageKey: 'covers/cover1.jpg',
      marketplaceStatus: 'published',
      archive: {
        id: 'arc_cover_1',
        title: 'Cover Course',
        shortDescription: 'Desc',
        description: 'Full',
        priceAmount: '15.00',
        priceCurrency: 'USDC',
        creatorPayoutWallet: '11111111111111111111111111111111',
        creator: { wallets: [] },
        publicFiles: [],
        events: [],
        payments: [],
        technicalStatus: 'ready',
      },
    };

    prisma.archiveListing.findUnique.mockResolvedValue(mockListing);
    prisma.marketplaceEvent.findFirst.mockResolvedValue({ id: 'evt_1' });

    const res = await service.getArchiveBySlug('cover-slug', 'sess_1');
    expect(res.cover_url).toBe('covers/cover1.jpg');
    expect(res.id).toBe('arc_cover_1');
    expect(res.archive_id).toBe('arc_cover_1');
  });

  test('listArchives sorts globally across pages for popularity sorts (B4)', async () => {
    const arcLow = {
      id: 'arc_low',
      title: 'Low Downloads',
      shortDescription: '',
      priceAmount: '10.00',
      priceCurrency: 'USDC',
      listing: { slug: 'low' },
      creator: { wallets: [] },
      publicFiles: [],
      events: [{ eventType: 'archive_download' }], // 1 download
      payments: [],
    };
    const arcHigh = {
      id: 'arc_high',
      title: 'High Downloads',
      shortDescription: '',
      priceAmount: '10.00',
      priceCurrency: 'USDC',
      listing: { slug: 'high' },
      creator: { wallets: [] },
      publicFiles: [],
      events: [
        { eventType: 'archive_download' },
        { eventType: 'archive_download' },
        { eventType: 'archive_download' },
      ], // 3 downloads
      payments: [],
    };

    // Return in order [low, high]
    prisma.archive.findMany.mockResolvedValue([arcLow, arcHigh]);
    prisma.archive.count.mockResolvedValue(2);

    const res = await service.listArchives({
      sort: 'most_downloaded',
      page: 1,
      limit: 1,
    });

    // Page 1 should contain arcHigh first because it has more downloads globally
    expect(res.items.length).toBe(1);
    expect(res.items[0].archive_id).toBe('arc_high');
    expect(res.total).toBe(2);
    expect(res.has_more).toBe(true);
  });
});
