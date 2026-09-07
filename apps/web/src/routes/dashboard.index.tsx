import { useQuery } from '@tanstack/react-query'
import { createFileRoute } from '@tanstack/react-router'

import { CreatorArchiveCard } from '@/components/archive/creator-archive-card'
import { WalletAddress } from '@/components/auth/wallet-address'
import { Container } from '@/components/layout/container'
import { PageHeader } from '@/components/layout/page-header'
import { ArchiveCardSkeleton } from '@/components/state/archive-card-skeleton'
import { EmptyState } from '@/components/state/empty-state'
import { ErrorState } from '@/components/state/error-state'
import { myArchivesQuery, sessionQuery, toUserMessage } from '@/lib/api'
import type { CreatorArchive } from '@/lib/api'
import { useI18n } from '@/lib/i18n'

export const Route = createFileRoute('/dashboard/')({
  /**
   * Список греется до перехода: кабинет открывают из шапки, и запрос успевает
   * уйти, пока роутер меняет страницу. `prefetchQuery` не бросает — истёкшая
   * сессия должна увести на вход через guard, а не через обработчик ошибок.
   */
  loader: ({ context }) => {
    void context.queryClient.prefetchQuery(myArchivesQuery())
  },
  component: DashboardPage,
})

/**
 * Порядок списка задаёт фронт: параметра сортировки у собственных архивов в контракте
 * нет, а список короткий и весь приходит разом. Новые сверху — автор возвращается
 * к тому, над чем работал последним.
 *
 * Даты приходят строками ISO 8601 и в этом виде сравнимы посимвольно, но `created_at`
 * задаёт backend, а часовой пояс и точность в контракте не оговорены. Сравнение
 * через `Date` не зависит ни от того, ни от другого.
 */
function newestFirst(archives: CreatorArchive[]): CreatorArchive[] {
  return [...archives].sort(
    (a, b) => new Date(b.created_at).getTime() - new Date(a.created_at).getTime(),
  )
}

/**
 * Кабинет автора: всё, что он создал.
 *
 * Страница ничего не считает. Статусы, цена, доля автора и метрики приходят готовыми
 * (`docs/INTEGRATION.md` §10) — фронт только раскладывает их по карточкам. Выручки
 * за период здесь нет: агрегата в контракте не существует, а перемножить открытия
 * на долю автора значило бы выдумать число, за которое никто не отвечает.
 */
function DashboardPage() {
  const { t } = useI18n()
  const { data: session } = useQuery(sessionQuery())
  const { data, isPending, isError, error, refetch } = useQuery(myArchivesQuery())

  return (
    <Container>
      <PageHeader title={t.dashboard.title} lead={t.dashboard.lead} />

      {/* Полный адрес, а не сокращённый: в шапке он обрезан, а сверять кошелёк
          перед созданием архива придётся целиком. */}
      {session && (
        <p className="text-muted-foreground mb-8 flex flex-wrap items-baseline gap-2 text-[0.8125rem]">
          {t.dashboard.signedInAs}
          <WalletAddress address={session.wallet} className="text-foreground break-all" full />
        </p>
      )}

      {isPending && (
        <div className="space-y-3" aria-busy="true" aria-label={t.dashboard.loading}>
          <ArchiveCardSkeleton />
          <ArchiveCardSkeleton />
        </div>
      )}

      {isError && (
        <ErrorState
          title={t.dashboard.error.title}
          message={toUserMessage(error)}
          onRetry={() => void refetch()}
        />
      )}

      {data && data.length === 0 && (
        <EmptyState title={t.dashboard.empty.title} body={t.dashboard.empty.body} />
      )}

      {data && data.length > 0 && (
        <ul className="space-y-3">
          {newestFirst(data).map((archive) => (
            <li key={archive.archive_id}>
              <CreatorArchiveCard archive={archive} />
            </li>
          ))}
        </ul>
      )}
    </Container>
  )
}
