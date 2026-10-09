import { Link } from '@tanstack/react-router'

import { MetricGrid } from '@/components/archive/metric-grid'
import { PriceTag } from '@/components/archive/price-tag'
import { TILE_FRAME, TILE_HOVER, TileCover } from '@/components/archive/tile'
import type { MarketplaceArchiveListItem } from '@/lib/api'
import { useI18n } from '@/lib/i18n'
import { cn } from '@/lib/utils'

export interface ArchiveCardProps {
  archive: MarketplaceArchiveListItem
  /**
   * Карточка без ссылки — предпросмотр в кабинете автора. У неопубликованного
   * архива нет ни slug, ни публичной страницы, и вести отсюда некуда. Предпросмотр
   * рисует та же карточка, что и каталог: копия разошлась бы с оригиналом на
   * первой же правке и перестала бы отвечать на вопрос «как это увидят».
   */
  preview?: boolean
  className?: string
}

/**
 * Карточка архива — главный носитель дизайн-языка. Плитка витрины: обложка,
 * название и автор, манифест, цена.
 *
 * Манифест — сколько файлов, сколько весит, сколько раз открыли: всё, что
 * посетитель может узнать о запечатанном контейнере, не открывая его.
 *
 * Карточка тянется на высоту ряда (`h-full`), а цена прижата к низу: в сетке
 * цены соседних плиток стоят на одной линии, как бы ни переносились названия.
 *
 * Ссылка обёрнута только вокруг заголовка, а кликабельна вся карточка: псевдоэлемент
 * растянут по ней (`after:inset-0`). Так у ссылки остаётся короткое имя — название
 * архива, — а не пересказ всей карточки, как было бы при обёртывании целиком.
 *
 * При наведении плитка чуть приподнимается, и под ней появляется короткая тень
 * снизу. Цветного корешка у плитки нет: в сетке он читался как посторонняя полоса.
 */
export function ArchiveCard({
  archive,
  preview = false,
  className,
}: ArchiveCardProps) {
  const { t, format } = useI18n()

  return (
    <article
      className={cn(
        TILE_FRAME,
        'group has-[a:focus-visible]:ring-ring/60 has-[a:focus-visible]:ring-2',
        // У предпросмотра нет ссылки, и откликаться на наведение ему нечем.
        !preview && TILE_HOVER,
        className,
      )}
    >
      <TileCover url={archive.cover_url} />

      <div className="flex flex-1 flex-col p-4">
        <h3 className="line-clamp-2 font-sans text-[1.0625rem] leading-snug font-semibold tracking-[-0.01em]">
          {preview ? (
            archive.title
          ) : (
            <Link
              to="/archives/$slug"
              params={{ slug: archive.slug }}
              className="after:absolute after:inset-0 group-hover:underline group-hover:underline-offset-4 focus-visible:outline-none"
            >
              {archive.title}
            </Link>
          )}
        </h3>
        <p className="text-muted-foreground mt-1 truncate text-[0.8125rem]">
          {t.archive.by} {archive.creator.display_name}
        </p>

        <p className="text-muted-foreground mt-3 mb-4 line-clamp-2 text-sm">
          {archive.short_description}
        </p>

        <MetricGrid
          className="border-border mt-auto gap-x-6 border-t pt-3"
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

        <PriceTag price={archive.price} className="mt-3" />
      </div>
    </article>
  )
}

