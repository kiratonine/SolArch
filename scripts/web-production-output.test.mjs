import assert from 'node:assert/strict'
import { spawnSync } from 'node:child_process'
import { mkdtempSync, readFileSync, readdirSync, rmSync, statSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { dirname, join, relative, resolve } from 'node:path'
import test from 'node:test'
import { fileURLToPath } from 'node:url'

const repositoryRoot = resolve(dirname(fileURLToPath(import.meta.url)), '..')

function listFiles(root, directory = root) {
  return readdirSync(directory).flatMap((entry) => {
    const path = join(directory, entry)
    return statSync(path).isDirectory() ? listFiles(root, path) : [relative(root, path)]
  })
}

test('production Web output excludes the MSW service worker and dev wallet', { timeout: 120_000 }, () => {
  const outputDirectory = mkdtempSync(join(tmpdir(), 'solarch-web-production-'))

  try {
    const command = process.platform === 'win32' ? 'pnpm.cmd' : 'pnpm'
    const build = spawnSync(
      command,
      [
        '--filter',
        '@solarch/web',
        'exec',
        'vite',
        'build',
        '--outDir',
        outputDirectory,
        '--emptyOutDir',
      ],
      {
        cwd: repositoryRoot,
        encoding: 'utf8',
        env: {
          ...process.env,
          VITE_API_BASE_URL: 'https://api.example.invalid',
          VITE_ENABLE_MSW: 'false',
        },
      },
    )

    assert.equal(
      build.status,
      0,
      `production Vite build failed:\n${build.stdout}\n${build.stderr}`,
    )

    const files = listFiles(outputDirectory)
    assert.equal(files.some((file) => file.endsWith('mockServiceWorker.js')), false)

    const javascript = files
      .filter((file) => file.endsWith('.js'))
      .map((file) => readFileSync(join(outputDirectory, file), 'utf8'))
      .join('\n')
    assert.doesNotMatch(javascript, /mockServiceWorker\.js|Demo wallet \(dev\)/)
  } finally {
    rmSync(outputDirectory, { recursive: true, force: true })
  }
})
