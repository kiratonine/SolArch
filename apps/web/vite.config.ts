/// <reference types="vitest/config" />
import { readFileSync } from 'node:fs'
import { fileURLToPath, URL } from 'node:url'

import tailwindcss from '@tailwindcss/vite'
import { tanstackRouter } from '@tanstack/router-plugin/vite'
import react from '@vitejs/plugin-react'
import { defineConfig, type Plugin } from 'vite'

const mockServiceWorkerPath = fileURLToPath(
  new URL('./src/mocks/mockServiceWorker.js', import.meta.url),
)

/**
 * Keep the generated MSW worker reachable in development without placing it
 * in Vite's production-copied public directory.
 */
function serveDevelopmentMockWorker(): Plugin {
  return {
    name: 'solarch-development-mock-worker',
    apply: 'serve',
    configureServer(server) {
      server.middlewares.use((request, response, next) => {
        if (request.url?.split('?', 1)[0] !== '/mockServiceWorker.js') {
          next()
          return
        }

        response.statusCode = 200
        response.setHeader('Content-Type', 'text/javascript; charset=utf-8')
        response.setHeader('Cache-Control', 'no-store')
        response.setHeader('Service-Worker-Allowed', '/')
        response.end(readFileSync(mockServiceWorkerPath))
      })
    },
  }
}

// https://vite.dev/config/
export default defineConfig({
  plugins: [
    serveDevelopmentMockWorker(),
    // router plugin must run before the react plugin
    tanstackRouter({ target: 'react', autoCodeSplitting: true }),
    react(),
    tailwindcss(),
  ],
  resolve: {
    alias: {
      '@': fileURLToPath(new URL('./src', import.meta.url)),
    },
  },
  server: {
    port: 5173,
  },
  test: {
    environment: 'jsdom',
    globals: true,
    // Keep the full jsdom suite stable on Node 20 and WSL/NTFS instead of
    // starting one memory-heavy worker for every test file at once.
    maxWorkers: 4,
    /**
     * Тест обязан переживать самое долгое ожидание внутри себя. Ожидание запросов
     * поднято до 5 с (`test/setup.ts`), и при таком же таймауте теста «не дождался»
     * приходило как «тест завис» — без сообщения о том, чего именно не хватило.
     */
    testTimeout: 20_000,
    setupFiles: ['./src/test/setup.ts'],
    css: false,
    include: ['src/**/*.{test,spec}.{ts,tsx}'],
    coverage: {
      provider: 'v8',
      reportsDirectory: './coverage',
      exclude: ['src/routeTree.gen.ts', 'src/test/**', 'src/mocks/**'],
    },
  },
})
