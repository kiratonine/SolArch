import { Link } from '@tanstack/react-router'

import { MARKETPLACE_SORTS, type MarketplaceSort } from '@/lib/api'
import { catalogLinkSearch } from '@/lib/catalog-search'
import { useI18n } from '@/lib/i18n'
import { cn } from '@/lib/utils'

/**
 * Сортировки — ссылки, а не выпадающий список.
 *
 * Каждый порядок выдачи получает собственный адрес: его можно переслать, положить
 * в закладки и открыть в новой вкладке. Выпадающий список этого не даёт, а выигрывает
 * только в ширине — которой при пяти коротких подписях хватает.
 *
 * Активная сортировка помечена `aria-current`, а не одним лишь цветом.
 */
export function SortNav({ active, className }: { active: MarketplaceSort; className?: string }) {
  const { t } = useI18n()

  return (
    <nav aria-label={t.catalog.sort.label} className={cn('flex flex-wrap gap-1', className)}>
      {MARKETPLACE_SORTS.map((sort) => {
        const current = sort === active

        return (
          <Link
            key={sort}
            to="/"
            // Смена порядка сбрасывает страницу: вторая страница прошлой выдачи
            // к новой не относится.
            search={(prev) => catalogLinkSearch({ ...prev, sort, page: 1 })}
            // Список остаётся на месте: управление им прямо над ним, и прыжок
            // страницы после нажатия читается как перезагрузка.
            resetScroll={false}
            // Роутер считает ссылку активной по точному совпадению адреса, а мы —
            // по одной лишь сортировке. На второй странице совпадения нет,
            // а подсветка нужна, поэтому `aria-current` ставим сами; когда роутер
            // тоже считает ссылку активной, он проставляет ровно то же значение.
            activeOptions={{ exact: true }}
            aria-current={current ? 'page' : undefined}
            className={cn(
              'focus-visible:ring-ring/60 rounded-sm border px-2.5 py-1 text-[0.8125rem] transition-colors focus-visible:ring-2 focus-visible:outline-none',
              current
                ? 'border-border bg-card text-foreground font-medium'
                : 'text-muted-foreground hover:text-foreground border-transparent',
            )}
          >
            {t.catalog.sort[sort]}
          </Link>
        )
      })}
    </nav>
  )
}
