import {
  Controller,
  Post,
  Param,
  Body,
  UseGuards,
  UseInterceptors,
  UploadedFile,
  BadRequestException,
} from '@nestjs/common';
import { FileInterceptor } from '@nestjs/platform-express';
import { diskStorage } from 'multer';
import * as path from 'path';
import * as fs from 'fs';
import { UploadsService } from './uploads.service';
import { InitUploadDto } from './uploads.dto';
import { WalletAuthGuard } from '@/common/guards/wallet-auth.guard';
import { CurrentUser } from '@/common/decorators/current-user.decorator';
import { EnvService } from '@/config/env.service';

@Controller('v1/uploads')
@UseGuards(WalletAuthGuard)
export class UploadsController {
  constructor(
    private readonly uploadsService: UploadsService,
    private readonly env: EnvService,
  ) {}

  @Post('init')
  async init(@CurrentUser() user: any, @Body() dto: InitUploadDto) {
    return this.uploadsService.init(user.id, dto);
  }

  @Post(':uploadId/file')
  @UseInterceptors(
    FileInterceptor('file', {
      storage: diskStorage({
        destination: (req, file, cb) => {
          const uploadDir = path.join('./storage_data', 'uploads');
          if (!fs.existsSync(uploadDir)) {
            fs.mkdirSync(uploadDir, { recursive: true });
          }
          cb(null, uploadDir);
        },
        filename: (req, file, cb) => {
          const uniqueSuffix = `${Date.now()}-${Math.round(Math.random() * 1e6)}`;
          cb(null, `${req.params.uploadId}-${uniqueSuffix}${path.extname(file.originalname)}`);
        },
      }),
      limits: { fileSize: 512 * 1024 * 1024 }, // 512 MiB
    }),
  )
  async uploadFile(
    @Param('uploadId') uploadId: string,
    @UploadedFile() file: Express.Multer.File,
  ) {
    if (!file) {
      throw new BadRequestException('No file uploaded');
    }
    return this.uploadsService.setUploadedFile(uploadId, file.path);
  }

  @Post(':uploadId/complete')
  async complete(@Param('uploadId') uploadId: string, @CurrentUser() user: any) {
    return this.uploadsService.complete(user.id, uploadId);
  }

  @Post(':uploadId/cancel')
  async cancel(@Param('uploadId') uploadId: string, @CurrentUser() user: any) {
    return this.uploadsService.cancel(user.id, uploadId);
  }
}
