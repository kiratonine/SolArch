import { Test, TestingModule } from '@nestjs/testing';
import { BadRequestException, ConflictException } from '@nestjs/common';
import { UploadsService } from './uploads.service';
import { PrismaService } from '@/common/prisma.service';
import { EnvService } from '@/config/env.service';
import { ArchiveBuilderAdapter } from './archive-builder.adapter';

describe('UploadsService Hardening & Validations', () => {
  let service: UploadsService;
  let prisma: any;
  let archiveBuilder: any;
  let ackCustody: any;

  const mutableArchive = {
    id: 'arc_001',
    creatorUserId: 'usr_001',
    technicalStatus: 'draft',
    marketplaceStatus: 'draft',
    archiveFingerprint: null,
    contentKeyRef: null,
    generatedSlrStorageKey: null,
    _count: { payments: 0 },
  };

  beforeEach(async () => {
    prisma = {
      archive: {
        findUnique: jest.fn(),
        update: jest.fn(),
        updateMany: jest.fn().mockResolvedValue({ count: 1 }),
      },
      upload: {
        create: jest.fn(),
        findUnique: jest.fn(),
        update: jest.fn(),
      },
      archivePublicFile: {
        deleteMany: jest.fn(),
        createMany: jest.fn(),
      },
    };
    archiveBuilder = {
      build: jest.fn().mockResolvedValue({
        outputFilePath: './storage_data/slr/arc_001.slr',
        archiveFingerprint: 'a'.repeat(64),
        contentKey: Buffer.alloc(32, 1),
        sizeBytes: 1024,
      }),
    };
    ackCustody = {
      seal: jest.fn().mockResolvedValue({ contentKeyRef: 'ack_ref_001' }),
      unseal: jest.fn().mockResolvedValue(Buffer.alloc(32, 1)),
    };

    const module: TestingModule = await Test.createTestingModule({
      providers: [
        UploadsService,
        { provide: PrismaService, useValue: prisma },
        {
          provide: EnvService,
          useValue: {
            storageRoot: './storage_data',
          },
        },
        {
          provide: ArchiveBuilderAdapter,
          useValue: archiveBuilder,
        },
        {
          provide: require('./ack-custody.service').AckCustodyService,
          useValue: ackCustody,
        },
      ],
    }).compile();

    service = module.get<UploadsService>(UploadsService);
  });

  test('init checks maximum upload size (512 MiB)', async () => {
    prisma.archive.findUnique.mockResolvedValue(mutableArchive);

    await expect(
      service.init('usr_001', {
        archive_id: 'arc_001',
        filename: 'huge.zip',
        size_bytes: 600 * 1024 * 1024, // 600 MiB > 512 MiB
      }),
    ).rejects.toThrow(BadRequestException);
  });

  test('init throws NotFoundException on non-owned archive (B8)', async () => {
    prisma.archive.findUnique.mockResolvedValue({ ...mutableArchive, creatorUserId: 'usr_other' });

    await expect(
      service.init('usr_001', {
        archive_id: 'arc_001',
        filename: 'data.zip',
        size_bytes: 1024,
      }),
    ).rejects.toThrow('Archive not found');
  });

  test('init supports file_name and file_size aliases', async () => {
    prisma.archive.findUnique.mockResolvedValue(mutableArchive);
    prisma.upload.create = jest.fn().mockResolvedValue({
      id: 'upl_001',
      status: 'pending',
    });

    const res = await service.init('usr_001', {
      archive_id: 'arc_001',
      file_name: 'data.zip',
      file_size: 1024,
    } as any);

    expect(res.upload_id).toBe('upl_001');
    expect(prisma.upload.create).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({
          originalFilename: 'data.zip',
          sizeBytes: BigInt(1024),
        }),
      }),
    );
    expect(prisma.archive.updateMany).toHaveBeenCalledWith(
      expect.objectContaining({
        where: expect.objectContaining({
          archiveFingerprint: null,
          contentKeyRef: null,
          generatedSlrStorageKey: null,
          marketplaceStatus: 'draft',
        }),
      }),
    );
  });

  test.each([
    ['ready', { technicalStatus: 'ready' }],
    ['published', { marketplaceStatus: 'published' }],
    ['unpublished', { marketplaceStatus: 'unpublished' }],
    ['paid', { _count: { payments: 1 } }],
    ['fingerprinted', { archiveFingerprint: 'a'.repeat(64) }],
    ['ACK-custodied', { contentKeyRef: 'ack_ref_existing' }],
  ])('denies upload initialization for immutable %s archive', async (_label, override) => {
    prisma.archive.findUnique.mockResolvedValue({ ...mutableArchive, ...override });

    await expect(
      service.init('usr_001', {
        archive_id: 'arc_001',
        filename: 'replacement.zip',
        size_bytes: 1024,
      }),
    ).rejects.toThrow(ConflictException);
    expect(prisma.archive.updateMany).not.toHaveBeenCalled();
    expect(prisma.upload.create).not.toHaveBeenCalled();
  });

  test('ready archive completion cannot rebuild bytes or change fingerprint/ACK custody', async () => {
    prisma.upload.findUnique.mockResolvedValue({
      id: 'upl_old',
      archiveId: 'arc_001',
      storageKey: './stale.zip',
      archive: {
        ...mutableArchive,
        technicalStatus: 'ready',
        archiveFingerprint: 'a'.repeat(64),
        contentKeyRef: 'ack_ref_existing',
        generatedSlrStorageKey: './storage_data/slr/arc_001.slr',
      },
    });

    await expect(service.complete('usr_001', 'upl_old')).rejects.toThrow(ConflictException);
    expect(archiveBuilder.build).not.toHaveBeenCalled();
    expect(ackCustody.seal).not.toHaveBeenCalled();
    expect(prisma.archive.update).not.toHaveBeenCalled();
  });

  test('assertUploadOwner throws NotFoundException if caller is not owner (B3, B8)', async () => {
    prisma.upload.findUnique.mockResolvedValue({
      id: 'upl_001',
      archive: { creatorUserId: 'usr_real_owner' },
    });

    await expect(service.assertUploadOwner('usr_intruder', 'upl_001')).rejects.toThrow('Upload not found');
  });

  test('cancel reverts archive technicalStatus to draft when no files exist (B6)', async () => {
    prisma.upload.findUnique.mockResolvedValue({
      id: 'upl_001',
      archiveId: 'arc_001',
      archive: mutableArchive,
    });
    prisma.archivePublicFile.count = jest.fn().mockResolvedValue(0);

    const res = await service.cancel('usr_001', 'upl_001');
    expect(res.status).toBe('cancelled');
    expect(prisma.archive.update).toHaveBeenCalledWith({
      where: { id: 'arc_001' },
      data: { technicalStatus: 'draft' },
    });
  });
});
