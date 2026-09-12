import { Controller, Get, Param } from '@nestjs/common';
import { MarketplaceService } from './marketplace.service';

@Controller('v1/viewer')
export class ViewerController {
  constructor(private readonly marketplaceService: MarketplaceService) {}

  @Get('archives/:archiveId')
  async getViewerArchiveMetadata(@Param('archiveId') archiveId: string) {
    return this.marketplaceService.getViewerArchiveMetadata(archiveId);
  }
}
