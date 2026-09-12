import {
  ExceptionFilter,
  Catch,
  ArgumentsHost,
  HttpException,
  HttpStatus,
  Logger,
} from '@nestjs/common';
import { Request, Response } from 'express';
import { randomUUID } from 'crypto';

@Catch()
export class SolArchExceptionFilter implements ExceptionFilter {
  private readonly logger = new Logger(SolArchExceptionFilter.name);

  catch(exception: unknown, host: ArgumentsHost) {
    const ctx = host.switchToHttp();
    const response = ctx.getResponse<Response>();
    const request = ctx.getRequest<Request>();

    const requestId = (request.headers['x-request-id'] as string) || `req_${randomUUID().replace(/-/g, '').slice(0, 16)}`;

    let status = HttpStatus.INTERNAL_SERVER_ERROR;
    let code = 'INTERNAL_ERROR';
    let message = 'Internal server error';

    if (exception instanceof HttpException) {
      status = exception.getStatus();
      const res = exception.getResponse();
      if (typeof res === 'string') {
        message = res;
      } else if (typeof res === 'object' && res !== null) {
        const anyRes = res as Record<string, any>;
        message = Array.isArray(anyRes.message)
          ? anyRes.message.join(', ')
          : anyRes.message || message;
        code = anyRes.error || anyRes.code || code;
      }
    } else if (exception instanceof Error) {
      message = exception.message;
    }

    // Map common HTTP status to SolArch codes if code is generic or default
    const isViewerRoute = request.url.includes('/viewer') || request.url.includes('/payment-intents') || request.url.includes('/device-licenses');

    if (
      code === 'INTERNAL_ERROR' ||
      code === 'Bad Request' ||
      code === 'BAD_REQUEST' ||
      code === 'Not Found' ||
      code === 'NOT_FOUND' ||
      code === 'Unauthorized' ||
      code === 'UNAUTHORIZED' ||
      code === 'Conflict' ||
      code === 'CONFLICT' ||
      code === 'Forbidden' ||
      code === 'FORBIDDEN' ||
      code === 'SERVER_ERROR'
    ) {
      switch (status) {
        case HttpStatus.BAD_REQUEST:
          code = 'INVALID_REQUEST';
          break;
        case HttpStatus.UNAUTHORIZED:
          code = request.url.includes('refresh')
            ? 'INVALID_REFRESH_CREDENTIAL'
            : isViewerRoute
              ? 'INVALID_INTENT_CREDENTIAL'
              : 'UNAUTHORIZED';
          break;
        case HttpStatus.FORBIDDEN:
          code = 'PAYMENT_NOT_CONFIRMED';
          break;
        case HttpStatus.NOT_FOUND:
          if (request.url.includes('/device-licenses')) {
            code = 'LICENSE_NOT_FOUND';
          } else if (request.url.includes('/viewer/archives') || request.url.includes('/marketplace/archives')) {
            code = 'ARCHIVE_NOT_AVAILABLE';
          } else {
            code = isViewerRoute ? 'ARCHIVE_NOT_AVAILABLE' : 'NOT_FOUND';
          }
          break;
        case HttpStatus.CONFLICT:
          code = 'DEVICE_BINDING_MISMATCH';
          break;
        case HttpStatus.GONE:
          code = 'PAYMENT_INTENT_EXPIRED';
          break;
        case HttpStatus.TOO_MANY_REQUESTS:
          code = 'RATE_LIMITED';
          break;
        case HttpStatus.SERVICE_UNAVAILABLE:
          code = 'BACKEND_UNAVAILABLE';
          break;
        default:
          code = status >= 500 ? (isViewerRoute ? 'BACKEND_UNAVAILABLE' : 'SERVER_ERROR') : code;
      }
    }

    if (status >= 500) {
      this.logger.error(`[${requestId}] ${request.method} ${request.url} - ${message}`, exception instanceof Error ? exception.stack : '');
    }

    response.status(status).json({
      code,
      message,
      request_id: requestId,
    });
  }
}
