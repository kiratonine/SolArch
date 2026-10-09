import {
  Controller,
  Post,
  Param,
  Body,
  Req,
  UseGuards,
  UseInterceptors,
  UploadedFile,
  BadRequestException,
} from '@nestjs/common';
import { Request } from 'express';
import { FileInterceptor } from '@nestjs/platform-express';
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

  @Post(':uploadId/data')
  async uploadData(
    @Param('uploadId') uploadId: string,
    @CurrentUser() user: any,
    @Req() req: Request,
  ) {
    await this.uploadsService.assertUploadOwner(user.id, uploadId);

    const uploadDir = this.env.uploadsDirectory;
    if (!fs.existsSync(uploadDir)) {
      fs.mkdirSync(uploadDir, { recursive: true });
    }
    const targetPath = path.join(uploadDir, `${uploadId}-${Date.now()}.zip`);
    const writeStream = fs.createWriteStream(targetPath);

    await new Promise<void>((resolve, reject) => {
      req.pipe(writeStream);
      writeStream.on('finish', () => resolve());
      writeStream.on('error', reject);
      req.on('error', reject);
    });

    return this.uploadsService.setUploadedFile(user.id, uploadId, targetPath);
  }

  @Post(':uploadId/file')
  @UseInterceptors(
    FileInterceptor('file'),
  )
  async uploadFile(
    @Param('uploadId') uploadId: string,
    @CurrentUser() user: any,
    @UploadedFile() file: Express.Multer.File,
  ) {
    if (!file) {
      throw new BadRequestException('No file uploaded');
    }
    return this.uploadsService.setUploadedFile(user.id, uploadId, file.path);
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
