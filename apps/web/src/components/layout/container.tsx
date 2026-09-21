import type { ReactNode } from 'react'

import { cn } from '@/lib/utils'

/** Внешняя рамка: одна на весь сайт, чтобы шапка, подвал и содержимое делили кромку. */
const FRAME = 'mx-auto w-full max-w-480 px-5 sm:px-8 xl:px-12'

/**
 * Мера ширины.
 *
 * Рамка — 120rem: на обычных мониторах, вплоть до 1920px, полей по бокам нет,
 * только внутренний отступ. Потолок нужен ультрашироким экранам, где плитки
 * каталога без него раздулись бы. Каталог — витрина плиток, ему нужна вся рамка
 * (`wide`). Остальные страницы — документы и формы: их колонка остаётся 54rem
 * и прижата к той же левой кромке, а не центрируется отдельно, иначе кромки
 * шапки и текста разъехались бы.
 *
 * `centered` ставит ту же колонку посередине рамки — для страниц-решений
 * (вход, создание архива), у которых нет соседей по ширине.
 */
export function Container({
  children,
  className,
  wide = false,
  centered = false,
}: {
  children: ReactNode
  className?: string
  wide?: boolean
  centered?: boolean
}) {
  if (wide) {
    return <div className={cn(FRAME, className)}>{children}</div>
  }

  return (
    <div className={FRAME}>
      <div className={cn('max-w-216', centered && 'mx-auto', className)}>{children}</div>
    </div>
  )
}
