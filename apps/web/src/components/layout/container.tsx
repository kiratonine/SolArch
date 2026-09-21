import type { ReactNode } from 'react'

import { cn } from '@/lib/utils'

/** Внешняя рамка: одна на весь сайт, чтобы шапка, подвал и содержимое делили кромку. */
const FRAME = 'mx-auto w-full max-w-480 px-5 sm:px-8 xl:px-12'

/**
 * Мера ширины.
 *
 * Рамка — 120rem: на обычных мониторах, вплоть до 1920px, полей по бокам нет,
 * только внутренний отступ. Потолок нужен ультрашироким экранам, где плитки
 * без него раздулись бы.
 *
 * `wide` — вся рамка: витрины плиток (каталог, кабинет), шапка и подвал.
 * Без него — колонка 54rem посередине рамки: страницы-документы и формы.
 * У левой кромки широкой рамки такая колонка оставляла пустыми две трети
 * экрана справа. Колонку можно сузить через `className` (`max-w-136` у формы
 * создания) — она останется по центру.
 */
export function Container({
  children,
  className,
  wide = false,
}: {
  children: ReactNode
  className?: string
  wide?: boolean
}) {
  if (wide) {
    return <div className={cn(FRAME, className)}>{children}</div>
  }

  return (
    <div className={FRAME}>
      <div className={cn('mx-auto max-w-216', className)}>{children}</div>
    </div>
  )
}
