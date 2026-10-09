import { Link } from '@tanstack/react-router'

import { MetricGrid } from '@/components/archive/metric-grid'
import { PriceTag } from '@/components/archive/price-tag'
import { StatusBadge } from '@/components/archive/status-badge'
import { TILE_FRAME, TILE_HOVER, TileCover } from '@/components/archive/tile'
import type { CreatorArchive } from '@/lib/api'
import { useI18n } from '@/lib/i18n'
import { cn } from '@/lib/utils'

/**
 * Плитка архива в кабинете автора.
 *
 * Каркас тот же, что у каталожной, а содержимое другое: не витрина, а хозяйство —
 * оба статуса порознь, доля автора рядом с ценой и причина, по которой сборка
 * не удалась. Статус несут бейджи; цветного корешка у плитки нет.
 *
 * Кликабельна вся плитка: псевдоэлемент ссылки-заголовка растянут по ней, как
 * в каталоге. Вторая ссылка — на публичную страницу — поднята над ним
 * (`relative z-10`), поэтому остаётся отдельной целью, а не вложенной ссылкой.
 *
 * Манифест одинаков у всех плиток, даже когда весь он в нулях: «0 просмотров»
 * у черновика — такой же факт, как любой другой.
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
        TILE_FRAME,
        TILE_HOVER,
        'group has-[a:focus-visible]:ring-ring/60 has-[a:focus-visible]:ring-2',
        className,
      )}
    >
      <TileCover url={archive.cover_url} />

      <div className="flex flex-1 flex-col p-4">
        {/* Отступ снизу держит манифест на расстоянии от текста, а `mt-auto`
            манифеста прижимает его к низу плитки. */}
        <div className="mb-4">
          <h3 className="line-clamp-2 font-sans text-[1.0625rem] leading-snug font-semibold tracking-[-0.01em]">
            <Link
              to="/dashboard/$archiveId"
              params={{ archiveId: archive.archive_id }}
              className="after:absolute after:inset-0 group-hover:underline group-hover:underline-offset-4 focus-visible:outline-none"
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

          {archive.short_description && (
            <p className="text-muted-foreground mt-3 line-clamp-2 text-sm">
              {archive.short_description}
            </p>
          )}

          {/* Причину сбоя формулирует backend: он один знает, что именно не собралось. */}
          {archive.failure_reason && (
            <p className="text-state-error mt-3 text-[0.8125rem]">{archive.failure_reason}</p>
          )}
        </div>

        <MetricGrid
          // Пять чисел в ряд плитка не держит: сетка в три колонки ставит их
          // двумя ровными строками, а не хвостом из одного числа.
          className="border-border mt-auto grid grid-cols-3 gap-x-4 border-t pt-3"
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

        <div className="mt-3 flex flex-wrap items-baseline justify-between gap-x-4 gap-y-1">
          <PriceTag price={archive.price} />
          {/* Доля автора — второе место, где теме разрешён янтарь. Число приходит
              из `economics` backend и здесь ничего не пересчитывается. */}
          <p className="text-muted-foreground text-xs whitespace-nowrap">
            {t.dashboard.card.payout}{' '}
            <span className="numeric text-seal-ink font-medium">
              {archive.economics.creator_share}
            </span>
          </p>
        </div>

        <div className="text-muted-foreground mt-3 flex flex-wrap items-baseline justify-between gap-x-4 gap-y-1 text-xs">
          <span>{t.dashboard.card.created(format.date(archive.created_at))}</span>

          {published && archive.slug && (
            <Link
              to="/archives/$slug"
              params={{ slug: archive.slug }}
              className="text-foreground focus-visible:ring-ring/60 relative z-10 rounded-sm font-medium underline underline-offset-4 focus-visible:ring-2 focus-visible:outline-none"
            >
              {t.dashboard.card.publicPage}
            </Link>
          )}
        </div>
      </div>
    </article>
  )
}
