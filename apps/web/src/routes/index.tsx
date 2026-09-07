import { useQuery } from '@tanstack/react-query'
import { createFileRoute } from '@tanstack/react-router'

import { ArchiveCard } from '@/components/archive/archive-card'
import { Container } from '@/components/layout/container'
import { PageHeader } from '@/components/layout/page-header'
import { ArchiveCardSkeleton } from '@/components/state/archive-card-skeleton'
import { EmptyState } from '@/components/state/empty-state'
import { ErrorState } from '@/components/state/error-state'
import { marketplaceListQuery, toUserMessage } from '@/lib/api'
import { useI18n } from '@/lib/i18n'

export const Route = createFileRoute('/')({
  component: CatalogPage,
})

/**
 * Каталог на дизайн-языке S2. Сортировки, поиск и переход на страницу архива
 * приходят на S3–S4; здесь показан сам список и три его состояния.
 */
function CatalogPage() {
  const { t, format } = useI18n()
  const { data, isPending, isError, error, refetch } = useQuery(
    marketplaceListQuery({ sort: 'popular_week' }),
  )

  const total = data?.total ?? 0

  return (
    <Container>
      <PageHeader
        title={t.catalog.title}
        lead={t.catalog.lead}
        aside={
          data && (
            <p className="numeric text-muted-foreground text-sm">
              {format.count(total)} {t.units.archives(total)}
            </p>
          )
        }
      />

      {isPending && (
        <div className="space-y-3" aria-busy="true" aria-label={t.catalog.loading}>
          <ArchiveCardSkeleton />
          <ArchiveCardSkeleton />
          <ArchiveCardSkeleton />
        </div>
      )}

      {isError && (
        <ErrorState
          title={t.catalog.error.title}
          message={toUserMessage(error)}
          onRetry={() => void refetch()}
        />
      )}

      {data && data.items.length === 0 && (
        <EmptyState title={t.catalog.empty.title} body={t.catalog.empty.body} />
      )}

      {data && data.items.length > 0 && (
        <ul className="space-y-3">
          {data.items.map((archive) => (
            <li key={archive.archive_id}>
              <ArchiveCard archive={archive} />
            </li>
          ))}
        </ul>
      )}
    </Container>
  )
}
