import type { ArchiveAnalytics } from '@/lib/api'
import { useI18n } from '@/lib/i18n'
import { cn } from '@/lib/utils'

/**
 * Путь от просмотра до открытия: три числа и два перехода между ними.
 *
 * Столбиков и графиков здесь нет намеренно. Во-первых, длину столбика пришлось бы
 * считать — а конверсии считает backend, и фронт не имеет права выводить своё
 * четвёртое число из его трёх (`docs/roles/02_MARKETPLACE_FRONTEND.md` §4).
 * Во-вторых, у темы нет ни одной тени и ни одной заливки ради украшения: глубина
 * набрана волосяными линиями, и переход между шагами — такая же линия.
 *
 * Обе доли приходят готовыми: `view_to_download` и `download_to_purchase` стоят
 * ровно там, где соединяют свои шаги.
 */
export function AnalyticsFunnel({
  data,
  className,
}: {
  data: ArchiveAnalytics
  className?: string
}) {
  const { t, format } = useI18n()
  const funnel = t.analytics.funnel

  const steps = [
    { count: data.views, label: t.units.views(data.views) },
    {
      count: data.downloads,
      label: t.units.downloads(data.downloads),
      from: { ratio: data.conversions.view_to_download, caption: funnel.toDownload },
    },
    {
      count: data.paid_unlocks,
      label: t.units.unlocks(data.paid_unlocks),
      from: { ratio: data.conversions.download_to_purchase, caption: funnel.toPurchase },
    },
  ]

  return (
    <ol className={cn('bg-card border-border rounded-lg border px-6 py-5', className)}>
      {steps.map((step) => (
        <li key={step.label}>
          {step.from && (
            <div className="flex items-center gap-3 py-3">
              {/* Волосяная линия ведёт от шага к шагу; доля стоит на ней. */}
              <span aria-hidden="true" className="bg-border h-7 w-px shrink-0" />
              <p className="text-[0.8125rem]">
                <span className="numeric text-foreground font-medium">
                  {format.percent(step.from.ratio)}
                </span>{' '}
                <span className="text-muted-foreground">{step.from.caption}</span>
              </p>
            </div>
          )}

          <p className="numeric text-[1.75rem] leading-none font-semibold tracking-[-0.02em]">
            {format.count(step.count)}
          </p>
          <p className="text-muted-foreground mt-1.5 text-xs">{step.label}</p>
        </li>
      ))}
    </ol>
  )
}
