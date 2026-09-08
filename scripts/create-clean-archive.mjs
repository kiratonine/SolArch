#!/usr/bin/env node
import { constants } from 'node:fs';
import * as fs from 'node:fs/promises';
import path from 'node:path';
import os from 'node:os';
import { fileURLToPath } from 'node:url';
import { randomUUID } from 'node:crypto';
import { spawn } from 'node:child_process';
import { pipeline } from 'node:stream/promises';

const excludedDirectories = new Set([
  '.git', '.codex', '.agents', 'node_modules', 'target', 'dist', 'build',
  'coverage', '.next', 'artifacts', 'tmp', 'temp', 'logs', 'playwright-report',
  'test-results', 'traces', '.cache', 'cache', 'caches', '__pycache__', '.pytest_cache',
  '.turbo', '.parcel-cache', '.pnpm-store', '.svelte-kit', '.nuxt', '.output',
  'secrets', '.secrets', 'keys', '.keys', 'private-keys', 'private_keys',
  'credentials', '.credentials', '.ssh', '.aws', '.azure', '.gnupg', '.direnv',
]);

// Exact local credential filenames, not source-name or extension heuristics.
// Templates such as .npmrc.example remain reviewable.
const excludedCredentialFiles = new Set([
  '.npmrc', '.netrc', '_netrc', '.pypirc', '.git-credentials', '.gitcookies',
  '.envrc', '.authinfo', '.authinfo.gpg', '.vault-token', '.s3cfg', '.boto',
]);

export function validateRelativeEntry(entry) {
  if (typeof entry !== 'string' || !entry || entry.includes('\\') || entry.includes('\0') ||
      path.posix.isAbsolute(entry) || /^[a-z]:/i.test(entry) ||
      entry.split('/').some((part) => !part || part === '.' || part === '..' || part.includes(':'))) {
    throw new Error('Unsafe archive entry');
  }
  return entry;
}

export function excluded(entry, isDirectory = false) {
  const parts = entry.split('/');
  if (parts.slice(0, isDirectory ? undefined : -1).some((part) => excludedDirectories.has(part.toLowerCase()))) return true;
  const name = parts.at(-1).toLowerCase();
  if (excludedCredentialFiles.has(name) ||
      name === 'agents_backup.md' ||
      (parts.at(-2)?.toLowerCase() === '.docker' && name === 'config.json')) return true;
  return (name.startsWith('.env') && (name === '.env' || name.startsWith('.env.')) && name !== '.env.example') ||
    name.endsWith('.log') || name === '.ds_store' || name === 'thumbs.db' || name === 'desktop.ini' ||
    name.startsWith('._') || name.endsWith(':zone.identifier') ||
    /\.(pem|key|p12|pfx|jks|keystore)$/.test(name) || /^id_(rsa|dsa|ecdsa|ed25519)(\.pub)?$/.test(name) ||
    /^(credentials|service-account|service_account|keypair|private-key|private_key|secret-key|secret_key)(?:$|(?:[.-][a-z0-9_-]+)*\.(?:json|txt|bin|yaml|yml|toml|ini|dat)$)/.test(name) ||
    /^solarch-.*-clean-.*\.(tar\.gz|tgz|zip)$/.test(name);
}

export function resolveRepositoryRoot() {
  return path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
}

export function archiveFilename(now = new Date()) {
  const stamp = now.toISOString().replace(/[-:]/g, '').replace(/\.\d{3}Z$/, 'Z');
  return `solarch-archive-core-viewer-clean-${stamp}-${randomUUID()}.tar.gz`;
}

function sameFile(a, b) {
  return a.dev === b.dev && a.ino === b.ino && a.size === b.size &&
    a.mtimeNs === b.mtimeNs && a.ctimeNs === b.ctimeNs && a.mode === b.mode;
}

async function checkedParents(root, entry) {
  let parent = root;
  for (const segment of entry.split('/').slice(0, -1)) {
    parent = path.join(parent, segment);
    const stat = await fs.lstat(parent);
    if (!stat.isDirectory() || stat.isSymbolicLink()) throw new Error('Source directory changed during staging');
  }
  const actual = await fs.realpath(path.join(root, entry));
  if (actual !== path.join(root, entry)) throw new Error('Source escaped repository during staging');
}

async function collect(root, directory = '', files = []) {
  for (const name of (await fs.readdir(path.join(root, directory))).sort()) {
    const entry = directory ? `${directory}/${name}` : name;
    const stat = await fs.lstat(path.join(root, entry), { bigint: true });
    if (stat.isSymbolicLink() || excluded(entry, stat.isDirectory())) continue;
    validateRelativeEntry(entry);
    if (stat.isDirectory()) await collect(root, entry, files);
    else if (stat.isFile()) files.push({ entry, stat });
  }
  return files;
}

async function stageFile(root, staging, { entry, stat }) {
  await checkedParents(root, entry);
  const source = path.join(root, entry);
  const handle = await fs.open(source, constants.O_RDONLY | (constants.O_NOFOLLOW ?? 0));
  try {
    const before = await handle.stat({ bigint: true });
    if (!before.isFile() || !sameFile(stat, before)) throw new Error('Source changed during staging');
    const destination = path.join(staging, entry);
    await fs.mkdir(path.dirname(destination), { recursive: true });
    const output = await fs.open(destination, 'wx', Number(before.mode & 0o777n));
    try {
      const buffer = Buffer.alloc(64 * 1024);
      let copied = 0n;
      while (copied < before.size) {
        const { bytesRead } = await handle.read(buffer, 0, Number(before.size - copied > 65536n ? 65536n : before.size - copied));
        if (!bytesRead) throw new Error('Source truncated during staging');
        let written = 0;
        while (written < bytesRead) {
          const result = await output.write(buffer, written, bytesRead - written);
          if (!result.bytesWritten) throw new Error('Unable to stage source');
          written += result.bytesWritten;
        }
        copied += BigInt(bytesRead);
      }
    } finally { await output.close(); }
    await checkedParents(root, entry);
    if (!sameFile(before, await handle.stat({ bigint: true })) ||
        !sameFile(before, await fs.lstat(source, { bigint: true }))) throw new Error('Source changed during staging');
  } finally { await handle.close(); }
}

async function tar(staging, partial, executable) {
  const output = await fs.open(partial, 'wx', 0o600);
  try {
    const child = spawn(executable, ['-czf', '-', '-C', staging, '.'], {
      shell: false, stdio: ['ignore', 'pipe', 'ignore'],
      env: { ...process.env, TAR_OPTIONS: '', GZIP: '' },
    });
    const completion = new Promise((resolve, reject) => {
      child.once('error', () => reject(new Error('Unable to start archive tool')));
      child.once('close', (code) => code === 0 ? resolve() : reject(new Error('Archive tool failed')));
    });
    const results = await Promise.allSettled([
      completion,
      pipeline(child.stdout, output.createWriteStream()).catch((error) => { child.kill(); throw error; }),
    ]);
    if (results.some((result) => result.status === 'rejected')) throw new Error('Archive creation failed');
  } finally { await output.close(); }
}

export async function createCleanArchive({ root = resolveRepositoryRoot(), now = new Date(), tarExecutable = 'tar', beforeStage } = {}) {
  root = await fs.realpath(root);
  const artifacts = path.join(root, 'artifacts');
  await fs.mkdir(artifacts, { recursive: true });
  const artifactStat = await fs.lstat(artifacts, { bigint: true });
  if (!artifactStat.isDirectory() || artifactStat.isSymbolicLink() || await fs.realpath(artifacts) !== artifacts) {
    throw new Error('Unsafe artifacts directory');
  }
  const output = path.join(artifacts, archiveFilename(now));
  const staging = await fs.mkdtemp(path.join(os.tmpdir(), 'solarch-review-'));
  const partial = `${output}.partial`;
  let published = false;
  try {
    const files = await collect(root);
    if (beforeStage) await beforeStage();
    for (const file of files) await stageFile(root, staging, file);
    const current = await fs.lstat(artifacts, { bigint: true });
    if (current.ino !== artifactStat.ino || current.dev !== artifactStat.dev || current.isSymbolicLink()) throw new Error('Artifacts directory changed');
    await tar(staging, partial, tarExecutable);
    // Hard link publishes without overwriting any pre-existing snapshot.
    const afterTar = await fs.lstat(artifacts, { bigint: true });
    if (afterTar.ino !== artifactStat.ino || afterTar.dev !== artifactStat.dev || afterTar.isSymbolicLink()) throw new Error('Artifacts directory changed');
    await fs.link(partial, output);
    published = true;
    await fs.unlink(partial);
    return output;
  } catch {
    // Never follow a replaced artifacts directory while removing our outputs.
    const cleanupDirectory = await fs.lstat(artifacts, { bigint: true }).catch(() => null);
    if (cleanupDirectory?.isDirectory() && !cleanupDirectory.isSymbolicLink() &&
        cleanupDirectory.ino === artifactStat.ino && cleanupDirectory.dev === artifactStat.dev &&
        await fs.realpath(artifacts) === artifacts) {
      if (published) await fs.rm(output, { force: true });
      await fs.rm(partial, { force: true });
    }
    throw new Error('Clean archive failed; check source stability, artifacts directory, and tar availability');
  } finally {
    await fs.rm(staging, { recursive: true, force: true });
  }
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  createCleanArchive().then((output) => process.stdout.write(`${output}\n`)).catch(() => {
    process.stderr.write('Clean archive failed; check source stability, artifacts directory, and tar availability\n');
    process.exitCode = 1;
  });
}
