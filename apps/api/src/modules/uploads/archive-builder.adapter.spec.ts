import { EventEmitter } from 'events';
import { PassThrough } from 'stream';
import { spawn } from 'child_process';
import fs from 'fs';
import { ArchiveBuilderAdapter } from './archive-builder.adapter';

jest.mock('child_process', () => ({ spawn: jest.fn() }));

class FakeChild extends EventEmitter {
  readonly stdout = new PassThrough();
  readonly stderr = new PassThrough();
  readonly stdin = new PassThrough();
  killed = false;
  readonly kill = jest.fn(() => {
    this.killed = true;
    this.emit('close', null, 'SIGKILL');
    return true;
  });
}

describe('ArchiveBuilderAdapter subprocess boundaries', () => {
  let adapter: ArchiveBuilderAdapter;
  const spawnMock = spawn as unknown as jest.Mock;

  beforeEach(() => {
    jest.clearAllMocks();
    adapter = new ArchiveBuilderAdapter({ solarchCliPath: '/opt/solarch' } as any);
  });

  function run(child: FakeChild): Promise<void> {
    spawnMock.mockReturnValue(child);
    return (adapter as any).executeFinalVerify(
      '/opt/solarch',
      '/private/archive.slr',
      'archive-key-01',
      Buffer.alloc(32, 3).toString('base64'),
    );
  }

  function runPending(child: FakeChild): Promise<unknown> {
    spawnMock.mockReturnValue(child);
    return (adapter as any).executePendingBuildVerify(
      '/opt/solarch',
      '/private/archive.slr.pending',
      '/private/source',
      '/private/metadata.json',
      'archive-key-01',
      Buffer.alloc(32, 2),
    );
  }

  function runDuplex(child: FakeChild): Promise<unknown> {
    spawnMock.mockReturnValue(child);
    return (adapter as any).executeDuplexCreate(
      '/opt/solarch',
      '/private/source',
      '/private/metadata.json',
      '/private/archive.slr',
      'archive-key-01',
      Buffer.alloc(32, 3).toString('base64'),
      Buffer.alloc(32, 2),
      Buffer.alloc(64, 4),
    );
  }

  test('accepts only bounded successful JSON with a sanitized environment', async () => {
    const child = new FakeChild();
    const result = run(child);
    child.stdout.write('{"success":true}\n');
    child.emit('close', 0, null);

    await expect(result).resolves.toBeUndefined();
    expect(spawnMock).toHaveBeenCalledWith(
      '/opt/solarch',
      expect.arrayContaining(['verify', '--archive', '/private/archive.slr']),
      expect.objectContaining({ shell: false, stdio: ['ignore', 'pipe', 'pipe'] }),
    );
    const childEnv = spawnMock.mock.calls[0][2].env;
    expect(Object.keys(childEnv).sort()).toEqual(
      ['HOMEDRIVE', 'HOMEPATH', 'PATH', 'SYSTEMROOT', 'TEMP', 'TMP', 'USERPROFILE'].sort(),
    );
  });

  test('kills and reaps a verifier whose stdout exceeds the protocol cap', async () => {
    const child = new FakeChild();
    const result = run(child);
    child.stdout.write(Buffer.alloc(4097, 0x61));

    await expect(result).rejects.toThrow(/stdout exceeded 4096 bytes/);
    expect(child.kill).toHaveBeenCalledWith('SIGKILL');
  });

  test('kills and reaps a verifier on timeout', async () => {
    jest.useFakeTimers();
    try {
      const child = new FakeChild();
      const result = run(child);
      jest.advanceTimersByTime(300_001);

      await expect(result).rejects.toThrow(/timed out/);
      expect(child.kill).toHaveBeenCalledWith('SIGKILL');
    } finally {
      jest.useRealTimers();
    }
  });

  test('fails closed and waits for close after a verifier process error', async () => {
    const child = new FakeChild();
    const result = run(child);
    child.emit('error', new Error('spawn denied'));

    await expect(result).rejects.toThrow(/spawn denied/);
    expect(child.kill).toHaveBeenCalledWith('SIGKILL');
  });

  test('drains stderr but bounds diagnostic retention on verifier failure', async () => {
    const child = new FakeChild();
    const result = run(child);
    child.stderr.write(Buffer.alloc(32_768, 0x78));
    child.emit('close', 2, null);

    let caught: unknown;
    try {
      await result;
    } catch (error) {
      caught = error;
    }
    expect(caught).toBeInstanceOf(Error);
    const message = (caught as Error).message;
    expect(message).toContain('exited with code 2');
    expect(Buffer.byteLength(message, 'utf8')).toBeLessThan(17_000);
  });

  test('kills and reaps a pending verifier whose stdout exceeds 4096 bytes', async () => {
    const child = new FakeChild();
    const result = runPending(child);
    child.stdout.write(Buffer.alloc(4_097, 0x61));

    await expect(result).rejects.toThrow(/pending-build stdout exceeded 4096 bytes/);
    expect(child.kill).toHaveBeenCalledWith('SIGKILL');
  });

  test('bounds create stdout after the exact 40-byte signing frame', async () => {
    const child = new FakeChild();
    jest.spyOn(adapter as any, 'executePendingBuildVerify').mockResolvedValue({
      success: true,
      signing_digest: '11'.repeat(32),
      file_count: 1,
      size_bytes: 100,
    });
    const result = runDuplex(child);
    child.stdout.write(
      Buffer.concat([Buffer.from('SLRSIGN1'), Buffer.alloc(32, 0x11), Buffer.alloc(4_097, 0x61)]),
    );

    await expect(result).rejects.toThrow(/create JSON stdout exceeded 4096 bytes/);
    expect(child.kill).toHaveBeenCalledWith('SIGKILL');
  });

  test('hashes the pending file through the streaming helper before signing', async () => {
    const child = new FakeChild();
    const digest = '11'.repeat(32);
    const pendingVerify = jest
      .spyOn(adapter as any, 'executePendingBuildVerify')
      .mockResolvedValue({ success: true, signing_digest: digest, file_count: 1, size_bytes: 100 });
    const streamingHash = jest.spyOn(adapter as any, 'hashFileSha256').mockResolvedValue(digest);
    const exists = jest.spyOn(fs, 'existsSync').mockReturnValue(true);
    const wholeFileRead = jest.spyOn(fs, 'readFileSync');
    try {
      const result = runDuplex(child);
      child.stdout.write(Buffer.concat([Buffer.from('SLRSIGN1'), Buffer.alloc(32, 0x11)]));
      await new Promise((resolve) => setImmediate(resolve));
      child.stdout.write(
        `${JSON.stringify({ success: true, archive_fingerprint: 'a'.repeat(64), size_bytes: 100 })}\n`,
      );
      child.emit('close', 0, null);

      await expect(result).resolves.toEqual({ archiveFingerprint: 'a'.repeat(64), sizeBytes: 100 });
      expect(pendingVerify).toHaveBeenCalled();
      expect(streamingHash).toHaveBeenCalledWith('/private/archive.slr.pending');
      expect(wholeFileRead).not.toHaveBeenCalled();
    } finally {
      wholeFileRead.mockRestore();
      exists.mockRestore();
    }
  });
});
