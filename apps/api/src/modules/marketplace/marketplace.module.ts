import { Module } from '@nestjs/common';
import { MarketplaceController } from './marketplace.controller';
import { ViewerController } from './viewer.controller';
import { MarketplaceService } from './marketplace.service';

@Module({
  controllers: [MarketplaceController, ViewerController],
  providers: [MarketplaceService],
  exports: [MarketplaceService],
})
export class MarketplaceModule {}
