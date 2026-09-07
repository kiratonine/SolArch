import '@testing-library/jest-dom/vitest'

import { cleanup, configure } from '@testing-library/react'
import { afterAll, afterEach, beforeAll } from 'vitest'

import { resetDb } from '@/mocks/db'
import { server } from '@/mocks/node'

/**
 * Ожидание по умолчанию — секунда, и на полном прогоне этого не хватало: запрос
 * уходит в MSW, а карточки собираются уже под нагрузкой от параллельных файлов.
 * Тест падал не потому, что приложение сломано, а потому, что не дождался.
 * Ждём дольше — на зелёном прогоне это не стоит ничего, ждать до конца незачем.
 */
configure({ asyncUtilTimeout: 5_000 })

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
