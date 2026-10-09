import { describe, expect, it, vi } from 'vitest'

import { ApiError, queryKeys } from '@/lib/api'
import { MOCK_CREATOR } from '@/mocks/db'
import { createQueryClient, handleUnauthorized } from './query-client'

/**
 * Просроченная сессия приходит не как событие, а как 401 на первый же запрос
 * кабинета. Обрабатывать её в каждом запросе отдельно — значит рано или поздно
 * забыть в одном месте, поэтому обработчик один на весь клиент.
 */
describe('истёкшая сессия', () => {
  it('обнуляет сессию в кеше, когда запрос кабинета отвечает 401', async () => {
    const client = createQueryClient()
    client.setQueryData(queryKeys.session, MOCK_CREATOR)

    await client
      .fetchQuery({
        queryKey: queryKeys.archives.list(),
        queryFn: () => {
          throw new ApiError(401, { code: 'UNAUTHORIZED', message: 'Требуется вход автора' })
        },
        retry: false,
      })
      .catch(() => undefined)

    expect(client.getQueryData(queryKeys.session)).toBeNull()
  })

  it('зовёт обработчик приложения, чтобы оно увело человека на вход', async () => {
    const expired = vi.fn()
    const client = createQueryClient()
    handleUnauthorized(expired)

    await client
      .fetchQuery({
        queryKey: queryKeys.archives.list(),
        queryFn: () => {
          throw new ApiError(401, { code: 'UNAUTHORIZED', message: 'Требуется вход автора' })
        },
        retry: false,
      })
      .catch(() => undefined)

    expect(expired).toHaveBeenCalledOnce()
    handleUnauthorized(null)
  })

  it('не трогает сессию на обычной ошибке', async () => {
    const client = createQueryClient()
    client.setQueryData(queryKeys.session, MOCK_CREATOR)

    await client
      .fetchQuery({
        queryKey: queryKeys.archives.list(),
        queryFn: () => {
          throw new ApiError(404, { code: 'ARCHIVE_NOT_FOUND', message: 'Archive not found' })
        },
        retry: false,
      })
      .catch(() => undefined)

    expect(client.getQueryData(queryKeys.session)).toEqual(MOCK_CREATOR)
  })
})
