import { IsNotEmpty, IsString, IsOptional } from 'class-validator';

export class CreatePaymentIntentDto {
  @IsNotEmpty()
  @IsString()
  archive_id: string;

  @IsNotEmpty()
  @IsString()
  device_public_key: string;
}

export class SolanaPayTransactionRequestDto {
  @IsNotEmpty()
  @IsString()
  account: string;
}

export class VerifyPaymentDto {
  @IsNotEmpty()
  @IsString()
  device_public_key: string;

  @IsOptional()
  @IsString()
  transaction_signature?: string;
}
