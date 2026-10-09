import {
  Controller,
  Post,
  Param,
  Body,
  Headers,
  HttpCode,
  HttpStatus,
} from '@nestjs/common';
import { LicensingService } from './licensing.service';
import { ActivateDeviceDto, RefreshLicenseDto } from './licensing.dto';

@Controller('v1')
export class LicensingController {
  constructor(private readonly licensingService: LicensingService) {}

  @Post('payment-intents/:id/activate-device')
  @HttpCode(HttpStatus.OK)
  async activateDeviceViaIntent(
    @Param('id') intentId: string,
    @Headers('authorization') authHeader: string,
    @Body() dto: ActivateDeviceDto,
  ) {
    return this.licensingService.activateDevice(intentId, authHeader, dto);
  }

  @Post('device-licenses/:id/refresh')
  @HttpCode(HttpStatus.OK)
  async refreshLicense(
    @Param('id') licenseId: string,
    @Headers('authorization') authHeader: string,
    @Body() dto: RefreshLicenseDto,
  ) {
    return this.licensingService.refreshLicense(licenseId, authHeader, dto);
  }
}
