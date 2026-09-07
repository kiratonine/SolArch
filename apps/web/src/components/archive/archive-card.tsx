import { MetricGrid } from '@/components/archive/metric-grid'
import { PriceTag } from '@/components/archive/price-tag'
import { TONE_SPINE, type SpineTone } from '@/components/archive/tone'
import type { MarketplaceArchiveListItem } from '@/lib/api'
import { useI18n } from '@/lib/i18n'
import { cn } from '@/lib/utils'

export interface ArchiveCardProps {
  archive: MarketplaceArchiveListItem
  /** Цвет корешка. В каталоге всё опубликовано, в кабинете автора статусы разные. */
  spine?: SpineTone
  className?: string
}

/**
 * Карточка архива — главный носитель дизайн-языка.
 *
 * Слева корешок: полоса чернил, которая цветом несёт статус, а не украшает.
 * Внизу манифест: сколько файлов, сколько весит, сколько раз открыли. Всё, что
 * посетитель может узнать о запечатанном контейнере, не открывая его.
 *
 * Компонент презентационный. Ссылку на `/archives/$slug` добавит S3, когда
 * появится сам роут страницы архива, — вместе с состоянием наведения.
 */
export function ArchiveCard({ archive, spine = 'sealed', className }: ArchiveCardProps) {
  const { t, format } = useI18n()

  return (
    <article
      className={cn(
        'bg-card border-border relative overflow-hidden rounded-lg border',
        className,
      )}
    >
      <span
        aria-hidden="true"
        className={cn('absolute inset-y-0 left-0 w-[3px]', TONE_SPINE[spine])}
      />

      <div className="py-5 pr-5 pl-6 sm:pl-7">
        <div className="flex items-start justify-between gap-6">
          <div className="min-w-0">
            <h3 className="font-sans text-[1.0625rem] leading-snug font-semibold tracking-[-0.01em]">
              {archive.title}
            </h3>
            <p className="text-muted-foreground mt-1 truncate text-[0.8125rem]">
              {t.archive.by} {archive.creator.display_name}
            </p>
          </div>
          <PriceTag price={archive.price} />
        </div>

        <p className="text-muted-foreground mt-3 line-clamp-2 max-w-[62ch] text-sm">
          {archive.short_description}
        </p>

        <MetricGrid
          className="border-border mt-5 border-t pt-4"
          items={[
            {
              value: format.count(archive.file_count),
              label: t.units.files(archive.file_count),
            },
            {
              value: format.bytes(archive.size_bytes),
              label: t.metrics.size,
            },
            {
              value: format.count(archive.metrics.paid_unlocks),
              label: t.units.unlocks(archive.metrics.paid_unlocks),
            },
          ]}
        />
      </div>
    </article>
  )
}
