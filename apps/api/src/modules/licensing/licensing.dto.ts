import { IsNotEmpty, IsString, IsOptional } from 'class-validator';

export class ActivateDeviceDto {
  @IsNotEmpty()
  @IsString()
  device_public_key: string;

  @IsOptional()
  @IsString()
  device_name?: string = 'Windows PC';

  @IsOptional()
  @IsString()
  viewer_version?: string = '0.1.0';

  @IsNotEmpty()
  @IsString()
  request_nonce: string;
}

export class RefreshLicenseDto {
  @IsNotEmpty()
  @IsString()
  device_public_key: string;

  @IsNotEmpty()
  @IsString()
  request_nonce: string;
}

export class CheckLicenseDto {
  @IsNotEmpty()
  @IsString()
  license_id: string;

  @IsNotEmpty()
  @IsString()
  archive_id: string;

  @IsNotEmpty()
  @IsString()
  device_public_key: string;
}
