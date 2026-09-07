import type { Money } from '@/lib/api'
import { cn } from '@/lib/utils'

/**
 * Цена — единственное место, где появляется янтарь.
 *
 * Сумма выводится ровно той строкой, что пришла с backend: любое переформатирование
 * означало бы разбор в число, а float для денег запрещён (`docs/PAYMENTS.md` §5).
 * Поэтому же разделитель остаётся точкой в обеих локалях — это записанное значение,
 * а не локализуемое число.
 */
export function PriceTag({
  price,
  size = 'default',
  className,
}: {
  price: Money
  size?: 'default' | 'lg'
  className?: string
}) {
  return (
    <p className={cn('flex items-baseline gap-1.5 whitespace-nowrap', className)}>
      <span
        className={cn(
          'numeric text-seal-ink font-semibold',
          size === 'lg' ? 'text-2xl tracking-[-0.02em]' : 'text-[1.0625rem]',
        )}
      >
        {price.amount}
      </span>
      <span
        className={cn('text-muted-foreground font-medium', size === 'lg' ? 'text-sm' : 'text-xs')}
      >
        {price.currency}
      </span>
    </p>
  )
}
