import type { QueryClient } from '@tanstack/react-query'
import { Link, Outlet, createRootRouteWithContext } from '@tanstack/react-router'

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
      <header className="border-b">
        <nav className="mx-auto flex h-14 w-full max-w-6xl items-center gap-6 px-4">
          <Link to="/" className="font-heading text-lg font-semibold tracking-tight">
            SolArch
          </Link>
          <div className="ml-auto flex items-center gap-4 text-sm">
            <Link to="/" className="text-muted-foreground hover:text-foreground">
              Marketplace
            </Link>
          </div>
        </nav>
      </header>

      <main className="mx-auto w-full max-w-6xl flex-1 px-4 py-8">
        <Outlet />
      </main>

      <footer className="border-t">
        <div className="text-muted-foreground mx-auto w-full max-w-6xl px-4 py-6 text-sm">
          Скачивание <code>.slr</code> бесплатно. Доступ к содержимому оплачивается в SolArch
          Viewer.
        </div>
      </footer>
    </div>
  )
}

function NotFound() {
  return (
    <div className="py-16 text-center">
      <h1 className="font-heading text-2xl font-semibold">Страница не найдена</h1>
      <Link to="/" className="text-muted-foreground mt-4 inline-block underline">
        Вернуться в каталог
      </Link>
    </div>
  )
}
