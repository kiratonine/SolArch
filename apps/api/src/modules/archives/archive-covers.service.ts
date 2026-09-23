import {
  BadRequestException,
  ConflictException,
  Injectable,
  NotFoundException,
  PayloadTooLargeException,
} from '@nestjs/common';
import { randomUUID } from 'crypto';
import { mkdir, lstat, open, rename, unlink, writeFile } from 'fs/promises';
import * as path from 'path';
import sharp, { type Metadata, type OutputInfo, type Sharp } from 'sharp';
import { PrismaService } from '@/common/prisma.service';
import { EnvService } from '@/config/env.service';

export const MAX_COVER_BYTES = 5 * 1024 * 1024;
export const MAX_COVER_DIMENSION = 4096;
export const MAX_COVER_PIXELS = 4096 * 4096;

const COVER_KEY = /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}\.(png|jpg|webp)$/;

type CoverFormat = 'png' | 'jpeg' | 'webp';

const COVER_FORMATS: Record<CoverFormat, { extension: 'png' | 'jpg' | 'webp'; mime: string }> = {
  png: { extension: 'png', mime: 'image/png' },
  jpeg: { extension: 'jpg', mime: 'image/jpeg' },
  webp: { extension: 'webp', mime: 'image/webp' },
};

export interface CoverUpload {
  buffer: Buffer;
  mimetype: string;
  size: number;
}

export interface PublicCover {
  bytes: Buffer;
  mimeType: string;
}

interface SanitizedCover {
  bytes: Buffer;
  extension: 'png' | 'jpg' | 'webp';
}

@Injectable()
export class ArchiveCoversService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly env: EnvService,
  ) {}

  publicUrl(storageKey?: string | null): string | null {
    if (!storageKey || !COVER_KEY.test(storageKey)) return null;
    return `${this.env.publicApiOrigin}/v1/marketplace/covers/${encodeURIComponent(storageKey)}`;
  }

  async replace(archiveId: string, userId: string, upload: CoverUpload) {
    const archive = await this.prisma.archive.findUnique({
      where: { id: archiveId },
      select: {
        creatorUserId: true,
        listing: { select: { coverStorageKey: true } },
      },
    });

    // Do not disclose whether a guessed archive belongs to someone else.
    if (!archive || archive.creatorUserId !== userId || !archive.listing) {
      throw new NotFoundException({
        code: 'ARCHIVE_NOT_FOUND',
        message: 'Archive not found',
      });
    }

    const sanitized = await this.sanitize(upload);
    const storageKey = `${randomUUID()}.${sanitized.extension}`;
    const coverDirectory = this.coverDirectory();
    const finalPath = path.join(coverDirectory, storageKey);
    const temporaryPath = path.join(coverDirectory, `.upload-${randomUUID()}`);
    const previousKey = archive.listing.coverStorageKey;

    await mkdir(coverDirectory, { recursive: true, mode: 0o700 });
    try {
      await writeFile(temporaryPath, sanitized.bytes, { flag: 'wx', mode: 0o600 });
      await rename(temporaryPath, finalPath);

      const switched = await this.prisma.archiveListing.updateMany({
        where: { archiveId, coverStorageKey: previousKey },
        data: { coverStorageKey: storageKey },
      });
      if (switched.count !== 1) {
        throw new ConflictException({
          code: 'COVER_REPLACED_RETRY',
          message: 'Archive cover changed concurrently; retry the upload',
        });
      }
    } catch (error) {
      await this.removeIfPresent(temporaryPath);
      await this.removeIfPresent(finalPath);
      throw error;
    }

    // The DB already points at the durable replacement. Cleanup failure only
    // leaves an unreferenced opaque file and must not roll the cover back.
    if (previousKey && COVER_KEY.test(previousKey)) {
      await this.removeIfPresent(path.join(coverDirectory, previousKey));
    }

    return {
      archive_id: archiveId,
      cover_url: this.publicUrl(storageKey),
    };
  }

  async readPublic(storageKey: string): Promise<PublicCover> {
    if (!COVER_KEY.test(storageKey)) this.notFound();

    const listing = await this.prisma.archiveListing.findFirst({
      where: { coverStorageKey: storageKey },
      select: { id: true },
    });
    if (!listing) this.notFound();

    const filePath = path.join(this.coverDirectory(), storageKey);
    let file;
    try {
      const fileInfo = await lstat(filePath);
      if (!fileInfo.isFile() || fileInfo.isSymbolicLink() || fileInfo.size > MAX_COVER_BYTES) {
        this.notFound();
      }
      file = await open(filePath, 'r');
      const openedInfo = await file.stat();
      if (!openedInfo.isFile() || openedInfo.size !== fileInfo.size || openedInfo.size > MAX_COVER_BYTES) {
        this.notFound();
      }
      const bytes = await file.readFile();
      const format = storageKey.endsWith('.png')
        ? COVER_FORMATS.png
        : storageKey.endsWith('.jpg')
          ? COVER_FORMATS.jpeg
          : COVER_FORMATS.webp;
      return { bytes, mimeType: format.mime };
    } catch (error) {
      if (error instanceof NotFoundException) throw error;
      this.notFound();
    } finally {
      await file?.close();
    }
  }

  private async sanitize(upload: CoverUpload): Promise<SanitizedCover> {
    if (!upload?.buffer || upload.size === 0 || upload.buffer.length === 0) {
      this.invalid('Cover image is empty');
    }
    if (upload.size > MAX_COVER_BYTES || upload.buffer.length > MAX_COVER_BYTES) {
      throw new PayloadTooLargeException({
        code: 'COVER_TOO_LARGE',
        message: 'Cover image exceeds the 5 MiB limit',
      });
    }

    let metadata: Metadata;
    try {
      metadata = await this.pipeline(upload.buffer).metadata();
    } catch {
      this.invalid('Cover image could not be decoded');
    }

    const format = metadata.format as CoverFormat | undefined;
    if (!format || !(format in COVER_FORMATS)) {
      this.invalid('Cover must be PNG, JPEG or WebP');
    }
    const profile = COVER_FORMATS[format];
    if (upload.mimetype.toLowerCase() !== profile.mime) {
      this.invalid('Cover Content-Type does not match the decoded image format');
    }
    if ((metadata.pages ?? 1) !== 1) {
      this.invalid('Animated or multi-frame covers are not supported');
    }
    this.validateDimensions(metadata.width, metadata.height);

    let output: { data: Buffer; info: OutputInfo };
    try {
      const pipeline = this.pipeline(upload.buffer).rotate();
      if (format === 'png') pipeline.png({ compressionLevel: 9 });
      if (format === 'jpeg') pipeline.jpeg({ quality: 90, mozjpeg: true });
      if (format === 'webp') pipeline.webp({ quality: 90 });
      output = await pipeline.toBuffer({ resolveWithObject: true });
    } catch {
      this.invalid('Cover image could not be decoded completely');
    }

    this.validateDimensions(output.info.width, output.info.height);
    if (output.data.length > MAX_COVER_BYTES) {
      throw new PayloadTooLargeException({
        code: 'COVER_TOO_LARGE',
        message: 'Sanitized cover image exceeds the 5 MiB limit',
      });
    }

    return { bytes: output.data, extension: profile.extension };
  }

  private pipeline(bytes: Buffer): Sharp {
    return sharp(bytes, {
      failOn: 'warning',
      limitInputPixels: MAX_COVER_PIXELS,
      sequentialRead: true,
    });
  }

  private validateDimensions(width?: number, height?: number): void {
    if (
      !width ||
      !height ||
      width > MAX_COVER_DIMENSION ||
      height > MAX_COVER_DIMENSION ||
      width * height > MAX_COVER_PIXELS
    ) {
      this.invalid('Cover dimensions exceed the 4096 x 4096 pixel limit');
    }
  }

  private coverDirectory(): string {
    return path.resolve(this.env.storageRoot, 'covers');
  }

  private async removeIfPresent(filePath: string): Promise<void> {
    try {
      await unlink(filePath);
    } catch {
      // Best-effort cleanup. Only opaque, unreferenced sanitized bytes can remain.
    }
  }

  private invalid(message: string): never {
    throw new BadRequestException({ code: 'INVALID_COVER', message });
  }

  private notFound(): never {
    throw new NotFoundException({ code: 'COVER_NOT_FOUND', message: 'Cover not found' });
  }
}
