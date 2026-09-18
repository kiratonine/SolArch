import { Link } from '@tanstack/react-router'

import { MetricGrid } from '@/components/archive/metric-grid'
import { PriceTag } from '@/components/archive/price-tag'
import { StatusBadge } from '@/components/archive/status-badge'
import { TONE_SPINE, creatorSpineTone } from '@/components/archive/tone'
import type { CreatorArchive } from '@/lib/api'
import { useI18n } from '@/lib/i18n'
import { cn } from '@/lib/utils'

/**
 * Карточка архива в кабинете автора.
 *
 * От каталожной отличается тем, что показывает не витрину, а хозяйство: оба статуса
 * порознь, долю автора рядом с ценой и причину, по которой сборка не удалась.
 *
 * Ссылкой сделан заголовок, а не вся карточка: внутри есть вторая ссылка — на
 * публичную страницу, — и вложить её во внешнюю нельзя. Заголовок отвечает на тот
 * же вопрос, что и вся карточка: «этот архив», поэтому ведёт в него.
 *
 * Манифест одинаков у всех карточек, даже когда весь он в нулях: одинаковые колонки
 * позволяют сравнивать архивы взглядом вниз по списку, а «0 просмотров» у черновика —
 * такой же факт, как любой другой.
 */
export function CreatorArchiveCard({
  archive,
  className,
}: {
  archive: CreatorArchive
  className?: string
}) {
  const { t, format } = useI18n()
  const published = archive.marketplace_status === 'published' && archive.slug !== null

  return (
    <article
      className={cn(
        'bg-card border-border has-[a:focus-visible]:ring-ring/60 relative overflow-hidden rounded-lg border has-[a:focus-visible]:ring-2',
        className,
      )}
    >
      <span
        aria-hidden="true"
        className={cn('absolute inset-y-0 left-0 w-[3px]', TONE_SPINE[creatorSpineTone(archive)])}
      />

      <div className="py-5 pr-5 pl-6 sm:pl-7">
        <div className="flex items-start justify-between gap-6">
          <div className="min-w-0">
            <h3 className="font-sans text-[1.0625rem] leading-snug font-semibold tracking-[-0.01em]">
              <Link
                to="/dashboard/$archiveId"
                params={{ archiveId: archive.archive_id }}
                className="focus-visible:outline-none hover:underline hover:underline-offset-4"
              >
                {archive.title}
              </Link>
            </h3>

            {/* Два статуса стоят рядом, но не сливаются: технический описывает файл,
                маркетплейсный — витрину, и расходиться они могут в любую сторону. */}
            <div className="mt-2 flex flex-wrap items-center gap-1.5">
              <StatusBadge kind="technical" value={archive.technical_status} />
              <StatusBadge kind="marketplace" value={archive.marketplace_status} />
            </div>
          </div>

          <div className="shrink-0 text-right">
            <PriceTag price={archive.price} className="justify-end" />
            {/* Доля автора — второе место, где теме разрешён янтарь. Число приходит
                из `economics` backend и здесь ничего не пересчитывается. */}
            <p className="text-muted-foreground mt-1 text-xs whitespace-nowrap">
              {t.dashboard.card.payout}{' '}
              <span className="numeric text-seal-ink font-medium">
                {archive.economics.creator_share}
              </span>
            </p>
          </div>
        </div>

        {archive.short_description && (
          <p className="text-muted-foreground mt-3 line-clamp-2 max-w-[62ch] text-sm">
            {archive.short_description}
          </p>
        )}

        {/* Причину сбоя формулирует backend: он один знает, что именно не собралось. */}
        {archive.failure_reason && (
          <p className="text-state-error mt-3 max-w-[62ch] text-[0.8125rem]">
            {archive.failure_reason}
          </p>
        )}

        <MetricGrid
          className="border-border mt-5 border-t pt-4"
          items={[
            { value: format.count(archive.file_count), label: t.units.files(archive.file_count) },
            { value: format.bytes(archive.size_bytes), label: t.metrics.size },
            { value: format.count(archive.metrics.views), label: t.metrics.views },
            { value: format.count(archive.metrics.downloads), label: t.metrics.downloads },
            {
              value: format.count(archive.metrics.paid_unlocks),
              label: t.units.unlocks(archive.metrics.paid_unlocks),
            },
          ]}
        />

        <div className="text-muted-foreground mt-4 flex flex-wrap items-baseline justify-between gap-x-6 gap-y-1 text-xs">
          <span>{t.dashboard.card.created(format.date(archive.created_at))}</span>

          {published && archive.slug && (
            <Link
              to="/archives/$slug"
              params={{ slug: archive.slug }}
              className="text-foreground focus-visible:ring-ring/60 rounded-sm font-medium underline underline-offset-4 focus-visible:ring-2 focus-visible:outline-none"
            >
              {t.dashboard.card.publicPage}
            </Link>
          )}
        </div>
      </div>
    </article>
  )
}
