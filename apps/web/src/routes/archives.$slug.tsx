import { useQuery } from '@tanstack/react-query'
import { Link, createFileRoute } from '@tanstack/react-router'

import { MetricGrid } from '@/components/archive/metric-grid'
import { PriceTag } from '@/components/archive/price-tag'
import { Container } from '@/components/layout/container'
import { EmptyState } from '@/components/state/empty-state'
import { ErrorState } from '@/components/state/error-state'
import { Skeleton } from '@/components/ui/skeleton'
import { buttonVariants } from '@/components/ui/button'
import { isApiError, marketplaceArchiveQuery, marketplaceDownloadUrl, toUserMessage } from '@/lib/api'
import { useI18n } from '@/lib/i18n'

export const Route = createFileRoute('/archives/$slug')({
  component: ArchivePage,
})

/**
 * Публичная страница архива.
 *
 * S3 доводит сюда переход из каталога и даёт гостю то, ради чего он пришёл:
 * что внутри по описанию, сколько стоит и кнопку «скачать .slr». Список файлов,
 * условия лицензии и ссылка на Viewer — S4.
 *
 * Скачивание — обычная ссылка, а не `fetch`: так срабатывает `Content-Disposition`
 * и backend успевает засчитать событие download.
 */
function ArchivePage() {
  const { slug } = Route.useParams()
  const { t, format } = useI18n()
  const { data, isPending, isError, error, refetch } = useQuery(marketplaceArchiveQuery(slug))

  if (isPending) {
    return (
      <Container>
        <div className="space-y-4" aria-busy="true" aria-label={t.archive.loading}>
          <Skeleton className="h-9 w-2/3" />
          <Skeleton className="h-4 w-1/3" />
          <Skeleton className="h-24 w-full" />
        </div>
      </Container>
    )
  }

  if (isError) {
    // Снятый с публикации архив для гостя не существует — backend отвечает 404,
    // и это не сбой, а нормальное состояние страницы.
    const missing = isApiError(error) && error.isNotFound

    return (
      <Container>
        {missing ? (
          <EmptyState
            title={t.archive.missing.title}
            body={t.archive.missing.body}
            action={
              <Link
                to="/"
                className="text-seal-ink text-sm font-medium underline underline-offset-4"
              >
                {t.archive.back}
              </Link>
            }
          />
        ) : (
          <ErrorState
            title={t.archive.error.title}
            message={toUserMessage(error)}
            onRetry={() => void refetch()}
          />
        )}
      </Container>
    )
  }

  return (
    <Container>
      <Link
        to="/"
        className="text-muted-foreground hover:text-foreground text-[0.8125rem] transition-colors"
      >
        {t.archive.back}
      </Link>

      <div className="mt-6 flex flex-wrap items-start justify-between gap-x-8 gap-y-4">
        <div className="min-w-0">
          <h1 className="font-display text-[clamp(1.5rem,1.1rem+1.8vw,2.125rem)] leading-[1.1] font-bold tracking-[-0.04em]">
            {data.title}
          </h1>
          <p className="text-muted-foreground mt-2 text-sm">
            {t.archive.by} {data.creator.display_name}
          </p>
        </div>
        <PriceTag price={data.price} size="lg" />
      </div>

      <p className="mt-6 max-w-[62ch] text-[0.9375rem] whitespace-pre-line">{data.description}</p>

      <MetricGrid
        className="border-border mt-8 border-t pt-5"
        items={[
          { value: format.count(data.file_count), label: t.units.files(data.file_count) },
          { value: format.bytes(data.size_bytes), label: t.metrics.size },
          { value: format.count(data.metrics.views), label: t.metrics.views },
          { value: format.count(data.metrics.downloads), label: t.metrics.downloads },
          { value: format.count(data.metrics.paid_unlocks), label: t.metrics.unlocks },
        ]}
      />

      <div className="border-border mt-8 flex flex-wrap items-center gap-x-5 gap-y-3 border-t pt-6">
        <a
          href={marketplaceDownloadUrl(data.slug)}
          download={`${data.slug}.slr`}
          className={buttonVariants({ size: 'lg' })}
        >
          {t.archive.download}
        </a>
        <div className="text-muted-foreground text-[0.8125rem]">
          <p>{t.archive.free}</p>
          <p>{t.archive.openedIn}</p>
        </div>
      </div>
    </Container>
  )
}
