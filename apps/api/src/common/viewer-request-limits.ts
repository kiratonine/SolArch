import { INestApplication } from '@nestjs/common';
import express, { NextFunction, Request, Response } from 'express';

const VIEWER_REQUEST_PATHS = ['/v1/payment-intents', '/v1/device-licenses'];
const VIEWER_JSON_CAP_BYTES = 4_096;
const VIEWER_JSON_MAX_DEPTH = 8;

class ViewerRequestBodyError extends Error {}

function assertJsonDepth(value: unknown): void {
  const pending: Array<{ value: unknown; depth: number }> = [{ value, depth: 1 }];
  while (pending.length > 0) {
    const current = pending.pop();
    if (!current || current.value === null || typeof current.value !== 'object') continue;
    if (current.depth > VIEWER_JSON_MAX_DEPTH) {
      throw new ViewerRequestBodyError(
        `Viewer API JSON depth exceeds ${VIEWER_JSON_MAX_DEPTH}`,
      );
    }
    const children = Array.isArray(current.value)
      ? current.value
      : Object.values(current.value as Record<string, unknown>);
    for (const child of children) {
      if (child !== null && typeof child === 'object') {
        pending.push({ value: child, depth: current.depth + 1 });
      }
    }
  }
}

function verifyViewerJsonBody(_request: Request, _response: Response, body: Buffer): void {
  try {
    const text = new TextDecoder('utf-8', { fatal: true }).decode(body);
    assertJsonDepth(JSON.parse(text));
  } catch (error) {
    if (error instanceof ViewerRequestBodyError) throw error;
    throw new ViewerRequestBodyError('Viewer API request body must be valid UTF-8 JSON');
  }
}

export function configureRequestBodyParsers(app: INestApplication): void {
  app.use(
    VIEWER_REQUEST_PATHS,
    express.json({
      inflate: false,
      limit: VIEWER_JSON_CAP_BYTES,
      strict: true,
      type: () => true,
      verify: verifyViewerJsonBody,
    }),
  );
  app.use(
    VIEWER_REQUEST_PATHS,
    (error: Error, _request: Request, response: Response, next: NextFunction) => {
      if (!error) {
        next();
        return;
      }
      response.status(400).json({
        code: 'INVALID_REQUEST',
        message: 'Viewer API JSON body must be at most 4096 UTF-8 bytes with depth at most 8',
      });
    },
  );

  // Nest's default parsers are disabled so the narrower Viewer boundary runs
  // before any body accumulation. Preserve ordinary API behavior afterwards.
  app.use(express.json({ limit: '100kb' }));
  app.use(express.urlencoded({ extended: true, limit: '100kb' }));
}
