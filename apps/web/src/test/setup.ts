import '@testing-library/jest-dom/vitest'

import { cleanup, configure } from '@testing-library/react'
import { afterAll, afterEach, beforeAll } from 'vitest'

import { clearAuthToken } from '@/lib/api/auth-token'
import { resetDb } from '@/mocks/db'
import { server } from '@/mocks/node'

/**
 * Ожидание по умолчанию — секунда, и на полном прогоне этого не хватало: запрос
 * уходит в MSW, а карточки собираются уже под нагрузкой от параллельных файлов.
 * Тест падал не потому, что приложение сломано, а потому, что не дождался.
 * Ждём дольше — на зелёном прогоне это не стоит ничего, ждать до конца незачем.
 */
configure({ asyncUtilTimeout: 5_000 })

/**
 * XHR, который отдаёт MSW тело-`Blob` байтами.
 *
 * MSW перекладывает тело XHR в `Request` Node, а тот понимает только свои, нативные
 * `Blob`: jsdom-овский доезжал до мока строкой `"undefined"`, и мок честно отвечал,
 * что это не ZIP. В браузере такого нет — там тело забирает service worker. Поэтому
 * чинится стенд, а не приложение: `send(blob)` сперва читает `Blob` в `ArrayBuffer`.
 * `Content-Type` при этом не теряется — загрузка выставляет его явно.
 */
function sendBlobsAsBytes(Intercepted: typeof XMLHttpRequest): typeof XMLHttpRequest {
  return new Proxy(Intercepted, {
    construct(target, args) {
      const xhr = Reflect.construct(target, args) as XMLHttpRequest

      return new Proxy(xhr, {
        get(instance, property) {
          if (property === 'send') {
            return (body?: Document | XMLHttpRequestBodyInit | null) => {
              if (body instanceof Blob) {
                void body.arrayBuffer().then((buffer) => instance.send(buffer))
                return
              }
              instance.send(body)
            }
          }

          const value: unknown = Reflect.get(instance, property)
          return typeof value === 'function' ? value.bind(instance) : value
        },
        set(instance, property, value) {
          return Reflect.set(instance, property, value)
        },
      })
    },
  })
}

/**
 * MSW объявляет `XMLHttpRequest` через `defineProperty` без `writable`, и простое
 * присваивание падает. Свойство при этом `configurable` — переобъявляем так же.
 */
function defineXhr(value: typeof XMLHttpRequest): void {
  Object.defineProperty(globalThis, 'XMLHttpRequest', { value, configurable: true })
}

let interceptedXhr: typeof XMLHttpRequest | undefined

beforeAll(() => {
  // Незамоканный запрос должен падать: тест не имеет права молча уйти в сеть.
  server.listen({ onUnhandledRequest: 'error' })

  // Обёртка ставится поверх перехватчика MSW, поэтому только после `listen()`.
  interceptedXhr = globalThis.XMLHttpRequest
  defineXhr(sendBlobsAsBytes(interceptedXhr))
})

afterEach(() => {
  cleanup()
  server.resetHandlers()
  // Мок хранит состояние, поэтому тесты обязаны стартовать с чистой базы.
  resetDb()
  // А клиент — токен сессии: вошедший в прошлом тесте автор не должен войти в следующий.
  clearAuthToken()
})

afterAll(() => {
  if (interceptedXhr) defineXhr(interceptedXhr)
  server.close()
})
