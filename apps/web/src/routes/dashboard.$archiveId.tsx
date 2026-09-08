import { useQuery } from '@tanstack/react-query'
import { Link, createFileRoute } from '@tanstack/react-router'
import { ArrowLeftIcon } from 'lucide-react'

import { FileManifest } from '@/components/archive/file-manifest'
import { MetricGrid } from '@/components/archive/metric-grid'
import { PriceTag } from '@/components/archive/price-tag'
import { StatusBadge } from '@/components/archive/status-badge'
import { TECHNICAL_TONE, TONE_SPINE } from '@/components/archive/tone'
import { Container } from '@/components/layout/container'
import { SectionHeading } from '@/components/layout/section-heading'
import { CatalogPreview } from '@/components/publish/catalog-preview'
import { PublishPanel } from '@/components/publish/publish-panel'
import { EmptyState } from '@/components/state/empty-state'
import { ErrorState } from '@/components/state/error-state'
import { UploadQueue } from '@/components/upload/upload-queue'
import { UploadZone } from '@/components/upload/upload-zone'
import { buttonVariants } from '@/components/ui/button'
import { Skeleton } from '@/components/ui/skeleton'
import {
  isApiError,
  myArchiveFilesQuery,
  myArchiveWithProcessingQuery,
  ownerDownloadUrl,
  toUserMessage,
  type CreatorArchive,
} from '@/lib/api'
import { useI18n } from '@/lib/i18n'
import { useArchiveUpload } from '@/lib/use-archive-upload'
import { cn } from '@/lib/utils'

export const Route = createFileRoute('/dashboard/$archiveId')({
  /**
   * Кеш греется до перехода: в архив заходят из списка кабинета, и запрос успевает
   * уйти, пока роутер меняет страницу. `prefetchQuery` не бросает — 404 на чужой
   * архив разбирает компонент, а не аварийный экран роутера (та же причина, что F35).
   */
  loader: ({ context, params }) => {
    void context.queryClient.prefetchQuery(myArchiveWithProcessingQuery(params.archiveId))
    void context.queryClient.prefetchQuery(myArchiveFilesQuery(params.archiveId))
  },
  component: ArchiveDetailPage,
})

/**
 * Страница архива в кабинете автора.
 *
 * Здесь архив получает содержимое. Порядок в жизни архива такой: сначала запись
 * с ценой (S7), потом файлы, потом собранный контейнер — и только собранный
 * контейнер можно выставить на витрину.
 *
 * Браузер передаёт байты и ничего с ними не делает: `.slr` собирает backend
 * (`docs/roles/02_MARKETPLACE_FRONTEND.md` §9). Поэтому загрузка считается
 * законченной не тогда, когда полоса дошла до конца, а когда backend подтвердил
 * `complete` и сам сменил технический статус архива.
 */
function ArchiveDetailPage() {
  const { archiveId } = Route.useParams()
  const { t, format } = useI18n()

  const { data, isPending, isError, error, refetch } = useQuery(
    myArchiveWithProcessingQuery(archiveId),
  )

  // Опись — отдельный запрос и отдельная судьба: её сбой не уносит страницу,
  // на которой уже есть статус сборки и кнопка загрузки.
  const files = useQuery({ ...myArchiveFilesQuery(archiveId), enabled: data !== undefined })

  const upload = useArchiveUpload(archiveId)

  if (isPending) {
    return (
      <Container>
        <div className="space-y-4" aria-busy="true" aria-label={t.dashboard.detail.loading}>
          <Skeleton className="h-9 w-2/3" />
          <Skeleton className="h-4 w-1/3" />
          <Skeleton className="h-32 w-full" />
        </div>
      </Container>
    )
  }

  if (isError) {
    // Чужой архив для автора не существует: владение проверяет backend и отвечает 404.
    const missing = isApiError(error) && error.isNotFound

    return (
      <Container>
        <BackLink />
        {missing ? (
          <EmptyState
            className="mt-6"
            title={t.dashboard.detail.missing.title}
            body={t.dashboard.detail.missing.body}
          />
        ) : (
          <ErrorState
            className="mt-6"
            title={t.dashboard.detail.error.title}
            message={toUserMessage(error)}
            onRetry={() => void refetch()}
          />
        )}
      </Container>
    )
  }

  // Пока backend собирает контейнер, добавлять файлы некуда: сборка идёт над тем
  // набором, который уже принят, и новый файл в неё не попадёт.
  const building = data.technical_status === 'processing'

  return (
    <Container>
      <BackLink />

      <div className="mt-6 flex flex-wrap items-start justify-between gap-x-8 gap-y-4">
        <div className="min-w-0">
          <h1 className="font-display text-[clamp(1.5rem,1.1rem+1.8vw,2.125rem)] leading-[1.1] font-bold tracking-[-0.04em]">
            {data.title}
          </h1>
          <div className="mt-3 flex flex-wrap items-center gap-1.5">
            <StatusBadge kind="technical" value={data.technical_status} />
            <StatusBadge kind="marketplace" value={data.marketplace_status} />
          </div>
        </div>

        <div className="shrink-0 text-right">
          <PriceTag price={data.price} size="lg" className="justify-end" />
          <p className="text-muted-foreground mt-1 text-xs whitespace-nowrap">
            {t.dashboard.card.payout}{' '}
            <span className="numeric text-seal-ink font-medium">
              {data.economics.creator_share}
            </span>
          </p>
        </div>
      </div>

      {/* Аналитика открывается прямо с манифеста: она и есть его продолжение —
          те же просмотры и скачивания, только с окном наблюдения и деньгами. */}
      <div className="border-border mt-8 flex flex-wrap items-end justify-between gap-x-8 gap-y-4 border-t pt-5">
        <MetricGrid
          items={[
            { value: format.count(data.file_count), label: t.units.files(data.file_count) },
            { value: format.bytes(data.size_bytes), label: t.metrics.size },
            { value: format.count(data.metrics.views), label: t.metrics.views },
            { value: format.count(data.metrics.downloads), label: t.metrics.downloads },
            {
              value: format.count(data.metrics.paid_unlocks),
              label: t.units.unlocks(data.metrics.paid_unlocks),
            },
          ]}
        />

        <Link
          to="/dashboard/$archiveId/analytics"
          params={{ archiveId: data.archive_id }}
          className="text-foreground focus-visible:ring-ring/60 rounded-sm text-[0.8125rem] font-medium underline underline-offset-4 focus-visible:ring-2 focus-visible:outline-none"
        >
          {t.analytics.action}
        </Link>
      </div>

      <section className="mt-10">
        <SectionHeading>{t.dashboard.detail.build.title}</SectionHeading>
        <BuildState archive={data} className="mt-4" />

        {!building && (
          <UploadZone
            className="mt-6"
            onFiles={upload.add}
            rejected={upload.rejected}
          />
        )}

        <UploadQueue
          className="mt-4"
          items={upload.items}
          onCancel={upload.cancel}
          onRetry={upload.retry}
        />
      </section>

      {/* Витрина стоит сразу за сборкой и перед описью: это следующий шаг в жизни
          архива, а опись — справка, за которой возвращаются, а не действие. */}
      <section className="mt-10">
        <SectionHeading>{t.dashboard.detail.listing.title}</SectionHeading>
        <PublishPanel archive={data} className="mt-4" />

        {/* Опубликованный архив показан в каталоге настоящей карточкой, и предпросмотр
            стал бы её копией. Ссылка на живую страницу отвечает на тот же вопрос точнее. */}
        {data.marketplace_status !== 'published' && data.marketplace_status !== 'blocked' && (
          <CatalogPreview archive={data} className="mt-8" />
        )}
      </section>

      <section className="border-border mt-10 border-t pt-6">
        <SectionHeading>{t.dashboard.detail.files.title}</SectionHeading>

        {files.isPending && (
          <div className="mt-4 space-y-2" aria-busy="true" aria-label={t.dashboard.detail.files.loading}>
            <Skeleton className="h-10 w-full" />
            <Skeleton className="h-10 w-full" />
          </div>
        )}

        {files.isError && (
          <p className="text-state-error mt-4 text-[0.875rem]">{t.dashboard.detail.files.error}</p>
        )}

        {files.data &&
          (files.data.files.length === 0 ? (
            <p className="text-muted-foreground mt-4 text-[0.875rem]">
              {t.dashboard.detail.files.empty}
            </p>
          ) : (
            <FileManifest files={files.data.files} className="mt-4" />
          ))}
      </section>

      <p className="text-muted-foreground mt-8 text-xs">
        {t.dashboard.card.created(format.date(data.created_at))}
      </p>
    </Container>
  )
}

function BackLink() {
  const { t } = useI18n()

  return (
    <Link
      to="/dashboard"
      className="border-border bg-card text-foreground hover:bg-muted focus-visible:ring-ring/60 inline-flex items-center gap-1.5 rounded-sm border px-2.5 py-1.5 text-[0.8125rem] font-medium transition-colors focus-visible:ring-2 focus-visible:outline-none"
    >
      <ArrowLeftIcon aria-hidden="true" className="size-3.5" />
      {t.dashboard.detail.back}
    </Link>
  )
}

/**
 * Что происходит с контейнером прямо сейчас.
 *
 * Блок несёт корешок, как карточка кабинета: полоса того же цвета, что и у архива
 * в списке, — человек приходит сюда из списка и должен увидеть то же самое, только
 * подробнее. Цвет читает технический статус: здесь речь о файле, не о витрине.
 */
function BuildState({ archive, className }: { archive: CreatorArchive; className?: string }) {
  const { t } = useI18n()
  const build = t.dashboard.detail.build
  const status = archive.technical_status

  const said = {
    draft: build.draft,
    uploading: build.uploading,
    processing: build.processing,
    ready: build.ready,
    failed: build.failed,
  }[status]

  return (
    <div
      className={cn(
        'bg-card border-border relative overflow-hidden rounded-lg border py-5 pr-5 pl-6 sm:pl-7',
        className,
      )}
      // Пока идёт сборка, экран обновляется сам: об этом должны узнать и те,
      // кто читает страницу программой чтения с экрана.
      aria-live="polite"
    >
      <span
        aria-hidden="true"
        className={cn('absolute inset-y-0 left-0 w-[3px]', TONE_SPINE[TECHNICAL_TONE[status]])}
      />

      <h3 className="font-sans text-base font-semibold tracking-[-0.01em]">{said.title}</h3>
      <p className="text-muted-foreground mt-2 max-w-[62ch] text-sm">{said.body}</p>

      {/* Причину сбоя формулирует backend: он один знает, что именно не собралось. */}
      {archive.failure_reason && (
        <p className="text-state-error mt-3 max-w-[62ch] text-[0.875rem]">
          {archive.failure_reason}
        </p>
      )}

      {status === 'ready' && (
        <div className="mt-5 flex flex-wrap items-center gap-x-5 gap-y-2">
          {/* Скачивание — обычная ссылка, а не fetch: так срабатывает
              Content-Disposition и файл уходит на диск с правильным именем. */}
          <a
            href={ownerDownloadUrl(archive.archive_id)}
            download={`${archive.slug ?? archive.archive_id}.slr`}
            className={buttonVariants({ variant: 'outline' })}
          >
            {t.dashboard.detail.build.download}
          </a>
        </div>
      )}
    </div>
  )
}
