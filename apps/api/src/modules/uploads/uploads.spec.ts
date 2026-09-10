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
});
