import '@testing-library/jest-dom/vitest'

import { cleanup } from '@testing-library/react'
import { afterAll, afterEach, beforeAll } from 'vitest'

import { resetDb } from '@/mocks/db'
import { server } from '@/mocks/node'

beforeAll(() => {
  // Незамоканный запрос должен падать: тест не имеет права молча уйти в сеть.
  server.listen({ onUnhandledRequest: 'error' })
})

afterEach(() => {
  cleanup()
  server.resetHandlers()
  // Мок хранит состояние, поэтому тесты обязаны стартовать с чистой базы.
  resetDb()
})

afterAll(() => {
  server.close()
})
