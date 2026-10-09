import { BadRequestException, NotFoundException, PayloadTooLargeException } from '@nestjs/common';
import { mkdtemp, mkdir, readFile, readdir, rm, writeFile } from 'fs/promises';
import { tmpdir } from 'os';
import * as path from 'path';
import sharp from 'sharp';
import { PrismaService } from '@/common/prisma.service';
import { EnvService } from '@/config/env.service';
import {
  ArchiveCoversService,
  MAX_COVER_BYTES,
  type CoverUpload,
} from './archive-covers.service';

const USER_ID = 'usr_cover_owner';
const ARCHIVE_ID = 'arc_cover_test';
const OLD_KEY = '11111111-1111-4111-8111-111111111111.jpg';

describe('ArchiveCoversService', () => {
  let storageRoot: string;
  let prisma: any;
  let service: ArchiveCoversService;
  let png: Buffer;

  beforeEach(async () => {
    storageRoot = await mkdtemp(path.join(tmpdir(), 'solarch-cover-test-'));
    prisma = {
      archive: {
        findUnique: jest.fn().mockResolvedValue({
          creatorUserId: USER_ID,
          listing: { coverStorageKey: null },
        }),
      },
      archiveListing: {
        updateMany: jest.fn().mockResolvedValue({ count: 1 }),
        findFirst: jest.fn().mockResolvedValue({ id: 'listing_1' }),
      },
    };
    service = new ArchiveCoversService(
      prisma as PrismaService,
      {
        storageRoot,
        publicApiOrigin: 'https://api.solarch.example',
      } as EnvService,
    );
    png = await sharp({
      create: {
        width: 1200,
        height: 630,
        channels: 4,
        background: { r: 18, g: 22, b: 27, alpha: 1 },
      },
    })
      .png()
      .toBuffer();
  });

  afterEach(async () => {
    await rm(storageRoot, { recursive: true, force: true });
  });

  function upload(buffer: Buffer, mimetype = 'image/png'): CoverUpload {
    return { buffer, mimetype, size: buffer.length };
  }

  test('decodes, sanitizes and publishes a valid image under an opaque generated key', async () => {
    const result = await service.replace(ARCHIVE_ID, USER_ID, upload(png));

    expect(result.archive_id).toBe(ARCHIVE_ID);
    expect(result.cover_url).toMatch(
      /^https:\/\/api\.solarch\.example\/v1\/marketplace\/covers\/[0-9a-f-]+\.png$/,
    );
    const storageKey = decodeURIComponent(result.cover_url!.split('/').at(-1)!);
    const stored = await readFile(path.join(storageRoot, 'covers', storageKey));
    const metadata = await sharp(stored).metadata();
    expect(metadata).toMatchObject({ format: 'png', width: 1200, height: 630 });
    expect(prisma.archiveListing.updateMany).toHaveBeenCalledWith({
      where: { archiveId: ARCHIVE_ID, coverStorageKey: null },
      data: { coverStorageKey: storageKey },
    });
  });

  test('rejects a claimed MIME that does not match real decoded bytes and rejects non-images', async () => {
    const jpeg = await sharp(png).jpeg().toBuffer();

    await expect(service.replace(ARCHIVE_ID, USER_ID, upload(jpeg, 'image/png'))).rejects.toThrow(
      BadRequestException,
    );
    await expect(
      service.replace(
        ARCHIVE_ID,
        USER_ID,
        upload(Buffer.from('<html><script>alert(1)</script></html>'), 'image/png'),
      ),
    ).rejects.toThrow(BadRequestException);
    expect(prisma.archiveListing.updateMany).not.toHaveBeenCalled();
  });

  test('rejects encoded size and decoded dimension limits before persistence', async () => {
    await expect(
      service.replace(
        ARCHIVE_ID,
        USER_ID,
        upload(Buffer.alloc(MAX_COVER_BYTES + 1), 'image/png'),
      ),
    ).rejects.toThrow(PayloadTooLargeException);

    const tooWide = await sharp({
      create: {
        width: 4097,
        height: 1,
        channels: 3,
        background: { r: 0, g: 0, b: 0 },
      },
    })
      .png()
      .toBuffer();
    await expect(service.replace(ARCHIVE_ID, USER_ID, upload(tooWide))).rejects.toThrow(
      BadRequestException,
    );
    expect(prisma.archiveListing.updateMany).not.toHaveBeenCalled();
  });

  test('fails closed for another creator before decoding or writing content', async () => {
    prisma.archive.findUnique.mockResolvedValue({
      creatorUserId: 'usr_someone_else',
      listing: { coverStorageKey: null },
    });

    await expect(service.replace(ARCHIVE_ID, USER_ID, upload(png))).rejects.toThrow(
      NotFoundException,
    );
    expect(prisma.archiveListing.updateMany).not.toHaveBeenCalled();
    await expect(readdir(storageRoot)).resolves.toEqual([]);
  });

  test('keeps the previous cover when the durable DB switch fails', async () => {
    const coverDirectory = path.join(storageRoot, 'covers');
    await mkdir(coverDirectory, { recursive: true });
    const previous = Buffer.from('previous sanitized cover');
    await writeFile(path.join(coverDirectory, OLD_KEY), previous);
    prisma.archive.findUnique.mockResolvedValue({
      creatorUserId: USER_ID,
      listing: { coverStorageKey: OLD_KEY },
    });
    prisma.archiveListing.updateMany.mockRejectedValue(new Error('database unavailable'));

    await expect(service.replace(ARCHIVE_ID, USER_ID, upload(png))).rejects.toThrow(
      'database unavailable',
    );
    await expect(readFile(path.join(coverDirectory, OLD_KEY))).resolves.toEqual(previous);
    await expect(readdir(coverDirectory)).resolves.toEqual([OLD_KEY]);
  });

  test('serves only a current referenced opaque key with the validated media type', async () => {
    const result = await service.replace(ARCHIVE_ID, USER_ID, upload(png));
    const storageKey = decodeURIComponent(result.cover_url!.split('/').at(-1)!);

    const cover = await service.readPublic(storageKey);
    expect(cover.mimeType).toBe('image/png');
    expect((await sharp(cover.bytes).metadata()).format).toBe('png');

    prisma.archiveListing.findFirst.mockResolvedValue(null);
    await expect(service.readPublic(storageKey)).rejects.toThrow(NotFoundException);
    await expect(service.readPublic('../../.env')).rejects.toThrow(NotFoundException);
  });
});
