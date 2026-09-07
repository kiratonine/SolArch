import { QueryClient } from '@tanstack/react-query'

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
      retry: 1,
    },
    mutations: {
      retry: 0,
    },
  },
})
