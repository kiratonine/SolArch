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

    // Map common HTTP status to SolArch codes if code is generic
    if (code === 'INTERNAL_ERROR' || code === 'Bad Request' || code === 'Not Found' || code === 'Unauthorized') {
      switch (status) {
        case HttpStatus.BAD_REQUEST:
          code = 'BAD_REQUEST';
          break;
        case HttpStatus.UNAUTHORIZED:
          code = 'UNAUTHORIZED';
          break;
        case HttpStatus.FORBIDDEN:
          code = 'FORBIDDEN';
          break;
        case HttpStatus.NOT_FOUND:
          code = 'NOT_FOUND';
          break;
        case HttpStatus.CONFLICT:
          code = 'CONFLICT';
          break;
        case HttpStatus.UNPROCESSABLE_ENTITY:
          code = 'UNPROCESSABLE_ENTITY';
          break;
        default:
          code = 'SERVER_ERROR';
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
