import { Controller, Get, Param, Query, UseGuards } from '@nestjs/common';
import { AnalyticsService } from './analytics.service';
import { WalletAuthGuard } from '@/common/guards/wallet-auth.guard';
import { CurrentUser } from '@/common/decorators/current-user.decorator';

@Controller('v1/archives')
@UseGuards(WalletAuthGuard)
export class AnalyticsController {
  constructor(private readonly analyticsService: AnalyticsService) {}

  @Get(':archiveId/analytics')
  async getAnalytics(
    @Param('archiveId') archiveId: string,
    @Query('period') period = 'all',
    @CurrentUser() user: any,
  ) {
    return this.analyticsService.getArchiveAnalytics(archiveId, user.id, period);
  }
}
