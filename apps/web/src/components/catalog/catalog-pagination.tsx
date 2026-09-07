import { Link } from '@tanstack/react-router'

import { catalogLinkSearch } from '@/lib/catalog-search'
import { useI18n } from '@/lib/i18n'
import { cn } from '@/lib/utils'

/**
 * Постраничность каталога.
 *
 * Страница живёт в адресе, поэтому переходы — ссылки: работает средняя кнопка мыши,
 * работает «назад», работает пересылка. Недоступное направление рисуется текстом,
 * а не отключённой ссылкой: отключённая ссылка выпадает из обхода с клавиатуры молча.
 */
export function CatalogPagination({
  page,
  pages,
  className,
}: {
  page: number
  pages: number
  className?: string
}) {
  const { t } = useI18n()

  if (pages <= 1) return null

  const linkClass =
    'text-foreground hover:text-seal-ink focus-visible:ring-ring/60 rounded-sm text-[0.8125rem] font-medium underline underline-offset-4 transition-colors focus-visible:ring-2 focus-visible:outline-none'
  const mutedClass = 'text-muted-foreground/60 text-[0.8125rem] font-medium'

  return (
    <nav
      aria-label={t.catalog.pagination.label}
      className={cn(
        'border-border mt-8 flex items-center justify-between gap-4 border-t pt-4',
        className,
      )}
    >
      {page > 1 ? (
        <Link
          to="/"
          search={(prev) => catalogLinkSearch({ ...prev, page: page - 1 })}
          className={linkClass}
        >
          {t.catalog.pagination.previous}
        </Link>
      ) : (
        <span className={mutedClass}>{t.catalog.pagination.previous}</span>
      )}

      <p className="numeric text-muted-foreground text-[0.8125rem]">
        {t.catalog.pagination.position(page, pages)}
      </p>

      {page < pages ? (
        <Link
          to="/"
          search={(prev) => catalogLinkSearch({ ...prev, page: page + 1 })}
          className={linkClass}
        >
          {t.catalog.pagination.next}
        </Link>
      ) : (
        <span className={mutedClass}>{t.catalog.pagination.next}</span>
      )}
    </nav>
  )
}
