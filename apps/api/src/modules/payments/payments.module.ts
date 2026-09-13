import { Module } from '@nestjs/common';
import { PaymentsController, SolanaPayAssetsController } from './payments.controller';
import { PaymentsService } from './payments.service';

@Module({
  controllers: [SolanaPayAssetsController, PaymentsController],
  providers: [PaymentsService],
  exports: [PaymentsService],
})
export class PaymentsModule {}
