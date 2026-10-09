import { Injectable, BadRequestException, UnauthorizedException } from '@nestjs/common';
import { JwtService } from '@nestjs/jwt';
import { PublicKey } from '@solana/web3.js';
import { randomUUID } from 'crypto';
import { PrismaService } from '@/common/prisma.service';
import { verifyWalletSignature } from '@/crypto/ed25519.util';
import { ChallengeRequestDto, ChallengeResponseDto, VerifyRequestDto, VerifyResponseDto } from './auth.dto';

interface StoredChallenge {
  wallet: string;
  message: string;
  expiresAt: number;
}

@Injectable()
export class AuthService {
  private readonly challenges = new Map<string, StoredChallenge>();
  private readonly revokedTokens = new Map<string, number>();

  constructor(
    private readonly prisma: PrismaService,
    private readonly jwtService: JwtService,
  ) {}

  revokeToken(token: string): void {
    try {
      const decoded: any = this.jwtService.decode(token);
      const expMs = decoded?.exp ? decoded.exp * 1000 : Date.now() + 7 * 24 * 60 * 60 * 1000;
      this.revokedTokens.set(token, expMs);
    } catch {
      this.revokedTokens.set(token, Date.now() + 7 * 24 * 60 * 60 * 1000);
    }
  }

  isTokenRevoked(token: string): boolean {
    const exp = this.revokedTokens.get(token);
    if (!exp) return false;
    if (Date.now() > exp) {
      this.revokedTokens.delete(token);
      return false;
    }
    return true;
  }

  async createChallenge(dto: ChallengeRequestDto): Promise<ChallengeResponseDto> {
    try {
      new PublicKey(dto.wallet);
    } catch {
      throw new BadRequestException('Invalid Solana wallet address');
    }

    const challengeId = `chl_${randomUUID().replace(/-/g, '').slice(0, 16)}`;
    const nonce = randomUUID();
    const timestamp = new Date().toISOString();
    const message = `Sign this message to authenticate with SolArch:\nWallet: ${dto.wallet}\nNonce: ${nonce}\nTimestamp: ${timestamp}`;

    // 10 minutes expiry
    this.challenges.set(challengeId, {
      wallet: dto.wallet,
      message,
      expiresAt: Date.now() + 10 * 60 * 1000,
    });

    return {
      challenge_id: challengeId,
      message,
    };
  }

  async verifyChallenge(dto: VerifyRequestDto): Promise<VerifyResponseDto> {
    const challenge = this.challenges.get(dto.challenge_id);
    if (!challenge) {
      throw new UnauthorizedException('Challenge not found or expired');
    }

    if (Date.now() > challenge.expiresAt) {
      this.challenges.delete(dto.challenge_id);
      throw new UnauthorizedException('Challenge expired');
    }

    if (challenge.wallet !== dto.wallet) {
      throw new UnauthorizedException('Wallet does not match challenge');
    }

    let pubKey: PublicKey;
    try {
      pubKey = new PublicKey(dto.wallet);
    } catch {
      throw new BadRequestException('Invalid Solana wallet address');
    }

    const isValid = verifyWalletSignature(challenge.message, dto.signature, pubKey.toBytes());
    if (!isValid) {
      throw new UnauthorizedException('Invalid signature');
    }

    // Single-use challenge
    this.challenges.delete(dto.challenge_id);

    // Upsert User and Wallet
    let walletRecord = await this.prisma.wallet.findUnique({
      where: { address: dto.wallet },
      include: { user: true },
    });

    if (!walletRecord) {
      const newUser = await this.prisma.user.create({
        data: {
          status: 'active',
          wallets: {
            create: {
              address: dto.wallet,
              chain: 'solana',
              verifiedAt: new Date(),
            },
          },
        },
        include: { wallets: true },
      });
      walletRecord = newUser.wallets[0] as any;
      walletRecord.user = newUser;
    } else {
      await this.prisma.wallet.update({
        where: { id: walletRecord.id },
        data: { verifiedAt: new Date() },
      });
    }

    const payload = {
      sub: walletRecord.userId,
      wallet: walletRecord.address,
    };

    const accessToken = await this.jwtService.signAsync(payload);

    return {
      authenticated: true,
      access_token: accessToken,
      user: {
        id: walletRecord.userId,
        wallet: walletRecord.address,
        status: walletRecord.user.status,
      },
    };
  }

  async validateUserById(userId: string) {
    return this.prisma.user.findUnique({
      where: { id: userId },
      include: { wallets: true },
    });
  }
}
