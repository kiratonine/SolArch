import { Module } from '@nestjs/common';
import { AppConfigModule } from './config/config.module';
import { PrismaModule } from './common/prisma.module';
import { HealthModule } from './modules/health/health.module';
import { AuthModule } from './modules/auth/auth.module';
import { ArchivesModule } from './modules/archives/archives.module';
import { UploadsModule } from './modules/uploads/uploads.module';
import { MarketplaceModule } from './modules/marketplace/marketplace.module';
import { PaymentsModule } from './modules/payments/payments.module';
import { LicensingModule } from './modules/licensing/licensing.module';
import { AnalyticsModule } from './modules/analytics/analytics.module';

@Module({
  imports: [
    AppConfigModule,
    PrismaModule,
    HealthModule,
    AuthModule,
    ArchivesModule,
    UploadsModule,
    MarketplaceModule,
    PaymentsModule,
    LicensingModule,
    AnalyticsModule,
  ],
})
export class AppModule {}
