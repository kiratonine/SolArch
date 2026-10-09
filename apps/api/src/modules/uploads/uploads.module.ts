import { Module } from '@nestjs/common';
import { UploadsController } from './uploads.controller';
import { UploadsService } from './uploads.service';
import { ArchiveBuilderAdapter } from './archive-builder.adapter';
import { AckCustodyService } from './ack-custody.service';
import { AuthModule } from '@/modules/auth/auth.module';
import { MulterModule } from '@nestjs/platform-express';
import { diskStorage } from 'multer';
import { mkdir } from 'fs';
import * as path from 'path';
import { EnvService } from '@/config/env.service';

export function uploadStorageOptions(env: EnvService) {
  return {
    storage: diskStorage({
      destination: (_req, _file, cb) => {
        const directory = env.uploadsDirectory;
        mkdir(directory, { recursive: true }, (error) => cb(error, directory));
      },
      filename: (req, file, cb) => {
        const uniqueSuffix = `${Date.now()}-${Math.round(Math.random() * 1e6)}`;
        cb(null, `${req.params.uploadId}-${uniqueSuffix}${path.extname(file.originalname)}`);
      },
    }),
    limits: { fileSize: 512 * 1024 * 1024 },
  };
}

@Module({
  imports: [AuthModule, MulterModule.registerAsync({
    inject: [EnvService],
    useFactory: uploadStorageOptions,
  })],
  controllers: [UploadsController],
  providers: [UploadsService, ArchiveBuilderAdapter, AckCustodyService],
  exports: [UploadsService, ArchiveBuilderAdapter, AckCustodyService],
})
export class UploadsModule {}
