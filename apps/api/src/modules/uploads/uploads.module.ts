import { Module } from '@nestjs/common';
import { UploadsController } from './uploads.controller';
import { UploadsService } from './uploads.service';
import { ArchiveBuilderAdapter } from './archive-builder.adapter';
import { AckCustodyService } from './ack-custody.service';
import { AuthModule } from '@/modules/auth/auth.module';

@Module({
  imports: [AuthModule],
  controllers: [UploadsController],
  providers: [UploadsService, ArchiveBuilderAdapter, AckCustodyService],
  exports: [UploadsService, ArchiveBuilderAdapter, AckCustodyService],
})
export class UploadsModule {}
