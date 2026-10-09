import { Outlet, createFileRoute, redirect } from '@tanstack/react-router'

import { sessionQuery } from '@/lib/api'

/**
 * Кабинет автора закрыт от гостя.
 *
 * Проверка стоит в `beforeLoad`, а не в компоненте: пока сессия не подтверждена,
 * перехода не происходит вовсе, и приватная страница не успевает мигнуть на экране.
 * Адрес, куда человек шёл, уезжает в `redirect` — после входа он вернётся туда же.
 */
export const Route = createFileRoute('/dashboard')({
  beforeLoad: async ({ context, location }) => {
    const session = await context.queryClient.ensureQueryData(sessionQuery())

    if (!session) {
      throw redirect({ to: '/login', search: { redirect: location.href } })
    }

    return { session }
  },
  component: () => <Outlet />,
})
