import { Module } from '@nestjs/common';
import { ArchivesController } from './archives.controller';
import { ArchivesService } from './archives.service';
import { AuthModule } from '@/modules/auth/auth.module';

@Module({
  imports: [AuthModule],
  controllers: [ArchivesController],
  providers: [ArchivesService],
  exports: [ArchivesService],
})
export class ArchivesModule {}
