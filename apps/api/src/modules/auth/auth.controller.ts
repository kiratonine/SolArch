import {
  Controller,
  Post,
  Get,
  Body,
  Req,
  UseGuards,
  HttpCode,
  HttpStatus,
} from '@nestjs/common';
import { Request } from 'express';
import { AuthService } from './auth.service';
import { ChallengeRequestDto, VerifyRequestDto } from './auth.dto';
import { WalletAuthGuard } from '@/common/guards/wallet-auth.guard';
import { CurrentUser } from '@/common/decorators/current-user.decorator';

@Controller('v1')
export class AuthController {
  constructor(private readonly authService: AuthService) {}

  @Post('auth/wallet/challenge')
  @HttpCode(HttpStatus.OK)
  async challenge(@Body() dto: ChallengeRequestDto) {
    return this.authService.createChallenge(dto);
  }

  @Post('auth/wallet/verify')
  @HttpCode(HttpStatus.OK)
  async verify(@Body() dto: VerifyRequestDto) {
    return this.authService.verifyChallenge(dto);
  }

  @Get(['me', 'auth/me'])
  @UseGuards(WalletAuthGuard)
  async getMe(@CurrentUser() user: any) {
    return {
      id: user.id,
      wallet: user.wallets?.[0]?.address || user.wallet,
      status: user.status,
    };
  }

  @Post('auth/logout')
  @HttpCode(HttpStatus.OK)
  @UseGuards(WalletAuthGuard)
  async logout(@Req() req: Request) {
    const authHeader = req.headers['authorization'];
    if (authHeader && authHeader.startsWith('Bearer ')) {
      const token = authHeader.substring(7).trim();
      this.authService.revokeToken(token);
    }
    return { success: true };
  }
}
