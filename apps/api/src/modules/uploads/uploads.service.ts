import {
  Injectable,
  BadRequestException,
  ConflictException,
  NotFoundException,
  Logger,
} from '@nestjs/common';
import * as fs from 'fs';
import * as path from 'path';
import * as AdmZipModule from 'adm-zip';
const AdmZip = (AdmZipModule as any).default || AdmZipModule;
type AdmZip = import('adm-zip');
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

const SUPPORTED_EXTENSIONS = new Set([
  'pdf',
  'png',
  'jpg',
  'jpeg',
  'webp',
  'docx',
  'xlsx',
]);

const MAX_FILES_LIMIT = 10_000;
const MAX_UNCOMPRESSED_TOTAL_BYTES = 512 * 1024 * 1024; // 512 MiB

import { AckCustodyService } from './ack-custody.service';
import { zeroizeBuffer } from '@/crypto/token32.util';

@Injectable()
export class UploadsService {
  private readonly logger = new Logger(UploadsService.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly env: EnvService,
    private readonly archiveBuilder: ArchiveBuilderAdapter,
    private readonly ackCustody: AckCustodyService,
  ) {}

  private isArchiveFinalized(archive: any): boolean {
    return (
      archive.technicalStatus === 'ready' ||
      archive.marketplaceStatus !== 'draft' ||
      archive.archiveFingerprint != null ||
      archive.contentKeyRef != null ||
      archive.generatedSlrStorageKey != null ||
      (archive._count?.payments ?? 0) > 0
    );
  }

  private assertArchiveMutable(archive: any): void {
    if (this.isArchiveFinalized(archive)) {
      throw new ConflictException({
        code: 'ARCHIVE_IMMUTABLE',
        message: 'Finalized, listed, or paid archive content is immutable; create a new Archive ID',
      });
    }
  }

  async init(userId: string, dto: InitUploadDto) {
    const archive = await this.prisma.archive.findUnique({
      where: { id: dto.archive_id },
      include: { _count: { select: { payments: true } } },
    });

    if (!archive) {
      throw new NotFoundException('Archive not found');
    }

    if (archive.creatorUserId !== userId) {
      throw new NotFoundException('Archive not found');
    }
    this.assertArchiveMutable(archive);

    const filename = dto.filename || dto.file_name;
    const sizeBytes = dto.size_bytes !== undefined ? dto.size_bytes : dto.file_size;

    if (!filename || sizeBytes === undefined) {
      throw new BadRequestException('filename and size_bytes are required');
    }

    const maxBytes = 512 * 1024 * 1024; // 512 MiB
    if (sizeBytes > maxBytes) {
      throw new BadRequestException('Uploaded archive exceeds 512 MiB size limit');
    }

    const claimed = await this.prisma.archive.updateMany({
      where: {
        id: dto.archive_id,
        technicalStatus: { not: 'ready' },
        marketplaceStatus: 'draft',
        archiveFingerprint: null,
        contentKeyRef: null,
        generatedSlrStorageKey: null,
        payments: { none: {} },
      },
      data: { technicalStatus: 'uploading' },
    });
    if (claimed.count !== 1) {
      throw new ConflictException({
        code: 'ARCHIVE_IMMUTABLE',
        message: 'Archive became immutable while upload was being initialized',
      });
    }

    const upload = await this.prisma.upload.create({
      data: {
        archiveId: dto.archive_id,
        sourceType: 'zip',
        originalFilename: filename,
        sizeBytes: BigInt(sizeBytes),
        storageKey: '',
        status: 'pending',
      },
    });

    return {
      upload_id: upload.id,
      status: upload.status,
      upload_url: `/v1/uploads/${upload.id}/data`,
    };
  }

  async assertUploadOwner(userId: string, uploadId: string) {
    const upload = await this.prisma.upload.findUnique({
      where: { id: uploadId },
      include: { archive: { include: { _count: { select: { payments: true } } } } },
    });

    if (!upload) {
      throw new NotFoundException('Upload not found');
    }

    if (upload.archive.creatorUserId !== userId) {
      throw new NotFoundException('Upload not found');
    }

    return upload;
  }

  async setUploadedFile(userId: string, uploadId: string, filePath: string) {
    const upload = await this.prisma.upload.findUnique({
      where: { id: uploadId },
      include: { archive: { include: { _count: { select: { payments: true } } } } },
    });
    if (!upload) {
      if (fs.existsSync(filePath)) {
        try {
          fs.unlinkSync(filePath);
        } catch {}
      }
      throw new NotFoundException('Upload not found');
    }

    if (upload.archive.creatorUserId !== userId) {
      if (fs.existsSync(filePath)) {
        try {
          fs.unlinkSync(filePath);
        } catch {}
      }
      throw new NotFoundException('Upload not found');
    }

    try {
      this.assertArchiveMutable(upload.archive);
    } catch (error) {
      if (fs.existsSync(filePath)) {
        try {
          fs.unlinkSync(filePath);
        } catch {}
      }
      throw error;
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
      include: { archive: { include: { _count: { select: { payments: true } } } } },
    });

    if (!upload) {
      throw new NotFoundException('Upload not found');
    }

    if (upload.archive.creatorUserId !== userId) {
      throw new NotFoundException('Upload not found');
    }
    this.assertArchiveMutable(upload.archive);

    if (!upload.storageKey || !fs.existsSync(upload.storageKey)) {
      throw new BadRequestException('Uploaded file not found on server');
    }

    if (
      upload.archive.priceCurrency !== 'USDC' ||
      upload.archive.platformFeeBps !== 500 ||
      upload.archive.maxDevices !== 1 ||
      upload.archive.allowExport !== false ||
      upload.archive.watermarkEnabled !== true
    ) {
      throw new BadRequestException({
        code: 'INVALID_REQUEST',
        message: 'Archive policy does not match the frozen SolArch MVP policy',
      });
    }

    const claimed = await this.prisma.archive.updateMany({
      where: {
        id: upload.archiveId,
        technicalStatus: 'uploading',
        marketplaceStatus: 'draft',
        archiveFingerprint: null,
        contentKeyRef: null,
        generatedSlrStorageKey: null,
        payments: { none: {} },
      },
      data: { technicalStatus: 'processing' },
    });
    if (claimed.count !== 1) {
      throw new ConflictException({
        code: 'ARCHIVE_IMMUTABLE',
        message: 'Archive became immutable before upload completion',
      });
    }

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
    if (entries.length > MAX_FILES_LIMIT) {
      await this.prisma.archive.update({
        where: { id: upload.archiveId },
        data: { technicalStatus: 'failed' },
      });
      throw new BadRequestException(`Archive contains too many files (max ${MAX_FILES_LIMIT})`);
    }

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
    let totalUncompressedBytes = 0;

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

      // Skip macOS metadata files
      if (normalized.startsWith('__MACOSX/') || normalized.endsWith('.DS_Store')) {
        continue;
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
      if (!SUPPORTED_EXTENSIONS.has(cleanExt)) {
        await this.prisma.archive.update({
          where: { id: upload.archiveId },
          data: { technicalStatus: 'failed' },
        });
        throw new BadRequestException(
          `Unsupported file format in archive: ${entry.entryName}. Supported formats in MVP are: PDF, PNG, JPG, JPEG, WebP, DOCX, XLSX`,
        );
      }

      totalUncompressedBytes += entry.header.size;
      if (totalUncompressedBytes > MAX_UNCOMPRESSED_TOTAL_BYTES) {
        await this.prisma.archive.update({
          where: { id: upload.archiveId },
          data: { technicalStatus: 'failed' },
        });
        throw new BadRequestException('Total uncompressed content exceeds 512 MiB limit');
      }

      const mime = MIME_MAP[cleanExt];
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

    if (filesToInsert.length === 0) {
      await this.prisma.archive.update({
        where: { id: upload.archiveId },
        data: { technicalStatus: 'failed' },
      });
      throw new BadRequestException('Uploaded archive contains no valid supported files');
    }

    // Prepare private temporary directory with clean source files for solarch-cli
    const stagingSourceDir = path.join(this.env.storageRoot, 'staging', `${upload.archiveId}_${Date.now()}`);
    fs.mkdirSync(stagingSourceDir, { recursive: true });

    let buildResult: any;
    try {
      for (const entry of entries) {
        if (entry.isDirectory) continue;
        const normalized = path.normalize(entry.entryName).replace(/\\/g, '/');
        if (normalized.startsWith('__MACOSX/') || normalized.endsWith('.DS_Store')) continue;
        const ext = path.extname(normalized).toLowerCase().replace('.', '');
        if (!SUPPORTED_EXTENSIONS.has(ext)) continue;

        const targetPath = path.join(stagingSourceDir, normalized);
        const targetParent = path.dirname(targetPath);
        if (!fs.existsSync(targetParent)) {
          fs.mkdirSync(targetParent, { recursive: true });
        }
        fs.writeFileSync(targetPath, entry.getData());
      }

      // Build the .slr container
      const slrOutputDir = path.join(this.env.storageRoot, 'slr');
      const outputFilePath = path.join(slrOutputDir, `${upload.archiveId}.slr`);

      buildResult = await this.archiveBuilder.build({
        archiveId: upload.archiveId,
        title: upload.archive.title,
        creatorWallet: upload.archive.creatorPayoutWallet,
        priceAmount: upload.archive.priceAmount,
        platformFeeBps: upload.archive.platformFeeBps,
        maxDevices: upload.archive.maxDevices,
        allowExport: upload.archive.allowExport,
        watermarkEnabled: upload.archive.watermarkEnabled,
        sourceFilesDir: stagingSourceDir,
        outputFilePath,
      });
    } finally {
      if (fs.existsSync(stagingSourceDir)) {
        try {
          fs.rmSync(stagingSourceDir, { recursive: true, force: true });
        } catch {
          // best-effort cleanup
        }
      }
    }

    // Seal ACK in encrypted custody (INTEGRATION.md §5.1)
    let contentKeyRef: string;
    try {
      ({ contentKeyRef } = await this.ackCustody.seal(
        upload.archiveId,
        buildResult.archiveFingerprint,
        buildResult.contentKey,
      ));
    } finally {
      zeroizeBuffer(buildResult.contentKey);
    }

    // Save files in database only after the plaintext ACK has left memory.
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
        contentKeyRef,
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
      upload_id: upload.id,
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
      include: { archive: { include: { _count: { select: { payments: true } } } } },
    });

    if (!upload) {
      throw new NotFoundException('Upload not found');
    }

    if (upload.archive.creatorUserId !== userId) {
      throw new NotFoundException('Upload not found');
    }

    await this.prisma.upload.update({
      where: { id: uploadId },
      data: { status: 'cancelled' },
    });

    // Cancelling a stale upload must never mutate a finalized archive.
    if (this.isArchiveFinalized(upload.archive)) {
      return { status: 'cancelled' };
    }

    // Check if the mutable archive already has ready files or revert to draft
    const fileCount = await this.prisma.archivePublicFile.count({
      where: { archiveId: upload.archiveId },
    });

    await this.prisma.archive.update({
      where: { id: upload.archiveId },
      data: {
        technicalStatus: fileCount > 0 ? 'ready' : 'draft',
      },
    });

    return { status: 'cancelled' };
  }
}
