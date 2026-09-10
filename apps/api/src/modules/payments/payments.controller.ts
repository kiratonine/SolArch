import {
  Controller,
  Post,
  Get,
  Param,
  Body,
  Headers,
  Req,
  HttpCode,
  HttpStatus,
} from '@nestjs/common';
import { Request } from 'express';
import { PaymentsService } from './payments.service';
import {
  CreatePaymentIntentDto,
  SolanaPayTransactionRequestDto,
  VerifyPaymentDto,
} from './payments.dto';

@Controller('v1')
export class PaymentsController {
  constructor(private readonly paymentsService: PaymentsService) {}

  @Post('payment-intents')
  async createPaymentIntent(
    @Body() dto: CreatePaymentIntentDto,
    @Req() req: Request,
  ) {
    const protocol = req.protocol;
    const host = req.get('host');
    const hostUrl = `${protocol}://${host}`;
    return this.paymentsService.createPaymentIntent(dto, hostUrl);
  }

  @Get('solana-pay/payment-intents/:id/transaction')
  async getSolanaPayMetadata(@Param('id') intentId: string) {
    return this.paymentsService.getSolanaPayMetadata(intentId);
  }

  @Post('solana-pay/payment-intents/:id/transaction')
  @HttpCode(HttpStatus.OK)
  async buildTransaction(
    @Param('id') intentId: string,
    @Body() dto: SolanaPayTransactionRequestDto,
  ) {
    return this.paymentsService.buildTransaction(intentId, dto);
  }

  @Post('payment-intents/:id/verify')
  @HttpCode(HttpStatus.OK)
  async verifyPayment(
    @Param('id') intentId: string,
    @Headers('authorization') authHeader: string,
    @Body() dto: VerifyPaymentDto,
  ) {
    return this.paymentsService.verifyPayment(intentId, authHeader, dto);
  }
}
