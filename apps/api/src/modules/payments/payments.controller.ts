import {
  Controller,
  Post,
  Get,
  Param,
  Body,
  Headers,
  Header,
  HttpCode,
  HttpStatus,
} from '@nestjs/common';
import { PaymentsService } from './payments.service';
import {
  CreatePaymentIntentDto,
  VerifyPaymentDto,
} from './payments.dto';

const SOLARCH_PAY_ICON = `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 64 64" role="img" aria-label="SolArch"><rect width="64" height="64" rx="12" fill="#101318"/><path d="M17 20h30v8H25v8h22v8H17z" fill="#7185F5"/><path d="M25 28h22v8H25z" fill="#F2F4F7"/></svg>`;

@Controller()
export class SolanaPayAssetsController {
  @Get('assets/solarch-pay-icon.svg')
  @Header('Content-Type', 'image/svg+xml; charset=utf-8')
  @Header('Cache-Control', 'public, max-age=86400, immutable')
  getSolanaPayIcon() {
    return SOLARCH_PAY_ICON;
  }
}

@Controller('v1')
export class PaymentsController {
  constructor(private readonly paymentsService: PaymentsService) {}

  @Post('payment-intents')
  async createPaymentIntent(@Body() dto: CreatePaymentIntentDto) {
    return this.paymentsService.createPaymentIntent(dto);
  }

  @Get('solana-pay/payment-intents/:id/transaction')
  @Header('Cache-Control', 'no-store')
  async getSolanaPayMetadata(@Param('id') intentId: string) {
    return this.paymentsService.getSolanaPayMetadata(intentId);
  }

  @Post('solana-pay/payment-intents/:id/transaction')
  @HttpCode(HttpStatus.OK)
  @Header('Cache-Control', 'no-store')
  async buildTransaction(
    @Param('id') intentId: string,
    @Body() body: Record<string, unknown>,
  ) {
    const account = body && typeof body === 'object' ? body.account : undefined;
    return this.paymentsService.buildTransaction(intentId, {
      account: typeof account === 'string' ? account : '',
    });
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
