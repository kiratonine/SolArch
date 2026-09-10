import {
  Injectable,
  BadRequestException,
  NotFoundException,
  ForbiddenException,
  Logger,
} from '@nestjs/common';
import * as fs from 'fs';
import * as path from 'path';
import AdmZip from 'adm-zip';
import { PrismaService } from '@/common/prisma.service';
import { EnvService } from '@/config/env.service';
import { ArchiveBuilderAdapter } from './archive-builder.adapter';
import { InitUploadDto } from './uploads.dto';

const FORBIDDEN_EXTENSIONS = new Set([
  '.exe',
  '.bat',
  '.cmd',
  '.sh',
  '.bin',
  '.msi',
  '.dll',
  '.so',
  '.dylib',
  '.vbs',
  '.js',
  '.ts',
  '.com',
  '.scr',
]);

const MIME_MAP: Record<string, string> = {
  pdf: 'application/pdf',
  png: 'image/png',
  jpg: 'image/jpeg',
  jpeg: 'image/jpeg',
  webp: 'image/webp',
  docx: 'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
  xlsx: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
};

@Injectable()
export class UploadsService {
  private readonly logger = new Logger(UploadsService.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly env: EnvService,
    private readonly archiveBuilder: ArchiveBuilderAdapter,
  ) {}

  async init(userId: string, dto: InitUploadDto) {
    const archive = await this.prisma.archive.findUnique({
      where: { id: dto.archive_id },
    });

    if (!archive) {
      throw new NotFoundException('Archive not found');
    }

    if (archive.creatorUserId !== userId) {
      throw new ForbiddenException('You do not own this archive');
    }

    const maxBytes = 512 * 1024 * 1024; // 512 MiB
    if (dto.size_bytes > maxBytes) {
      throw new BadRequestException('Uploaded archive exceeds 512 MiB size limit');
    }

    const upload = await this.prisma.upload.create({
      data: {
        archiveId: dto.archive_id,
        sourceType: 'zip',
        originalFilename: dto.filename,
        sizeBytes: BigInt(dto.size_bytes),
        storageKey: '',
        status: 'pending',
      },
    });

    await this.prisma.archive.update({
      where: { id: dto.archive_id },
      data: { technicalStatus: 'uploading' },
    });

    return {
      upload_id: upload.id,
      status: upload.status,
    };
  }

  async setUploadedFile(uploadId: string, filePath: string) {
    const upload = await this.prisma.upload.findUnique({
      where: { id: uploadId },
    });
    if (!upload) {
      throw new NotFoundException('Upload not found');
    }

    await this.prisma.upload.update({
      where: { id: uploadId },
      data: {
        storageKey: filePath,
        status: 'uploaded',
      },
    });

    return { upload_id: upload.id, status: 'uploaded' };
  }

  async complete(userId: string, uploadId: string) {
    const upload = await this.prisma.upload.findUnique({
      where: { id: uploadId },
      include: { archive: true },
    });

    if (!upload) {
      throw new NotFoundException('Upload not found');
    }

    if (upload.archive.creatorUserId !== userId) {
      throw new ForbiddenException('You do not own this archive');
    }

    if (!upload.storageKey || !fs.existsSync(upload.storageKey)) {
      throw new BadRequestException('Uploaded file not found on server');
    }

    await this.prisma.archive.update({
      where: { id: upload.archiveId },
      data: { technicalStatus: 'processing' },
    });

    // Safe inspection with adm-zip
    let zip: AdmZip;
    try {
      zip = new AdmZip(upload.storageKey);
    } catch (e) {
      await this.prisma.archive.update({
        where: { id: upload.archiveId },
        data: { technicalStatus: 'failed' },
      });
      throw new BadRequestException(`Failed to read ZIP archive: ${e.message}`);
    }

    const entries = zip.getEntries();
    const filesToInsert: Array<{
      archiveId: string;
      displayPath: string;
      displayName: string;
      fileExtension: string;
      mimeType: string;
      sizeBytes: bigint;
      sortOrder: number;
    }> = [];

    let sortOrder = 0;
    for (const entry of entries) {
      if (entry.isDirectory) continue;

      const normalized = path.normalize(entry.entryName).replace(/\\/g, '/');
      if (normalized.startsWith('..') || path.isAbsolute(normalized)) {
        await this.prisma.archive.update({
          where: { id: upload.archiveId },
          data: { technicalStatus: 'failed' },
        });
        throw new BadRequestException(`Directory traversal detected in ZIP entry: ${entry.entryName}`);
      }

      const ext = path.extname(normalized).toLowerCase();
      if (FORBIDDEN_EXTENSIONS.has(ext)) {
        await this.prisma.archive.update({
          where: { id: upload.archiveId },
          data: { technicalStatus: 'failed' },
        });
        throw new BadRequestException(`Executable content is not permitted: ${entry.entryName}`);
      }

      const cleanExt = ext.replace('.', '');
      const mime = MIME_MAP[cleanExt] || 'application/octet-stream';
      const displayName = path.basename(normalized);

      filesToInsert.push({
        archiveId: upload.archiveId,
        displayPath: normalized,
        displayName,
        fileExtension: cleanExt,
        mimeType: mime,
        sizeBytes: BigInt(entry.header.size),
        sortOrder: sortOrder++,
      });
    }

    // Build the .slr container
    const slrOutputDir = path.join(this.env.storageRoot, 'slr');
    const outputFilePath = path.join(slrOutputDir, `${upload.archiveId}.slr`);

    const buildResult = await this.archiveBuilder.build({
      archiveId: upload.archiveId,
      title: upload.archive.title,
      creatorWallet: upload.archive.creatorPayoutWallet,
      priceAmount: upload.archive.priceAmount,
      platformFeeBps: upload.archive.platformFeeBps,
      maxDevices: upload.archive.maxDevices,
      allowExport: upload.archive.allowExport,
      watermarkEnabled: upload.archive.watermarkEnabled,
      outputFilePath,
    });

    // Save files in database
    await this.prisma.archivePublicFile.deleteMany({
      where: { archiveId: upload.archiveId },
    });

    if (filesToInsert.length > 0) {
      await this.prisma.archivePublicFile.createMany({
        data: filesToInsert,
      });
    }

    // Update archive state
    const updatedArchive = await this.prisma.archive.update({
      where: { id: upload.archiveId },
      data: {
        technicalStatus: 'ready',
        archiveFingerprint: buildResult.archiveFingerprint,
        generatedSlrStorageKey: buildResult.outputFilePath,
        contentKeyRef: buildResult.contentKey.toString('hex'), // Server-side stored ACK
      },
    });

    await this.prisma.upload.update({
      where: { id: upload.id },
      data: {
        status: 'completed',
        completedAt: new Date(),
      },
    });

    return {
      archive_id: updatedArchive.id,
      technical_status: updatedArchive.technicalStatus,
      archive_fingerprint: updatedArchive.archiveFingerprint,
      file_count: filesToInsert.length,
      size_bytes: buildResult.sizeBytes,
    };
  }

  async cancel(userId: string, uploadId: string) {
    const upload = await this.prisma.upload.findUnique({
      where: { id: uploadId },
      include: { archive: true },
    });

    if (!upload) {
      throw new NotFoundException('Upload not found');
    }

    if (upload.archive.creatorUserId !== userId) {
      throw new ForbiddenException('You do not own this archive');
    }

    await this.prisma.upload.update({
      where: { id: uploadId },
      data: { status: 'cancelled' },
    });

    return { status: 'cancelled' };
  }
}
