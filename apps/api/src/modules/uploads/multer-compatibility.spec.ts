import { MulterError } from 'multer';

const express = require('express');
const multer = require('multer');
const request = require('supertest');

describe('Multer 2 upload compatibility', () => {
  const upload = multer({
    storage: multer.memoryStorage(),
    limits: { fileSize: 16 },
  }).single('file');
  const app = express();

  app.post('/upload', (req: any, res: any) => {
    upload(req, res, (error: unknown) => {
      if (error instanceof MulterError) {
        res.status(413).json({ code: error.code });
        return;
      }
      if (error) {
        res.status(400).json({ code: 'UPLOAD_FAILED' });
        return;
      }
      res.status(200).json({ name: req.file?.originalname, size: req.file?.size });
    });
  });

  it('parses the bounded multipart file used by the authenticated upload path', async () => {
    const response = await request(app)
      .post('/upload')
      .attach('file', Buffer.from('safe archive'), 'source.zip')
      .expect(200);

    expect(response.body).toEqual({ name: 'source.zip', size: 12 });
  });

  it('retains the configured file-size boundary', async () => {
    const response = await request(app)
      .post('/upload')
      .attach('file', Buffer.alloc(17), 'oversize.zip')
      .expect(413);

    expect(response.body.code).toBe('LIMIT_FILE_SIZE');
  });
});
