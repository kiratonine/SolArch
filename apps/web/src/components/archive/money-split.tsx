import type { Currency } from '@/lib/api'
import { cn } from '@/lib/utils'

export interface MoneyRow {
  label: string
  /** Приписка мелким у подписи — например, процент комиссии. */
  note?: string
  /** Сумма, decimal string, ровно как пришла. */
  amount: string
  emphasis: 'ink' | 'seal' | 'muted'
}

/**
 * Столбик сумм: подпись слева, сумма и валюта справа, между строками — волосяная линия.
 *
 * Один и тот же столбик показывает разбивку цены (S7) и выручку архива (S10):
 * деньги на сайте обязаны выглядеть одинаково везде, иначе янтарь перестаёт быть
 * приметой денег и становится просто ещё одним цветом.
 *
 * Компонент ничего не складывает и не делит — суммы приходят строками с backend
 * (`docs/PAYMENTS.md` §5 запрещает float).
 */
export function MoneySplit({
  rows,
  currency,
  className,
}: {
  rows: MoneyRow[]
  currency: Currency
  className?: string
}) {
  return (
    <dl className={cn('space-y-0', className)}>
      {rows.map((row, index) => (
        <div
          key={row.label}
          className={cn(
            'flex items-baseline justify-between gap-6 py-2.5',
            index > 0 && 'border-border border-t',
          )}
        >
          <dt className="text-muted-foreground flex items-baseline gap-2 text-sm">
            {row.label}
            {row.note && <span className="numeric text-xs">{row.note}</span>}
          </dt>
          <dd className="flex items-baseline gap-1.5 whitespace-nowrap">
            <span
              className={cn(
                'numeric text-[0.9375rem] font-semibold',
                row.emphasis === 'seal' && 'text-seal-ink',
                row.emphasis === 'ink' && 'text-foreground',
                row.emphasis === 'muted' && 'text-muted-foreground',
              )}
            >
              {row.amount}
            </span>
            <span className="text-muted-foreground text-xs">{currency}</span>
          </dd>
        </div>
      ))}
    </dl>
  )
}
