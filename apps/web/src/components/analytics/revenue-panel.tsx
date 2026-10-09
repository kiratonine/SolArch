import { MoneySplit, type MoneyRow } from '@/components/archive/money-split'
import type { AnalyticsRevenue } from '@/lib/api'
import { useI18n } from '@/lib/i18n'
import { cn } from '@/lib/utils'

/**
 * Что архив принёс за период.
 *
 * Тот же столбик сумм, что и в разбивке цены: три строки, янтарь — только на доле
 * автора. Разница в вопросе, а не в устройстве. Разбивка отвечает «как делится
 * цена», выручка — «сколько уже пришло», и обе суммы приходят с backend строками.
 */
export function RevenuePanel({
  revenue,
  platformFeeBps,
  className,
}: {
  revenue: AnalyticsRevenue
  platformFeeBps: number
  className?: string
}) {
  const { t, format } = useI18n()

  const rows: MoneyRow[] = [
    { label: t.analytics.revenue.gross, amount: revenue.gross, emphasis: 'ink' },
    { label: t.analytics.revenue.creator, amount: revenue.creator, emphasis: 'seal' },
    {
      label: t.analytics.revenue.platform,
      note: format.percent(platformFeeBps / 10_000),
      amount: revenue.platform,
      emphasis: 'muted',
    },
  ]

  return (
    <section className={cn('bg-card border-border rounded-lg border p-5', className)}>
      <MoneySplit rows={rows} currency={revenue.currency} />

      <p className="text-muted-foreground border-border mt-4 border-t pt-4 text-[0.8125rem]">
        {t.analytics.revenue.note}
      </p>
    </section>
  )
}
