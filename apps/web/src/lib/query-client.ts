import { QueryClient } from '@tanstack/react-query'

import { isApiError } from '@/lib/api'

/**
 * Единый QueryClient приложения.
 *
 * Данные маркетплейса меняются медленно (каталог, карточка архива), поэтому
 * держим заметный staleTime и не перезапрашиваем при каждом фокусе окна.
 * Точечные исключения задаются в конкретных query-опциях в `lib/api/`.
 */
export const queryClient = new QueryClient({
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
