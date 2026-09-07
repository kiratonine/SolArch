import test from 'node:test';
import assert from 'node:assert/strict';
import * as fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { execFileSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { archiveFilename, createCleanArchive, excluded, resolveRepositoryRoot, validateRelativeEntry } from './create-clean-archive.mjs';

async function fixture(t) {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), 'solarch-archive-test-'));
  t.after(() => fs.rm(root, { recursive: true, force: true }));
  return root;
}
async function put(root, entry, value = 'synthetic test data') {
  await fs.mkdir(path.dirname(path.join(root, entry)), { recursive: true });
  await fs.writeFile(path.join(root, entry), value);
}

test('UTC filename includes unique suffix and root is script-relative', () => {
  const date = new Date('2026-09-07T12:34:56Z');
  assert.match(archiveFilename(date), /^solarch-archive-core-viewer-clean-20260907T123456Z-[a-f0-9-]+\.tar\.gz$/);
  assert.notEqual(archiveFilename(date), archiveFilename(date));
  assert.equal(resolveRepositoryRoot(), path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..'));
});

test('invalid timestamp does not allocate a staging directory', async (t) => {
  const root = await fixture(t);
  const before = (await fs.readdir(os.tmpdir())).filter((entry) => entry.startsWith('solarch-review-')).sort();
  await assert.rejects(createCleanArchive({ root, now: new Date(NaN) }));
  const after = (await fs.readdir(os.tmpdir())).filter((entry) => entry.startsWith('solarch-review-')).sort();
  assert.deepEqual(after, before);
  assert.deepEqual(await fs.readdir(path.join(root, 'artifacts')), []);
});

test('unsafe relative entries rejected', () => {
  for (const entry of ['', '..', '../x', '/abs', 'a//b', './x', 'a/../b', 'C:/x', 'a\\b', 'a\0b', 'a:stream']) {
    assert.throws(() => validateRelativeEntry(entry), /Unsafe/);
  }
  assert.equal(validateRelativeEntry('crates/core/src/key.rs'), 'crates/core/src/key.rs');
});

test('clean tar includes review inputs and excludes build outputs, secrets and symlinks', async (t) => {
  const root = await fixture(t);
  const included = ['AGENTS.md', 'docs/SPEC.md', 'TODO/PART_01.md', '.env.example', 'src/main.rs', 'nested/safe/file.txt', 'src/key.rs', 'src/keys.ts', 'fixtures/test-key.rs'];
  const omitted = ['.env', '.env.local', '.env.production', 'node_modules/pkg/a.js', 'target/debug/a', '.git/config', '.codex/config.toml', 'artifacts/old.tar.gz', 'a.log', 'nested/.env', 'nested/cache/a', 'tmp/a', 'temp/a', 'logs/a', 'dist/a', 'build/a', 'coverage/a', '.next/a', 'playwright-report/a', 'test-results/a', 'traces/a', '.DS_Store', 'file:Zone.Identifier', 'secrets/a', 'keys/a', '.ssh/id_ed25519', 'credentials.json', 'private.pem', 'private.key', 'solarch-archive-core-viewer-clean-20260901T000000Z.tar.gz'];
  for (const entry of [...included, ...omitted]) await put(root, entry);
  await fs.symlink(path.join(root, 'src/main.rs'), path.join(root, 'linked.rs'));
  await fs.symlink(os.tmpdir(), path.join(root, 'outside'));
  const output = await createCleanArchive({ root });
  const entries = execFileSync('tar', ['-tzf', output], { encoding: 'utf8' }).trim().split('\n').map((entry) => entry.replace(/^\.\//, ''));
  for (const entry of included) assert.ok(entries.includes(entry), `missing ${entry}`);
  for (const entry of omitted) assert.ok(!entries.includes(entry), `included forbidden ${entry}`);
  assert.ok(!entries.includes('linked.rs'));
  assert.ok(!entries.some((entry) => entry.startsWith('outside')));
  assert.ok(!entries.some((entry) => entry.startsWith('artifacts/')));
  for (const entry of entries.filter((entry) => entry && !entry.endsWith('/'))) validateRelativeEntry(entry);
});

test('precise exclusions preserve key-related source filenames', () => {
  for (const entry of ['src/key.rs', 'src/keys.ts', 'tests/test-key.rs', 'src/keypair.rs', 'src/private_key.ts', 'src/credentials.mjs', 'src/service-account.ts', 'src/id_ed25519.rs', '.env.example']) assert.equal(excluded(entry), false);
  for (const entry of ['nested/keys/data', 'nested/private_keys/data', 'nested/.env.local', 'id_rsa', 'service-account.json']) assert.equal(excluded(entry), true);
});

test('clean tar excludes local credential files at any depth and preserves source and templates', async (t) => {
  const root = await fixture(t);
  const credentialPaths = [
    '.npmrc', '.netrc', '_netrc', '.pypirc', '.git-credentials', '.gitcookies',
    '.envrc', '.authinfo', '.authinfo.gpg', '.vault-token', '.s3cfg', '.boto',
    '.direnv/state/data', '.docker/config.json',
  ];
  const safePaths = [
    '.npmrc.example', '.netrc.example', '.pypirc.example', '.envrc.example',
    '.git-credentials.example', '.docker/config.json.example', '.docker/Dockerfile',
    'src/credentials.ts', 'src/authinfo.ts', 'src/config.json',
    'docs/credential-files.md',
  ];
  const omitted = ['', 'nested/project/'].flatMap((prefix) => credentialPaths.map((entry) => prefix + entry));
  omitted.push('nested/.NPMRC', 'nested/.DIRENV/state', 'nested/.DOCKER/CONFIG.JSON');
  const included = ['', 'nested/project/'].flatMap((prefix) => safePaths.map((entry) => prefix + entry));
  for (const entry of omitted) await put(root, entry, 'synthetic-credential-sentinel');
  for (const entry of included) await put(root, entry, 'safe synthetic review input');
  const output = await createCleanArchive({ root });
  const entries = execFileSync('tar', ['-tzf', output], { encoding: 'utf8' })
    .trim().split('\n').map((entry) => entry.replace(/^\.\//, ''));
  for (const entry of omitted) assert.ok(!entries.includes(entry), `included forbidden ${entry}`);
  for (const entry of included) assert.ok(entries.includes(entry), `missing ${entry}`);
  assert.ok(!entries.some((entry) => entry.toLowerCase().split('/').includes('.direnv')));
});

test('archive tool failure removes partial output and staging', async (t) => {
  const root = await fixture(t);
  await put(root, 'src/main.rs');
  const before = (await fs.readdir(os.tmpdir())).filter((entry) => entry.startsWith('solarch-review-'));
  await assert.rejects(createCleanArchive({ root, tarExecutable: path.join(root, 'missing-tar') }), /Clean archive failed/);
  assert.deepEqual(await fs.readdir(path.join(root, 'artifacts')), []);
  await assert.rejects(createCleanArchive({ root, tarExecutable: process.execPath }), /Clean archive failed/);
  assert.deepEqual(await fs.readdir(path.join(root, 'artifacts')), []);
  assert.deepEqual((await fs.readdir(os.tmpdir())).filter((entry) => entry.startsWith('solarch-review-')), before);
});

test('source file mutation or replacement fails without snapshot', async (t) => {
  for (const mutation of ['write', 'symlink', 'directory']) {
    const root = await fixture(t);
    await put(root, 'nested/a.rs', 'original');
    await assert.rejects(createCleanArchive({ root, beforeStage: async () => {
      if (mutation === 'write') await put(root, 'nested/a.rs', 'modified and longer');
      if (mutation === 'symlink') {
        await fs.unlink(path.join(root, 'nested/a.rs'));
        await fs.symlink('/etc/passwd', path.join(root, 'nested/a.rs'));
      }
      if (mutation === 'directory') {
        await fs.rename(path.join(root, 'nested'), path.join(root, 'original'));
        await fs.symlink(path.join(root, 'original'), path.join(root, 'nested'));
      }
    } }), /Clean archive failed/);
    assert.deepEqual(await fs.readdir(path.join(root, 'artifacts')), []);
  }
});

test('artifacts symlink rejected without writing outside repository', async (t) => {
  const root = await fixture(t);
  const outside = await fixture(t);
  await fs.symlink(outside, path.join(root, 'artifacts'));
  await assert.rejects(createCleanArchive({ root }), /Unsafe artifacts directory/);
  assert.deepEqual(await fs.readdir(outside), []);
});


test('artifacts replacement fails and cleanup preserves external directory', async (t) => {
  const root = await fixture(t);
  const outside = await fixture(t);
  await put(root, 'src/main.rs');
  await put(outside, 'keep.partial', 'synthetic external sentinel');
  await assert.rejects(createCleanArchive({ root, beforeStage: async () => {
    await fs.rename(path.join(root, 'artifacts'), path.join(root, 'original-artifacts'));
    await fs.symlink(outside, path.join(root, 'artifacts'));
  } }), /Clean archive failed/);
  assert.deepEqual(await fs.readdir(outside), ['keep.partial']);
  assert.equal(await fs.readFile(path.join(outside, 'keep.partial'), 'utf8'), 'synthetic external sentinel');
});

test('CLI pre-staging errors are non-secret and nonzero', async (t) => {
  const root = await fixture(t);
  await fs.mkdir(path.join(root, 'scripts'));
  await fs.copyFile(fileURLToPath(new URL('./create-clean-archive.mjs', import.meta.url)), path.join(root, 'scripts/create-clean-archive.mjs'));
  await put(root, 'artifacts');
  try {
    execFileSync(process.execPath, [path.join(root, 'scripts/create-clean-archive.mjs')], { encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'] });
    assert.fail('CLI must fail');
  } catch (error) {
    assert.equal(error.status, 1);
    assert.match(error.stderr, /^Clean archive failed;/);
    assert.ok(!error.stderr.includes(root));
  }
});
