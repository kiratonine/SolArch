import { Module } from '@nestjs/common';
import { MarketplaceController } from './marketplace.controller';
import { ViewerController } from './viewer.controller';
import { MarketplaceService } from './marketplace.service';
import { ArchivesModule } from '@/modules/archives/archives.module';

@Module({
  imports: [ArchivesModule],
  controllers: [MarketplaceController, ViewerController],
  providers: [MarketplaceService],
  exports: [MarketplaceService],
})
export class MarketplaceModule {}
