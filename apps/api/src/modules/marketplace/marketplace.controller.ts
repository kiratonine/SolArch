import {
  Controller,
  Get,
  Param,
  Query,
  Headers,
  Res,
  NotFoundException,
} from '@nestjs/common';
import { Response } from 'express';
import * as fs from 'fs';
import { MarketplaceService } from './marketplace.service';
import { PrismaService } from '@/common/prisma.service';

@Controller('v1/marketplace')
export class MarketplaceController {
  constructor(
    private readonly marketplaceService: MarketplaceService,
    private readonly prisma: PrismaService,
  ) {}

  @Get('archives')
  async listArchives(
    @Query('sort') sort?: string,
    @Query('sort_by') sortBy?: string,
    @Query('search') search?: string,
    @Query('query') queryParam?: string,
    @Query('category') category?: string,
    @Query('page') page?: number,
    @Query('limit') limit?: number,
    @Query('per_page') perPage?: number,
  ) {
    return this.marketplaceService.listArchives({
      sort: sort || sortBy,
      search: search || queryParam,
      category,
      page,
      limit: limit || perPage,
    });
  }

  @Get('archives/:slug')
  async getArchive(
    @Param('slug') slug: string,
    @Headers('x-session-id') sessionId?: string,
  ) {
    return this.marketplaceService.getArchiveBySlug(slug, sessionId);
  }

  @Get('archives/:slug/files')
  async getFiles(@Param('slug') slug: string) {
    return this.marketplaceService.getFilesBySlug(slug);
  }

  @Get('archives/:slug/download')
  async download(
    @Param('slug') slug: string,
    @Headers('x-session-id') sessionId: string,
    @Res() res: Response,
  ) {
    const listing = await this.prisma.archiveListing.findUnique({
      where: { slug },
      include: { archive: true },
    });

    if (
      !listing ||
      listing.marketplaceStatus !== 'published' ||
      !listing.archive.generatedSlrStorageKey ||
      !fs.existsSync(listing.archive.generatedSlrStorageKey)
    ) {
      throw new NotFoundException('Published .slr archive not available for download');
    }

    // Record server-side download event
    await this.marketplaceService.recordDownload(listing.archiveId, sessionId);

    res.setHeader('Content-Type', 'application/x-solarch');
    res.setHeader(
      'Content-Disposition',
      `attachment; filename="${listing.slug}.slr"`,
    );

    const stream = fs.createReadStream(listing.archive.generatedSlrStorageKey);
    stream.pipe(res);
  }
}
