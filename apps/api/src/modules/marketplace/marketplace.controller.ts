import {
  Controller,
  Get,
  Param,
  Query,
  Headers,
  Res,
  NotFoundException,
  StreamableFile,
} from '@nestjs/common';
import { Response } from 'express';
import * as fs from 'fs';
import { MarketplaceService } from './marketplace.service';
import { PrismaService } from '@/common/prisma.service';
import { ArchiveCoversService } from '@/modules/archives/archive-covers.service';

@Controller('v1/marketplace')
export class MarketplaceController {
  constructor(
    private readonly marketplaceService: MarketplaceService,
    private readonly prisma: PrismaService,
    private readonly archiveCovers: ArchiveCoversService,
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

  @Get('covers/:coverKey')
  async cover(
    @Param('coverKey') coverKey: string,
    @Res({ passthrough: true }) res: Response,
  ) {
    const cover = await this.archiveCovers.readPublic(coverKey);
    res.setHeader('Cache-Control', 'public, max-age=31536000, immutable');
    res.setHeader('Content-Security-Policy', "default-src 'none'; sandbox");
    res.setHeader('Cross-Origin-Resource-Policy', 'cross-origin');
    res.setHeader('X-Content-Type-Options', 'nosniff');
    res.setHeader('Content-Length', String(cover.bytes.length));
    return new StreamableFile(cover.bytes, { type: cover.mimeType });
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
