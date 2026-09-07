import { cn } from '@/lib/utils'

export interface PageHeaderProps {
  title: string
  lead?: string
  className?: string
}

/**
 * Заголовок страницы.
 *
 * Unbounded очень широкий, поэтому кегль растёт по вьюпорту, а трекинг уходит
 * в минус: иначе на мобильном заголовок ломается, а на десктопе рыхлеет.
 */
export function PageHeader({ title, lead, className }: PageHeaderProps) {
  return (
    <div className={cn('mb-10', className)}>
      <h1 className="font-display text-[clamp(1.75rem,1.1rem+2.6vw,2.5rem)] leading-[1.08] font-bold tracking-[-0.04em]">
        {title}
      </h1>
      {lead && <p className="text-muted-foreground mt-4 max-w-[62ch] text-[0.9375rem]">{lead}</p>}
    </div>
  )
}
