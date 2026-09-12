import {
  IsNotEmpty,
  IsString,
  IsOptional,
  ValidateNested,
  IsNumber,
  IsBoolean,
} from 'class-validator';
import { Type } from 'class-transformer';

export class PriceDto {
  @IsNotEmpty()
  @IsString()
  currency: string;

  @IsNotEmpty()
  @IsString()
  amount: string;
}

export class LicensePolicyDto {
  @IsOptional()
  @IsNumber()
  max_devices?: number = 1;

  @IsOptional()
  @IsBoolean()
  allow_export?: boolean = false;

  @IsOptional()
  @IsBoolean()
  watermark_enabled?: boolean = true;
}

export class CreateArchiveDto {
  @IsNotEmpty()
  @IsString()
  title: string;

  @IsOptional()
  @IsString()
  short_description?: string;

  @IsOptional()
  @IsString()
  description?: string;

  @IsNotEmpty()
  @ValidateNested()
  @Type(() => PriceDto)
  price: PriceDto;

  @IsNotEmpty()
  @IsString()
  creator_payout_wallet: string;

  @IsOptional()
  @ValidateNested()
  @Type(() => LicensePolicyDto)
  license_policy?: LicensePolicyDto;
}

export class UpdateArchiveDto {
  @IsOptional()
  @IsString()
  title?: string;

  @IsOptional()
  @IsString()
  short_description?: string;

  @IsOptional()
  @IsString()
  description?: string;

  @IsOptional()
  @IsString()
  cover_storage_key?: string;

  @IsOptional()
  @IsString()
  cover_url?: string;

  @IsOptional()
  @IsString()
  category?: string;

  @IsOptional()
  tags?: string[];
}
