import { useQuery } from '@tanstack/react-query'

import { ArchiveCard } from '@/components/archive/archive-card'
import { sessionQuery, type CreatorArchive, type MarketplaceArchiveListItem } from '@/lib/api'
import { useI18n } from '@/lib/i18n'
import { cn } from '@/lib/utils'

/**
 * Как каталог покажет архив.
 *
 * Роль §6.2 требует, чтобы автор увидел публичное представление архива до
 * публикации. Показываем не пересказ, а ту же карточку, что стоит в каталоге:
 * пустое короткое описание, нулевой манифест и слишком длинное название видно
 * ровно так, как их увидит посетитель.
 *
 * Ничего не досочиняем. Пока архив не опубликован, backend не отдаёт ни одного
 * публичного поля, поэтому карточка собирается из данных владельца — а имя автора
 * берётся из сессии, потому что в архиве владельца его нет.
 */
export function CatalogPreview({
  archive,
  className,
}: {
  archive: CreatorArchive
  className?: string
}) {
  const { t } = useI18n()
  const { data: session } = useQuery(sessionQuery())

  const preview: MarketplaceArchiveListItem = {
    archive_id: archive.archive_id,
    // Slug выдаёт backend при публикации; до неё его нет, и ссылки на карточке тоже.
    slug: archive.slug ?? '',
    title: archive.title,
    short_description: archive.short_description,
    cover_url: archive.cover_url,
    creator: { display_name: session?.display_name ?? session?.wallet ?? '' },
    price: archive.price,
    file_count: archive.file_count,
    size_bytes: archive.size_bytes,
    metrics: archive.metrics,
  }

  return (
    <div className={cn(className)}>
      <h3 className="font-sans text-base font-semibold tracking-[-0.01em]">
        {t.dashboard.detail.listing.preview.title}
      </h3>
      <p className="text-muted-foreground mt-2 max-w-[62ch] text-sm">
        {t.dashboard.detail.listing.preview.body}
      </p>

      <ArchiveCard archive={preview} preview className="mt-4" />
    </div>
  )
}
