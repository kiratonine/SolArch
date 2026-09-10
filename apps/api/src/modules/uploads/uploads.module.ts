import { Module } from '@nestjs/common';
import { UploadsController } from './uploads.controller';
import { UploadsService } from './uploads.service';
import { ArchiveBuilderAdapter } from './archive-builder.adapter';
import { AuthModule } from '@/modules/auth/auth.module';

@Module({
  imports: [AuthModule],
  controllers: [UploadsController],
  providers: [UploadsService, ArchiveBuilderAdapter],
  exports: [UploadsService, ArchiveBuilderAdapter],
})
export class UploadsModule {}
