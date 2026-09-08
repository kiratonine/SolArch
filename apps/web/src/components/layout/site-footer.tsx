import { Link } from '@tanstack/react-router'

import { Logo } from '@/components/brand/logo'
import { Container } from '@/components/layout/container'
import { ProductNav } from '@/components/layout/product-nav'
import { useI18n } from '@/lib/i18n'

/**
 * Подвал: имя продукта, карта сайта и год.
 *
 * Прозы здесь по-прежнему нет и не будет (F55) — объяснения механики уехали
 * на `/how-it-works` целиком. Вернулась не проза, а ссылка на неё: подвал —
 * единственное место, где продуктовые страницы видны на любой ширине. В шапке
 * они появляются только с md, и без этого списка на телефоне до них было бы
 * не добраться вовсе.
 */
export function SiteFooter() {
  const { t } = useI18n()

  return (
    <footer className="border-border mt-20 border-t">
      <Container className="flex flex-wrap items-center gap-x-8 gap-y-4 py-7">
        <Logo markClassName="size-4" wordClassName="text-[0.8125rem]" />

        {/* Вторая навигация на странице обязана быть названа: без имени
            скринридер объявит два одинаковых ландмарка «навигация». */}
        <nav aria-label={t.nav.pages} className="flex flex-wrap items-center gap-x-5 gap-y-2">
          <Link to="/" className={footerLink}>
            {t.nav.catalog}
          </Link>
          <ProductNav linkClassName={footerLink} />
        </nav>

        <span className="text-muted-foreground ml-auto font-mono text-xs">
          {t.footer.rights(new Date().getFullYear())}
        </span>
      </Container>
    </footer>
  )
}

/**
 * Ссылки подвала приглушены, в отличие от шапки: подвал — карта, а не путь,
 * которым идут прямо сейчас. Текущая страница здесь не отмечается по той же
 * причине — карта показывает, что есть, а не где ты.
 */
const footerLink =
  'text-muted-foreground hover:text-foreground focus-visible:ring-ring/60 rounded-sm text-[0.8125rem] whitespace-nowrap transition-colors focus-visible:ring-2 focus-visible:outline-none'
