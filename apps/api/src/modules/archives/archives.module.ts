import { Module } from '@nestjs/common';
import { ArchivesController } from './archives.controller';
import { ArchivesService } from './archives.service';
import { ArchiveCoversService } from './archive-covers.service';
import { AuthModule } from '@/modules/auth/auth.module';

@Module({
  imports: [AuthModule],
  controllers: [ArchivesController],
  providers: [ArchivesService, ArchiveCoversService],
  exports: [ArchivesService, ArchiveCoversService],
})
export class ArchivesModule {}
