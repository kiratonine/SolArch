import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import {
  RouterProvider,
  createMemoryHistory,
  createRootRoute,
  createRoute,
  createRouter,
} from '@tanstack/react-router'
import { render, type RenderOptions, type RenderResult } from '@testing-library/react'
import type { ReactElement, ReactNode } from 'react'

import { I18nProvider, type Locale } from '@/lib/i18n'
import { routeTree } from '@/routeTree.gen'

/**
 * Рендер с зафиксированной локалью.
 *
 * Язык в тестах задаётся явно, иначе результат зависел бы от `navigator.language`
 * машины, на которой их запустили.
 */
export function renderWithI18n(
  ui: ReactElement,
  { locale = 'en', ...options }: RenderOptions & { locale?: Locale } = {},
): RenderResult {
  function Wrapper({ children }: { children: ReactNode }) {
    return <I18nProvider locale={locale}>{children}</I18nProvider>
  }

  return render(ui, { wrapper: Wrapper, ...options })
}

/**
 * Рендер одиночного компонента, которому нужен роутер.
 *
 * Дерево здесь минимальное и содержит ровно те пути, на которые компоненты ставят
 * ссылки: `Link` собирает адрес по дереву маршрутов и на несуществующем пути падает.
 */
export function renderWithRouter(
  ui: ReactElement,
  { locale = 'en' }: { locale?: Locale } = {},
): RenderResult {
  const rootRoute = createRootRoute()
  const routes = [
    createRoute({ getParentRoute: () => rootRoute, path: '/', component: () => ui }),
    createRoute({
      getParentRoute: () => rootRoute,
      path: '/archives/$slug',
      component: () => null,
    }),
  ]

  const router = createRouter({
    routeTree: rootRoute.addChildren(routes),
    history: createMemoryHistory({ initialEntries: ['/'] }),
  })

  return render(
    <I18nProvider locale={locale}>
      <RouterProvider router={router} />
    </I18nProvider>,
  )
}

/**
 * Рендер всего приложения по настоящему дереву маршрутов, с памятью вместо адресной
 * строки. Запросы уходят в MSW, поднятый в `test/setup.ts`.
 *
 * Так проверяется именно то, чем пользуется человек: сортировка и поиск как параметры
 * адреса, переход из каталога на страницу архива, состояния загрузки и ошибки.
 */
export function renderApp({
  path = '/',
  locale = 'en',
}: { path?: string; locale?: Locale } = {}) {
  const queryClient = new QueryClient({
    // Повторы и кеш в тестах только маскируют ошибки и замедляют прогон.
    defaultOptions: { queries: { retry: false, gcTime: 0, staleTime: 0 } },
  })

  const router = createRouter({
    routeTree,
    context: { queryClient },
    history: createMemoryHistory({ initialEntries: [path] }),
  })

  const result = render(
    <I18nProvider locale={locale}>
      <QueryClientProvider client={queryClient}>
        <RouterProvider router={router} />
      </QueryClientProvider>
    </I18nProvider>,
  )

  return { ...result, router, queryClient }
}
