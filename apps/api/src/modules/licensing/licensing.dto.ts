import { IsNotEmpty, IsString, Matches } from 'class-validator';

export class ActivateDeviceDto {
  @IsNotEmpty()
  @IsString()
  device_public_key: string;

  @IsNotEmpty()
  @IsString()
  device_name: string;

  @IsNotEmpty()
  @IsString()
  @Matches(/^[0-9]{1,3}\.[0-9]{1,3}\.[0-9]{1,3}$/)
  viewer_version: string;

  @IsNotEmpty()
  @IsString()
  request_nonce: string;
}

export class RefreshLicenseDto {
  @IsNotEmpty()
  @IsString()
  archive_id: string;

  @IsNotEmpty()
  @IsString()
  device_public_key: string;

  @IsNotEmpty()
  @IsString()
  request_nonce: string;
}
