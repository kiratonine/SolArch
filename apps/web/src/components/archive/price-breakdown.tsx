import { MoneySplit, type MoneyRow } from '@/components/archive/money-split'
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

  const rows: MoneyRow[] = [
    { label: t.economics.buyerPays, amount: price.amount, emphasis: 'ink' },
    { label: t.economics.creator, amount: creator, emphasis: 'seal' },
    {
      label: t.economics.platform,
      note: format.percent(platformFeeBps / 10_000),
      amount: platform,
      emphasis: 'muted',
    },
  ]

  return (
    <section className={cn('bg-card border-border rounded-lg border p-5', className)}>
      <h3 className="font-sans text-sm font-semibold tracking-[-0.01em]">{t.economics.title}</h3>

      <MoneySplit rows={rows} currency={price.currency} className="mt-4" />

      <p className="text-muted-foreground border-border mt-4 border-t pt-4 text-[0.8125rem]">
        {t.economics.networkFees}
      </p>
      {showImmutableNotice && (
        <p className="text-foreground mt-2 text-[0.8125rem]">{t.economics.immutable}</p>
      )}
    </section>
  )
}
