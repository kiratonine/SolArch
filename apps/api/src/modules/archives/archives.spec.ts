import { Test, TestingModule } from '@nestjs/testing';
import { BadRequestException } from '@nestjs/common';
import { ArchivesService } from './archives.service';
import { PrismaService } from '@/common/prisma.service';
import { EnvService } from '@/config/env.service';

describe('ArchivesService & Economics', () => {
  let service: ArchivesService;

  beforeEach(async () => {
    const module: TestingModule = await Test.createTestingModule({
      providers: [
        ArchivesService,
        {
          provide: PrismaService,
          useValue: {
            archive: {
              create: jest.fn(),
              findUnique: jest.fn(),
              update: jest.fn(),
            },
          },
        },
        {
          provide: EnvService,
          useValue: {
            usdcMint: { toBase58: () => 'USDC_MINT_DEVNET' },
          },
        },
      ],
    }).compile();

    service = module.get<ArchivesService>(ArchivesService);
  });

  test('calculates exact 95/5 integer base units split for 10.00 USDC', () => {
    const economics = service.calculateEconomics('10.00');
    expect(economics.platform_fee_bps).toBe(500);
    expect(economics.creator_share).toBe('9.50');
    expect(economics.platform_share).toBe('0.50');
    expect(economics.network_fees_paid_by).toBe('solarch');
  });

  test('calculates exact 95/5 split for irregular amount 2.37 USDC', () => {
    const economics = service.calculateEconomics('2.37');
    // total = 2_370_000
    // platform = round(2_370_000 * 500 / 10000) = 118500 = 0.12
    // creator = 2_370_000 - 118500 = 2251500 = 2.25
    expect(economics.creator_share).toBe('2.25');
    expect(economics.platform_share).toBe('0.12');
    expect(Number(economics.creator_share) + Number(economics.platform_share)).toBeCloseTo(2.37);
  });

  test('rejects negative or non-numeric price', () => {
    expect(() => service.calculateEconomics('-5.00')).toThrow(BadRequestException);
    expect(() => service.calculateEconomics('abc')).toThrow(BadRequestException);
  });

  test('formatCreatorArchive produces canonical snake_case DTO with metrics and economics', () => {
    const mockArc = {
      id: 'arc_test_123',
      creatorUserId: 'usr_001',
      title: 'Course',
      shortDescription: 'Desc',
      description: 'Full',
      priceCurrency: 'USDC',
      priceAmount: '20.00',
      technicalStatus: 'ready',
      marketplaceStatus: 'published',
      maxDevices: 1,
      allowExport: false,
      watermarkEnabled: true,
      creatorPayoutWallet: 'Wallet1111',
      creatorUsdcAta: 'Ata1111',
      createdAt: new Date('2026-09-01T00:00:00Z'),
      listing: { slug: 'course-slug', coverStorageKey: 'cover.png' },
      publicFiles: [{ sizeBytes: BigInt(2048) }],
      events: [{ eventType: 'archive_view' }, { eventType: 'archive_download' }],
      payments: [{ status: 'confirmed' }],
    };

    const formatted = service.formatCreatorArchive(mockArc);
    expect(formatted.archive_id).toBe('arc_test_123');
    expect(formatted.slug).toBe('course-slug');
    expect(formatted.economics.creator_share).toBe('19.00');
    expect(formatted.economics.platform_share).toBe('1.00');
    expect(formatted.license_policy.max_devices).toBe(1);
    expect(formatted.file_count).toBe(1);
    expect(formatted.size_bytes).toBe(2048);
    expect(formatted.metrics.views).toBe(1);
    expect(formatted.metrics.downloads).toBe(1);
    expect(formatted.metrics.paid_unlocks).toBe(1);
    expect(formatted.payout_account_ready).toBe(true);
  });
});
