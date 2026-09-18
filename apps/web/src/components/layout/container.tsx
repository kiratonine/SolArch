import type { ReactNode } from 'react'

import { cn } from '@/lib/utils'

/**
 * Единственная мера ширины: шапка, содержимое и подвал делят обе кромки.
 *
 * 54rem — ширина читаемого документа, а каталог и есть документ: список
 * запечатанных контейнеров. Более широкая мера появится, когда её действительно
 * потребует экран кабинета автора (S6), а не «на будущее».
 */
export function Container({ children, className }: { children: ReactNode; className?: string }) {
  return <div className={cn('mx-auto w-full max-w-216 px-5 sm:px-8', className)}>{children}</div>
}
