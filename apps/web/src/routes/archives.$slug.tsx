import { useQuery } from '@tanstack/react-query'
import { Link, createFileRoute } from '@tanstack/react-router'
import { ArrowLeftIcon } from 'lucide-react'

import { ArchiveCover } from '@/components/archive/archive-cover'
import { FileManifest } from '@/components/archive/file-manifest'
import { LicenseTerms } from '@/components/archive/license-terms'
import { MetricGrid } from '@/components/archive/metric-grid'
import { PriceTag } from '@/components/archive/price-tag'
import { Container } from '@/components/layout/container'
import { SectionHeading } from '@/components/layout/section-heading'
import { EmptyState } from '@/components/state/empty-state'
import { ErrorState } from '@/components/state/error-state'
import { Skeleton } from '@/components/ui/skeleton'
import { buttonVariants } from '@/components/ui/button'
import {
  isApiError,
  marketplaceArchiveFilesQuery,
  marketplaceArchiveQuery,
  marketplaceDownloadUrl,
  toUserMessage,
} from '@/lib/api'
import { useI18n } from '@/lib/i18n'
import { cn } from '@/lib/utils'

export const Route = createFileRoute('/archives/$slug')({
  /**
   * Прогрев кеша, а не загрузка страницы.
   *
   * Роутер и раньше преподгружал по наведению (`defaultPreload: 'intent'`), но только
   * код страницы: запрос стартовал после нажатия, и человек смотрел на скелет.
   * Здесь наведение на карточку каталога прогревает и данные.
   *
   * Промисы намеренно не возвращаются: `ensureQueryData` бросил бы 404 снятого
   * с публикации архива в обработчик ошибок роутера, и вместо аккуратного «архив
   * недоступен» человек увидел бы аварийный экран. `prefetchQuery` не бросает,
   * а компонент, который умеет отличить снятый архив от сбоя, разбирает ответ сам.
   *
   * Наведение, однако, ещё не просмотр. Backend засчитывает `view` на каждый запрос
   * карточки (ответ на Q10), и прогрев по наведению накручивал бы автору просмотры
   * мышью. Поэтому по наведению греется только опись — её чтение ничего не считает,
   * — а карточка уходит, когда страницу действительно открыли.
   */
  loader: ({ context, params, preload }) => {
    if (!preload) void context.queryClient.prefetchQuery(marketplaceArchiveQuery(params.slug))
    void context.queryClient.prefetchQuery(marketplaceArchiveFilesQuery(params.slug))
  },
  component: ArchivePage,
})

/**
 * Публичная страница архива.
 *
 * Гость приходит сюда с одним вопросом: стоит ли забирать файл. Страница отвечает
 * ровно на него — описание, опись содержимого, условия открытия, цена — и даёт
 * единственное действие: скачать `.slr`. Оплаты в браузере нет и быть не может,
 * она живёт в Viewer (`docs/SPEC.md` §7), поэтому странице остаётся сказать словами,
 * где и когда с человека возьмут деньги.
 *
 * Скачивание — обычная ссылка, а не `fetch`: так срабатывает `Content-Disposition`
 * и backend успевает засчитать событие download.
 */
function ArchivePage() {
  const { slug } = Route.useParams()
  const { t, format } = useI18n()
  const { data, isPending, isError, error, refetch } = useQuery(marketplaceArchiveQuery(slug))

  // Список файлов — отдельный запрос и отдельная судьба: его сбой не должен
  // уносить страницу, на которой уже есть описание, цена и кнопка.
  const files = useQuery({ ...marketplaceArchiveFilesQuery(slug), enabled: data !== undefined })

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
      {/* Возврат — единственный путь со страницы наверх, и он должен читаться
          как орган управления, а не как подпись. Рамка и радиус те же, что
          у чипов сортировки в каталоге: одна и та же вещь выглядит одинаково. */}
      <Link
        to="/"
        className="border-border bg-card text-foreground hover:bg-muted focus-visible:ring-ring/60 inline-flex items-center gap-1.5 rounded-sm border px-2.5 py-1.5 text-[0.8125rem] font-medium transition-colors focus-visible:ring-2 focus-visible:outline-none"
      >
        <ArrowLeftIcon aria-hidden="true" className="size-3.5" />
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

      {data.cover_url && <ArchiveCover url={data.cover_url} className="mt-7" />}

      <p className="mt-6 max-w-[62ch] text-[0.9375rem] whitespace-pre-line">{data.description}</p>

      <MetricGrid
        className="border-border mt-6 border-t pt-6"
        items={[
          { value: format.count(data.file_count), label: t.units.files(data.file_count) },
          { value: format.bytes(data.size_bytes), label: t.metrics.size },
          { value: format.count(data.metrics.views), label: t.metrics.views },
          { value: format.count(data.metrics.downloads), label: t.metrics.downloads },
          { value: format.count(data.metrics.paid_unlocks), label: t.metrics.unlocks },
        ]}
      />

      {/* Кнопка, а вокруг неё две строки: над ней — на каких условиях забирают файл,
          под ней — где и когда возьмут деньги. Стояли они сбоку, и кнопка висела
          у верха четырёх строк текста, перекашивая блок; в столбик читается сверху
          вниз одинаково и на 390px, и на десктопе, где текст ещё и не переносится. */}
      <div className="border-border mt-6 border-t pt-6">
        <p className="text-[0.8125rem] font-medium">{t.archive.free}</p>

        <a
          href={marketplaceDownloadUrl(data.slug)}
          download={`${data.slug}.slr`}
          className={cn(buttonVariants({ size: 'lg' }), 'mt-2')}
        >
          {t.archive.download}
        </a>

        {/* Ни цены, ни сетевых комиссий здесь больше нет. Цена стоит крупно
            вверху страницы, повторять её в подписи незачем; всё остальное про
            механику рассказывает страница, куда ведёт ссылка сразу за фразой. */}
        <p className="text-muted-foreground mt-2.5 max-w-[58ch] text-[0.8125rem]">
          {t.archive.payment}{' '}
          <Link
            to="/how-it-works"
            className="text-seal-ink font-medium underline underline-offset-4"
          >
            {t.nav.howItWorks}
          </Link>
        </p>
      </div>

      <section className="border-border mt-6 border-t pt-6">
        <SectionHeading>{t.archive.files.title}</SectionHeading>

        {files.isPending && (
          <div className="mt-4 space-y-2" aria-busy="true" aria-label={t.archive.files.loading}>
            <Skeleton className="h-10 w-full" />
            <Skeleton className="h-10 w-full" />
            <Skeleton className="h-10 w-full" />
          </div>
        )}

        {files.isError && (
          <p className="text-state-error mt-4 text-[0.875rem]">{t.archive.files.error}</p>
        )}

        {files.data &&
          (files.data.files.length === 0 ? (
            <p className="text-muted-foreground mt-4 text-[0.875rem]">{t.archive.files.empty}</p>
          ) : (
            <FileManifest files={files.data.files} className="mt-4" />
          ))}
      </section>

      <section className="border-border mt-6 border-t pt-6">
        <SectionHeading>{t.archive.terms.title}</SectionHeading>
        <LicenseTerms policy={data.license_policy} />
      </section>
    </Container>
  )
}
