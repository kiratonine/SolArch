import type { ReactNode } from 'react'

import { cn } from '@/lib/utils'

/**
 * Пустой экран — это приглашение к действию, а не сообщение об отсутствии данных.
 *
 * Пунктирная рамка продолжает язык корешка: место под архив есть, архива пока нет.
 */
export function EmptyState({
  title,
  body,
  action,
  className,
}: {
  title: string
  body?: string
  action?: ReactNode
  className?: string
}) {
  return (
    <div className={cn('border-border rounded-lg border border-dashed px-6 py-10', className)}>
      <h2 className="font-sans text-base font-semibold tracking-[-0.01em]">{title}</h2>
      {body && <p className="text-muted-foreground mt-2 max-w-[52ch] text-sm">{body}</p>}
      {action && <div className="mt-5">{action}</div>}
    </div>
  )
}
