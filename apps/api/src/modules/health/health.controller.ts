import { Controller, Get } from '@nestjs/common';
import { Connection } from '@solana/web3.js';
import { PrismaService } from '@/common/prisma.service';
import { EnvService } from '@/config/env.service';

@Controller('v1/health')
export class HealthController {
  constructor(
    private readonly prisma: PrismaService,
    private readonly env: EnvService,
  ) {}

  @Get()
  getHealth() {
    return {
      status: 'ok',
      timestamp: new Date().toISOString(),
      service: 'solarch-api',
      version: '0.1.0',
    };
  }

  @Get('ready')
  async getReadiness() {
    let dbStatus = 'ok';
    try {
      await this.prisma.$queryRaw`SELECT 1`;
    } catch {
      dbStatus = 'degraded';
    }

    let solanaStatus = 'ok';
    try {
      const conn = new Connection(this.env.solanaRpcUrl, 'confirmed');
      await conn.getSlot();
    } catch {
      solanaStatus = 'degraded';
    }

    return {
      status: dbStatus === 'ok' ? 'ready' : 'degraded',
      dependencies: {
        database: dbStatus,
        solana_rpc: solanaStatus,
      },
      timestamp: new Date().toISOString(),
    };
  }
}
