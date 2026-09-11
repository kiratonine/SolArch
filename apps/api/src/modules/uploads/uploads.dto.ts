import { IsNotEmpty, IsString, IsNumber, IsOptional } from 'class-validator';

export class InitUploadDto {
  @IsNotEmpty()
  @IsString()
  archive_id: string;

  @IsOptional()
  @IsString()
  filename?: string;

  @IsOptional()
  @IsString()
  file_name?: string;

  @IsOptional()
  @IsNumber()
  size_bytes?: number;

  @IsOptional()
  @IsNumber()
  file_size?: number;
}
