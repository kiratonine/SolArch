import { QueryCache, QueryClient } from '@tanstack/react-query'

import { isApiError, queryKeys } from '@/lib/api'

/**
 * Единый QueryClient приложения.
 *
 * Данные маркетплейса меняются медленно (каталог, карточка архива), поэтому
 * держим заметный staleTime и не перезапрашиваем при каждом фокусе окна.
 * Точечные исключения задаются в конкретных query-опциях в `lib/api/`.
 */

/**
 * Что делает приложение, узнав об истёкшей сессии.
 *
 * Клиент запросов не знает про роутер, поэтому переход наружу задаётся один раз
 * при старте (`main.tsx`): там `router.invalidate()` перезапускает guard кабинета,
 * и человек оказывается на странице входа тем же путём, что и обычный гость.
 */
let onUnauthorized: (() => void) | null = null

export function handleUnauthorized(handler: (() => void) | null): void {
  onUnauthorized = handler
}

export function createQueryClient(): QueryClient {
  const client = new QueryClient({
    queryCache: new QueryCache({
      /**
       * Просроченная сессия приходит не событием, а ответом 401 на первый же
       * запрос кабинета. Обработчик один на весь клиент: разложенный по запросам,
       * он рано или поздно был бы забыт в одном из них.
       */
      onError: (error) => {
        if (!isApiError(error) || !error.isUnauthorized) return

        client.setQueryData(queryKeys.session, null)
        onUnauthorized?.()
      },
    }),
    defaultOptions: {
      queries: {
        staleTime: 60_000,
        gcTime: 5 * 60_000,
        refetchOnWindowFocus: false,
        // Ответ 4xx повтором не исправить: 404 на снятый с публикации архив
        // останется 404 и только задержит показ страницы. Повторяем лишь сбои
        // сети и 5xx.
        retry: (failureCount, error) => {
          if (isApiError(error) && error.status < 500) return false
          return failureCount < 1
        },
      },
      mutations: {
        retry: 0,
      },
    },
  })

  return client
}

export const queryClient = createQueryClient()
