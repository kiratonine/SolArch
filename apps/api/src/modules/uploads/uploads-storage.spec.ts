import { ConfigService } from '@nestjs/config';
import { mkdtempSync, readFileSync, rmSync } from 'fs';
import { tmpdir } from 'os';
import { isAbsolute, join } from 'path';
import { Readable } from 'stream';
import { EnvService } from '@/config/env.service';
import { UploadsController } from './uploads.controller';
import { UploadsService } from './uploads.service';
import { uploadStorageOptions } from './uploads.module';
const express = require('express');
const multer = require('multer');
const request = require('supertest');

describe('configured persistent upload root', () => {
  let root: string;
  let env: EnvService;
  beforeEach(() => {
    root = mkdtempSync(join(tmpdir(), 'solarch-upload-storage-'));
    const values = { NODE_ENV: 'test', STORAGE_LOCAL_ROOT: join(root, 'persistent') };
    env = new EnvService({ get: (name: string, fallback?: unknown) => values[name] ?? fallback } as unknown as ConfigService);
  });
  afterEach(() => rmSync(root, { recursive: true, force: true }));

  test('raw ZIP upload creates uploads and persists an absolute file path', async () => {
    const service = { assertUploadOwner: jest.fn(), setUploadedFile: jest.fn((_user, _id, _file: string) => ({ upload_id: 'upl_test', status: 'uploaded' })) };
    const controller = new UploadsController(service as unknown as UploadsService, env);
    await controller.uploadData('upl_test', { id: 'creator' }, Readable.from([Buffer.from('zip bytes')]) as any);
    const file = service.setUploadedFile.mock.calls[0][2];
    expect(service.assertUploadOwner).toHaveBeenCalledWith('creator', 'upl_test');
    expect(isAbsolute(file)).toBe(true);
    expect(file.startsWith(`${env.uploadsDirectory}/`)).toBe(true);
    expect(readFileSync(file, 'utf8')).toBe('zip bytes');
  });

  test('multipart diskStorage uses the same root and absolute path', async () => {
    const app = express();
    app.post('/:uploadId/file', multer(uploadStorageOptions(env)).single('file'), (req, res) => res.json({ path: req.file.path }));
    const response = await request(app).post('/upl_test/file').attach('file', Buffer.from('zip bytes'), 'source.zip').expect(200);
    expect(isAbsolute(response.body.path)).toBe(true);
    expect(response.body.path.startsWith(`${env.uploadsDirectory}/`)).toBe(true);
    expect(readFileSync(response.body.path, 'utf8')).toBe('zip bytes');
  });
});
