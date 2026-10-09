import { ConfigService } from '@nestjs/config';
import { mkdtempSync, readFileSync, readdirSync, rmSync, symlinkSync, writeFileSync } from 'fs';
import { join, resolve } from 'path';
import { tmpdir } from 'os';
import { EnvService } from './env.service';
import { corsOptions } from './cors';
import { Controller, Get } from '@nestjs/common';
import { Test } from '@nestjs/testing';
const request = require('supertest');

@Controller('probe')
class CorsProbeController {
  @Get()
  probe() { return { ok: true }; }
}

function env(values: Record<string, string>): EnvService {
  return new EnvService({
    get: (name: string, fallback?: unknown) => values[name] ?? fallback,
  } as unknown as ConfigService);
}

describe('VPS storage configuration', () => {
  test.each(['', 'relative/storage', '/tmp/solarch', '/var/tmp/solarch', '/dev/shm/solarch', '/run/solarch'])
  ('rejects missing/relative/temporary live root %s at startup', (root) => {
    expect(() => env({ NODE_ENV: 'production', STORAGE_LOCAL_ROOT: root }).onModuleInit())
      .toThrow(/STORAGE_LOCAL_ROOT/);
  });

  test('checks a persistent directory without changing protected files', () => {
    const root = mkdtempSync(join(process.cwd(), '.storage-readiness-test-'));
    try {
      const protectedFile = join(root, 'retained.slr');
      writeFileSync(protectedFile, 'retained bytes');
      const service = env({ NODE_ENV: 'production', STORAGE_LOCAL_ROOT: join(root, 'new') });
      service.validateStorage();
      expect(readdirSync(service.storageRoot)).toEqual([]);
      expect(readFileSync(protectedFile, 'utf8')).toBe('retained bytes');
      expect(service.uploadsDirectory).toBe(join(root, 'new', 'uploads'));
      expect(() => env({ NODE_ENV: 'production', STORAGE_LOCAL_ROOT: protectedFile }).validateStorage())
        .toThrow(/writable persistent directory/);
      symlinkSync(tmpdir(), join(root, 'temporary-link'), 'dir');
      expect(() => env({ NODE_ENV: 'production', STORAGE_LOCAL_ROOT: join(root, 'temporary-link') }).validateStorage())
        .toThrow(/persistent directory/);
    } finally {
      rmSync(root, { recursive: true, force: true });
    }
  });

  test('preserves development relative-root/default behavior and parses TCP PORT', () => {
    expect(env({ NODE_ENV: 'test' }).storageRoot).toBe(resolve('./storage_data'));
    expect(env({ NODE_ENV: 'test', STORAGE_LOCAL_ROOT: './custom' }).storageRoot).toBe(resolve('./custom'));
    expect(env({ PORT: '3456' }).port).toBe(3456);
    for (const port of ['0', '65536', 'abc', '1.5', '']) {
      expect(() => env({ PORT: port }).port).toThrow(/PORT/);
    }
  });
});

describe('browser CORS allowlist', () => {
  test('real Nest preflight permits Authorization and denies unknown browser origins', async () => {
    const module = await Test.createTestingModule({ controllers: [CorsProbeController] }).compile();
    const app = module.createNestApplication();
    app.enableCors(corsOptions(env({ NODE_ENV: 'production', WEB_ALLOWED_ORIGINS: 'https://market.example' })));
    await app.init();
    try {
      const allowed = await request(app.getHttpServer()).options('/probe')
        .set('Origin', 'https://market.example').set('Access-Control-Request-Method', 'GET')
        .set('Access-Control-Request-Headers', 'authorization').expect(204);
      expect(allowed.headers['access-control-allow-origin']).toBe('https://market.example');
      expect(allowed.headers['access-control-allow-headers']).toBe('authorization');
      const denied = await request(app.getHttpServer()).get('/probe').set('Origin', 'https://unknown.example');
      expect(denied.headers['access-control-allow-origin']).toBeUndefined();
      await request(app.getHttpServer()).get('/probe').expect(200);
    } finally { await app.close(); }
  }, 30000);

  test('allows only listed HTTPS origins and requests without Origin', () => {
    const options = corsOptions(env({ NODE_ENV: 'production', WEB_ALLOWED_ORIGINS: 'https://solarch.vercel.app, https://market.example' }));
    const callback = jest.fn();
    const origin = options.origin as (value: string | undefined, callback: (...args: any[]) => void) => void;
    for (const value of ['https://solarch.vercel.app', 'https://market.example', undefined]) {
      origin(value, callback);
      expect(callback).toHaveBeenLastCalledWith(null, true);
    }
    for (const value of ['https://evil.example', 'null', 'http://localhost:5173', 'https://solarch.vercel.app.evil.example']) {
      origin(value, callback);
      expect(callback).toHaveBeenLastCalledWith(null, false);
    }
    expect(env({ NODE_ENV: 'test' }).webAllowedOrigins).toContain('http://localhost:5173');
    expect(env({ NODE_ENV: 'development', SOLANA_NETWORK: 'devnet' }).webAllowedOrigins).toContain('http://localhost:5173');
    expect(env({ NODE_ENV: 'production' }).webAllowedOrigins).toEqual([]);
  });

  test.each(['http://site.example', 'https://site.example/path', 'https://user@site.example', 'https://site.example?x=1', '*'])
  ('rejects malformed browser origin %s', (origin) => {
    expect(() => env({ NODE_ENV: 'production', WEB_ALLOWED_ORIGINS: origin }).onModuleInit())
      .toThrow(/WEB_ALLOWED_ORIGINS/);
  });
});
