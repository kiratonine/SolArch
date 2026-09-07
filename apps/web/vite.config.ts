/// <reference types="vitest/config" />
import { fileURLToPath, URL } from 'node:url'

import tailwindcss from '@tailwindcss/vite'
import { tanstackRouter } from '@tanstack/router-plugin/vite'
import react from '@vitejs/plugin-react'
import { defineConfig } from 'vite'

// https://vite.dev/config/
export default defineConfig({
  plugins: [
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
