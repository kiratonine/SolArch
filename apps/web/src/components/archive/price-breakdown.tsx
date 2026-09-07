import type { Money } from '@/lib/api'
import { useI18n } from '@/lib/i18n'
import { cn } from '@/lib/utils'

export interface PriceBreakdownProps {
  price: Money
  /** Доля автора, decimal string. */
  creator: string
  /** Доля платформы, decimal string. */
  platform: string
  platformFeeBps: number
  /** Показывать предупреждение о неизменности цены — нужно на форме создания. */
  showImmutableNotice?: boolean
  className?: string
}

/**
 * Разбивка цены 95 / 5.
 *
 * Суммы компонент только выводит. До создания архива их считает `lib/money.ts`
 * на bigint, после создания источник истины — объект `economics` из ответа backend
 * (`docs/INTEGRATION.md` §10). Складывать и делить здесь нечего.
 */
export function PriceBreakdown({
  price,
  creator,
  platform,
  platformFeeBps,
  showImmutableNotice = false,
  className,
}: PriceBreakdownProps) {
  const { t, format } = useI18n()

  const rows = [
    { label: t.economics.buyerPays, amount: price.amount, emphasis: 'ink' as const },
    { label: t.economics.creator, amount: creator, emphasis: 'seal' as const },
    {
      label: t.economics.platform,
      note: format.percent(platformFeeBps / 10_000),
      amount: platform,
      emphasis: 'muted' as const,
    },
  ]

  return (
    <section className={cn('bg-card border-border rounded-lg border p-5', className)}>
      <h3 className="font-sans text-sm font-semibold tracking-[-0.01em]">{t.economics.title}</h3>

      <dl className="mt-4 space-y-0">
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
              <span className="text-muted-foreground text-xs">{price.currency}</span>
            </dd>
          </div>
        ))}
      </dl>

      <p className="text-muted-foreground border-border mt-4 border-t pt-4 text-[0.8125rem]">
        {t.economics.networkFees}
      </p>
      {showImmutableNotice && (
        <p className="text-foreground mt-2 text-[0.8125rem]">{t.economics.immutable}</p>
      )}
    </section>
  )
}
