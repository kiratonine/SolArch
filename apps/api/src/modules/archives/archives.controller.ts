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
} from '@nestjs/common';
import { Response } from 'express';
import * as fs from 'fs';
import { ArchivesService } from './archives.service';
import { CreateArchiveDto, UpdateArchiveDto } from './archives.dto';
import { WalletAuthGuard } from '@/common/guards/wallet-auth.guard';
import { CurrentUser } from '@/common/decorators/current-user.decorator';

@Controller('v1/archives')
@UseGuards(WalletAuthGuard)
export class ArchivesController {
  constructor(private readonly archivesService: ArchivesService) {}

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
