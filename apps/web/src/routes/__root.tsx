import type { QueryClient } from '@tanstack/react-query'
import { Link, Outlet, createRootRouteWithContext } from '@tanstack/react-router'

import { Container } from '@/components/layout/container'
import { SiteFooter } from '@/components/layout/site-footer'
import { SiteHeader } from '@/components/layout/site-header'
import { useI18n } from '@/lib/i18n'

export interface RouterContext {
  queryClient: QueryClient
}

export const Route = createRootRouteWithContext<RouterContext>()({
  component: RootLayout,
  notFoundComponent: NotFound,
})

function RootLayout() {
  return (
    <div className="flex min-h-screen flex-col">
      <SiteHeader />
      <main className="flex-1 pt-8 pb-4">
        <Outlet />
      </main>
      <SiteFooter />
    </div>
  )
}

function NotFound() {
  const { t } = useI18n()

  return (
    <Container>
      <h1 className="font-display text-2xl font-bold tracking-[-0.04em]">
        {t.common.notFound.title}
      </h1>
      <Link
        to="/"
        className="text-seal-ink mt-4 inline-block text-sm font-medium underline underline-offset-4"
      >
        {t.common.notFound.back}
      </Link>
    </Container>
  )
}
