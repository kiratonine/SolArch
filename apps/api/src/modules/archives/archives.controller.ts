import {
  Controller,
  Post,
  Get,
  Patch,
  Param,
  Body,
  UseGuards,
  Res,
  NotFoundException,
  UploadedFile,
  UseInterceptors,
  BadRequestException,
} from '@nestjs/common';
import { FileInterceptor } from '@nestjs/platform-express';
import { Response } from 'express';
import * as fs from 'fs';
import { memoryStorage } from 'multer';
import { ArchivesService } from './archives.service';
import { ArchiveCoversService, MAX_COVER_BYTES } from './archive-covers.service';
import { CreateArchiveDto, UpdateArchiveDto } from './archives.dto';
import { WalletAuthGuard } from '@/common/guards/wallet-auth.guard';
import { CurrentUser } from '@/common/decorators/current-user.decorator';

@Controller('v1/archives')
@UseGuards(WalletAuthGuard)
export class ArchivesController {
  constructor(
    private readonly archivesService: ArchivesService,
    private readonly archiveCovers: ArchiveCoversService,
  ) { }

  @Post()
  async create(@CurrentUser() user: any, @Body() dto: CreateArchiveDto) {
    return this.archivesService.create(user.id, dto);
  }

  @Get()
  async listMyArchives(@CurrentUser() user: any) {
    return this.archivesService.listForCreator(user.id);
  }

  @Get(':archiveId')
  async findOne(@Param('archiveId') archiveId: string, @CurrentUser() user: any) {
    return this.archivesService.findOne(archiveId, user.id);
  }

  @Get(':archiveId/files')
  async getArchiveFiles(@Param('archiveId') archiveId: string, @CurrentUser() user: any) {
    return this.archivesService.getFilesForCreator(archiveId, user.id);
  }

  @Patch(':archiveId')
  async update(
    @Param('archiveId') archiveId: string,
    @CurrentUser() user: any,
    @Body() dto: UpdateArchiveDto,
  ) {
    return this.archivesService.update(archiveId, user.id, dto);
  }

  @Post(':archiveId/cover')
  @UseInterceptors(
    FileInterceptor('file', {
      storage: memoryStorage(),
      limits: {
        files: 1,
        fields: 0,
        fileSize: MAX_COVER_BYTES,
      },
    }),
  )
  async replaceCover(
    @Param('archiveId') archiveId: string,
    @CurrentUser() user: any,
    @UploadedFile() file?: Express.Multer.File,
  ) {
    if (!file) {
      throw new BadRequestException({ code: 'INVALID_COVER', message: 'Cover file is required' });
    }
    return this.archiveCovers.replace(archiveId, user.id, file);
  }

  @Post(':archiveId/block')
  async block(@Param('archiveId') archiveId: string, @CurrentUser() user: any) {
    return this.archivesService.blockArchive(archiveId, user.id);
  }

  @Post(':archiveId/publish')
  async publish(@Param('archiveId') archiveId: string, @CurrentUser() user: any) {
    return this.archivesService.publish(archiveId, user.id);
  }

  @Post(':archiveId/unpublish')
  async unpublish(@Param('archiveId') archiveId: string, @CurrentUser() user: any) {
    return this.archivesService.unpublish(archiveId, user.id);
  }

  @Get(':archiveId/download')
  async download(
    @Param('archiveId') archiveId: string,
    @CurrentUser() user: any,
    @Res() res: Response,
  ) {
    const archive = await this.archivesService.findOne(archiveId, user.id);
    if (!archive.generatedSlrStorageKey || !fs.existsSync(archive.generatedSlrStorageKey)) {
      throw new NotFoundException('Generated .slr archive file not found');
    }

    res.setHeader('Content-Type', 'application/x-solarch');
    res.setHeader(
      'Content-Disposition',
      `attachment; filename="${archive.listing?.slug || archive.id}.slr"`,
    );

    const stream = fs.createReadStream(archive.generatedSlrStorageKey);
    stream.pipe(res);
  }
}
