import { Test, TestingModule } from '@nestjs/testing';
import { JwtService } from '@nestjs/jwt';
import { AuthService } from './auth.service';
import { PrismaService } from '@/common/prisma.service';

describe('AuthService Token Revocation (B10)', () => {
  let service: AuthService;
  let jwtService: JwtService;

  beforeEach(async () => {
    const module: TestingModule = await Test.createTestingModule({
      providers: [
        AuthService,
        {
          provide: PrismaService,
          useValue: {
            wallet: { findUnique: jest.fn(), update: jest.fn() },
            user: { create: jest.fn(), findUnique: jest.fn() },
          },
        },
        {
          provide: JwtService,
          useValue: {
            signAsync: jest.fn().mockResolvedValue('valid.jwt.token'),
            verifyAsync: jest.fn().mockResolvedValue({ sub: 'user_123', wallet: 'wal_123' }),
            decode: jest.fn().mockReturnValue({ sub: 'user_123', exp: Math.floor(Date.now() / 1000) + 3600 }),
          },
        },
      ],
    }).compile();

    service = module.get<AuthService>(AuthService);
    jwtService = module.get<JwtService>(JwtService);
  });

  test('token is not revoked by default', () => {
    expect(service.isTokenRevoked('test.token')).toBe(false);
  });

  test('revoking token marks it as revoked', () => {
    const token = 'user.session.token';
    service.revokeToken(token);
    expect(service.isTokenRevoked(token)).toBe(true);
  });

  test('expired revoked token is cleaned up and treated as not revoked', () => {
    const token = 'expired.token';
    (jwtService.decode as jest.Mock).mockReturnValue({
      sub: 'user_123',
      exp: Math.floor((Date.now() - 1000) / 1000), // expired 1s ago
    });

    service.revokeToken(token);
    expect(service.isTokenRevoked(token)).toBe(false);
  });
});
