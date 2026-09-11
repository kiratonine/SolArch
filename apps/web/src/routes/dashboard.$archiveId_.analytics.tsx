import { keepPreviousData, useQuery } from '@tanstack/react-query'
import { Link, createFileRoute } from '@tanstack/react-router'
import { ArrowLeftIcon } from 'lucide-react'

import { AnalyticsFunnel } from '@/components/analytics/funnel'
import { PeriodNav } from '@/components/analytics/period-nav'
import { RevenuePanel } from '@/components/analytics/revenue-panel'
import { Container } from '@/components/layout/container'
import { SectionHeading } from '@/components/layout/section-heading'
import { EmptyState } from '@/components/state/empty-state'
import { ErrorState } from '@/components/state/error-state'
import { Skeleton } from '@/components/ui/skeleton'
import {
  archiveAnalyticsQuery,
  isApiError,
  myArchiveQuery,
  toUserMessage,
  type ArchiveAnalytics,
} from '@/lib/api'
import { resolvePeriod, validateAnalyticsSearch } from '@/lib/analytics-period'
import { useI18n } from '@/lib/i18n'
import { cn } from '@/lib/utils'

export const Route = createFileRoute('/dashboard/$archiveId_/analytics')({
  validateSearch: validateAnalyticsSearch,
  loaderDeps: ({ search }) => ({ period: resolvePeriod(search) }),
  /**
   * Оба запроса греются до перехода: сюда приходят со страницы архива, и они
   * успевают уйти, пока роутер меняет страницу. `prefetchQuery` не бросает —
   * 404 на чужой архив разбирает компонент, а не аварийный экран роутера (F35).
   */
  loader: ({ context, params, deps }) => {
    void context.queryClient.prefetchQuery(myArchiveQuery(params.archiveId))
    void context.queryClient.prefetchQuery(archiveAnalyticsQuery(params.archiveId, deps.period))
  },
  component: AnalyticsPage,
})

/**
 * Аналитика архива.
 *
 * Ни одного числа фронт не считает: просмотры, скачивания, открытия, обе конверсии
 * и вся выручка приходят посчитанными (`docs/roles/02_MARKETPLACE_FRONTEND.md` §4, §8).
 * Страница решает только, что из этого показать и в каком порядке — сначала путь
 * от просмотра до открытия, потом деньги, которые из этого пути вышли.
 *
 * Период — параметр адреса, а не состояние компонента: «покажи, что было за неделю»
 * должно пересылаться ссылкой.
 */
function AnalyticsPage() {
  const { archiveId } = Route.useParams()
  const { t } = useI18n()
  const period = resolvePeriod(Route.useSearch())

  // Архив и его аналитика — два запроса и две судьбы. Название и комиссия нужны,
  // чтобы страница называла себя даже тогда, когда цифры не пришли.
  const archive = useQuery(myArchiveQuery(archiveId))

  const analytics = useQuery({
    ...archiveAnalyticsQuery(archiveId, period),
    // При смене периода цифры не должны схлопываться в скелет: прошлые остаются
    // на экране и приглушаются, пока идёт запрос.
    placeholderData: keepPreviousData,
  })

  if (archive.isError) {
    // Чужой архив для автора не существует. Backend отвечает на него 403, а не 404,
    // но для автора это одно и то же: архива, который он может открыть, нет.
    const missing =
      isApiError(archive.error) && (archive.error.isNotFound || archive.error.isForbidden)

    return (
      <Container>
        <BackLink archiveId={archiveId} />
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
            message={toUserMessage(archive.error)}
            onRetry={() => void archive.refetch()}
          />
        )}
      </Container>
    )
  }

  return (
    <Container>
      <BackLink archiveId={archiveId} />

      <div className="mt-6">
        <h1 className="font-display text-[clamp(1.5rem,1.1rem+1.8vw,2.125rem)] leading-[1.1] font-bold tracking-[-0.04em]">
          {t.analytics.title}
        </h1>
        {archive.data ? (
          <p className="text-muted-foreground mt-2 text-[0.9375rem]">{archive.data.title}</p>
        ) : (
          <Skeleton className="mt-2 h-5 w-56" />
        )}
        <p className="text-muted-foreground mt-4 max-w-[62ch] text-[0.9375rem]">
          {t.analytics.lead}
        </p>
      </div>

      <PeriodNav archiveId={archiveId} active={period} className="mt-8" />

      {/* Пока идёт запрос за другим периодом, прошлые цифры остаются на месте
          приглушёнными: замена их скелетом сбрасывала бы высоту страницы. */}
      <div
        className={cn(
          'mt-6 transition-opacity',
          analytics.isPlaceholderData && 'opacity-55',
        )}
        aria-busy={analytics.isFetching || undefined}
      >
        {analytics.isPending && <LoadingSkeleton />}

        {analytics.isError && (
          <ErrorState
            title={t.analytics.error.title}
            message={toUserMessage(analytics.error)}
            onRetry={() => void analytics.refetch()}
          />
        )}

        {analytics.data && (
          <Report data={analytics.data} platformFeeBps={archive.data?.economics.platform_fee_bps} />
        )}
      </div>
    </Container>
  )
}

/**
 * Отчёт за период.
 *
 * Пустой период — это не сбой и не ноль в каждой строке, а отсутствие событий:
 * три нуля подряд и «0 %» дважды не сообщают ничего, кроме того, что смотреть
 * пока не на что. Поэтому вместо них — одна фраза.
 */
function Report({
  data,
  platformFeeBps,
}: {
  data: ArchiveAnalytics
  platformFeeBps: number | undefined
}) {
  const { t } = useI18n()

  if (data.views === 0 && data.downloads === 0 && data.paid_unlocks === 0) {
    return <EmptyState title={t.analytics.empty.title} body={t.analytics.empty.body} />
  }

  return (
    <>
      <section>
        <SectionHeading>{t.analytics.funnel.title}</SectionHeading>
        <AnalyticsFunnel data={data} className="mt-4" />
      </section>

      {/* Комиссию в процентах называет архив, а не аналитика: в её ответе есть
          суммы, но не ставка. Пока архив не пришёл, строка стоит без приписки. */}
      <section className="mt-10">
        <SectionHeading>{t.analytics.revenue.title}</SectionHeading>
        <RevenuePanel
          revenue={data.revenue}
          platformFeeBps={platformFeeBps ?? 0}
          className="mt-4"
        />
      </section>
    </>
  )
}

function LoadingSkeleton() {
  const { t } = useI18n()

  return (
    <div className="space-y-10" aria-busy="true" aria-label={t.analytics.loading}>
      <Skeleton className="h-56 w-full" />
      <Skeleton className="h-44 w-full" />
    </div>
  )
}

function BackLink({ archiveId }: { archiveId: string }) {
  const { t } = useI18n()

  return (
    <Link
      to="/dashboard/$archiveId"
      params={{ archiveId }}
      className="border-border bg-card text-foreground hover:bg-muted focus-visible:ring-ring/60 inline-flex items-center gap-1.5 rounded-sm border px-2.5 py-1.5 text-[0.8125rem] font-medium transition-colors focus-visible:ring-2 focus-visible:outline-none"
    >
      <ArrowLeftIcon aria-hidden="true" className="size-3.5" />
      {t.analytics.back}
    </Link>
  )
}
