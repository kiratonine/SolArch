import { keepPreviousData, useQuery } from '@tanstack/react-query'
import { Link, createFileRoute } from '@tanstack/react-router'

import { ArchiveCard } from '@/components/archive/archive-card'
import { TILE_GRID } from '@/components/archive/tile'
import { CatalogPagination } from '@/components/catalog/catalog-pagination'
import { SearchField } from '@/components/catalog/search-field'
import { SortNav } from '@/components/catalog/sort-nav'
import { Container } from '@/components/layout/container'
import { PageHeader } from '@/components/layout/page-header'
import { ArchiveCardSkeleton } from '@/components/state/archive-card-skeleton'
import { EmptyState } from '@/components/state/empty-state'
import { ErrorState } from '@/components/state/error-state'
import { marketplaceListQuery, toUserMessage } from '@/lib/api'
import {
  pageCount,
  resolveCatalogSearch,
  validateCatalogSearch,
} from '@/lib/catalog-search'
import { useI18n } from '@/lib/i18n'
import { cn } from '@/lib/utils'

export const Route = createFileRoute('/')({
  validateSearch: validateCatalogSearch,
  component: CatalogPage,
})

/**
 * Landing и каталог — одна страница.
 *
 * Сортировка, поиск и страница читаются из адреса, а не из состояния компонента:
 * любую выдачу можно переслать ссылкой. Порядок задаёт backend, фронт лишь передаёт
 * `sort` (`docs/roles/02_MARKETPLACE_FRONTEND.md` §4).
 */
function CatalogPage() {
  const { t } = useI18n()
  const search = Route.useSearch()
  const { sort, q, page } = resolveCatalogSearch(search)

  const { data, isPending, isError, isPlaceholderData, error, refetch } = useQuery({
    ...marketplaceListQuery({ sort, search: q || undefined, page }),
    // При смене сортировки или страницы список не должен схлопываться в скелет:
    // прошлая выдача остаётся на экране и приглушается, пока идёт запрос.
    placeholderData: keepPreviousData,
  })

  const pages = data ? pageCount(data.total, data.per_page) : 1
  const searching = q !== ''

  return (
    <Container wide>
      <PageHeader title={t.catalog.title} lead={t.catalog.lead} />

      {/* На узком экране поиск и сортировка стоят отдельными строками: в русской
          локали пять подписей сортировки занимают почти всю ширину. На широком
          встают в одну строку — поле на всю рамку было бы бесконечно длинным. */}
      <div className="mb-6 flex flex-col gap-3 xl:flex-row xl:items-center xl:justify-between">
        <SearchField value={q} className="w-full xl:max-w-sm" />
        {/* Без отрицательного отступа: активный чип нарисован рамкой, и сдвиг
            «под текст» выносил бы её за общую левую кромку страницы. */}
        <SortNav active={sort} />
      </div>

      {isPending && (
        <div className={TILE_GRID} aria-busy="true" aria-label={t.catalog.loading}>
          {Array.from({ length: 10 }, (_, i) => (
            <ArchiveCardSkeleton key={i} />
          ))}
        </div>
      )}

      {isError && (
        <ErrorState
          title={t.catalog.error.title}
          message={toUserMessage(error)}
          onRetry={() => void refetch()}
        />
      )}

      {data && data.items.length === 0 && !searching && (
        <EmptyState title={t.catalog.empty.title} body={t.catalog.empty.body} />
      )}

      {data && data.items.length === 0 && searching && (
        <EmptyState
          title={t.catalog.noMatches.title(q)}
          body={t.catalog.noMatches.body}
          action={
            <Link
              to="/"
              search={{}}
              className="text-seal-ink text-sm font-medium underline underline-offset-4"
            >
              {t.catalog.search.clear}
            </Link>
          }
        />
      )}

      {data && data.items.length > 0 && (
        <>
          <ul
            className={cn(TILE_GRID, 'transition-opacity', isPlaceholderData && 'opacity-60')}
            aria-busy={isPlaceholderData || undefined}
          >
            {data.items.map((archive) => (
              <li key={archive.archive_id}>
                <ArchiveCard archive={archive} />
              </li>
            ))}
          </ul>

          <CatalogPagination page={page} pages={pages} />
        </>
      )}
    </Container>
  )
}
