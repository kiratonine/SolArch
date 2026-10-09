import { IsNotEmpty, IsString } from 'class-validator';

export class ChallengeRequestDto {
  @IsNotEmpty()
  @IsString()
  wallet: string;
}

export class ChallengeResponseDto {
  challenge_id: string;
  message: string;
}

export class VerifyRequestDto {
  @IsNotEmpty()
  @IsString()
  challenge_id: string;

  @IsNotEmpty()
  @IsString()
  wallet: string;

  @IsNotEmpty()
  @IsString()
  signature: string;
}

export class AuthUserDto {
  id: string;
  wallet: string;
  status: string;
}

export class VerifyResponseDto {
  authenticated: boolean;
  access_token: string;
  user: AuthUserDto;
}
