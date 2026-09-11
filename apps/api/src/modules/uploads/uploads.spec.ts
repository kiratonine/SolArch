import { Test, TestingModule } from '@nestjs/testing';
import { BadRequestException } from '@nestjs/common';
import { UploadsService } from './uploads.service';
import { PrismaService } from '@/common/prisma.service';
import { EnvService } from '@/config/env.service';
import { ArchiveBuilderAdapter } from './archive-builder.adapter';

describe('UploadsService Hardening & Validations', () => {
  let service: UploadsService;
  let prisma: any;

  beforeEach(async () => {
    prisma = {
      archive: {
        findUnique: jest.fn(),
        update: jest.fn(),
      },
      upload: {
        findUnique: jest.fn(),
        update: jest.fn(),
      },
      archivePublicFile: {
        deleteMany: jest.fn(),
        createMany: jest.fn(),
      },
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
          useValue: {
            build: jest.fn().mockResolvedValue({
              outputFilePath: './storage_data/slr/arc_001.slr',
              archiveFingerprint: 'mock_fingerprint_64_hex_chars_1111111111111111111111111111111111111',
              contentKey: Buffer.alloc(32, 1),
              sizeBytes: 1024,
            }),
          },
        },
      ],
    }).compile();

    service = module.get<UploadsService>(UploadsService);
  });

  test('init checks maximum upload size (512 MiB)', async () => {
    prisma.archive.findUnique.mockResolvedValue({
      id: 'arc_001',
      creatorUserId: 'usr_001',
    });

    await expect(
      service.init('usr_001', {
        archive_id: 'arc_001',
        filename: 'huge.zip',
        size_bytes: 600 * 1024 * 1024, // 600 MiB > 512 MiB
      }),
    ).rejects.toThrow(BadRequestException);
  });

  test('init throws NotFoundException on non-owned archive (B8)', async () => {
    prisma.archive.findUnique.mockResolvedValue({
      id: 'arc_001',
      creatorUserId: 'usr_other',
    });

    await expect(
      service.init('usr_001', {
        archive_id: 'arc_001',
        filename: 'data.zip',
        size_bytes: 1024,
      }),
    ).rejects.toThrow('Archive not found');
  });

  test('init supports file_name and file_size aliases', async () => {
    prisma.archive.findUnique.mockResolvedValue({
      id: 'arc_001',
      creatorUserId: 'usr_001',
    });
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
      archive: { creatorUserId: 'usr_001' },
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
