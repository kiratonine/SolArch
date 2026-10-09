import { Module } from '@nestjs/common';
import { JwtModule } from '@nestjs/jwt';
import { AuthController } from './auth.controller';
import { AuthService } from './auth.service';
import { WalletAuthGuard } from '@/common/guards/wallet-auth.guard';
import { EnvService } from '@/config/env.service';

@Module({
  imports: [
    JwtModule.registerAsync({
      inject: [EnvService],
      useFactory: (env: EnvService) => ({
        secret: env.jwtSecret,
        signOptions: { expiresIn: env.jwtExpiresIn },
      }),
    }),
  ],
  controllers: [AuthController],
  providers: [AuthService, WalletAuthGuard],
  exports: [AuthService, WalletAuthGuard, JwtModule],
})
export class AuthModule {}
