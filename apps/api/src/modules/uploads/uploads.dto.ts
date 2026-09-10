import { IsNotEmpty, IsString, IsNumber } from 'class-validator';

export class InitUploadDto {
  @IsNotEmpty()
  @IsString()
  archive_id: string;

  @IsNotEmpty()
  @IsString()
  filename: string;

  @IsNotEmpty()
  @IsNumber()
  size_bytes: number;
}
