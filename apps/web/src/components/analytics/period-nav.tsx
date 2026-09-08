import { Link } from '@tanstack/react-router'

import { ANALYTICS_PERIODS, type AnalyticsPeriod } from '@/lib/api'
import { analyticsLinkSearch } from '@/lib/analytics-period'
import { useI18n } from '@/lib/i18n'
import { cn } from '@/lib/utils'

/**
 * Окно наблюдения — ссылки, а не переключатель состояния.
 *
 * Сделано ровно как сортировка каталога: у каждого периода собственный адрес,
 * его можно переслать и открыть в новой вкладке. Активный период помечен
 * `aria-current`, а не одним лишь цветом.
 */
export function PeriodNav({
  archiveId,
  active,
  className,
}: {
  archiveId: string
  active: AnalyticsPeriod
  className?: string
}) {
  const { t } = useI18n()

  return (
    <nav aria-label={t.analytics.period.label} className={cn('flex flex-wrap gap-1', className)}>
      {ANALYTICS_PERIODS.map((period) => {
        const current = period === active

        return (
          <Link
            key={period}
            to="/dashboard/$archiveId/analytics"
            params={{ archiveId }}
            search={analyticsLinkSearch({ period })}
            // Цифры остаются на месте: переключатель прямо над ними, и прыжок
            // страницы после нажатия читается как перезагрузка.
            resetScroll={false}
            // Период по умолчанию не попадает в адрес, поэтому совпадения адресов
            // роутеру мало: активность считаем сами, как в `SortNav`.
            activeOptions={{ exact: true }}
            aria-current={current ? 'page' : undefined}
            className={cn(
              'focus-visible:ring-ring/60 rounded-sm border px-2.5 py-1 text-[0.8125rem] transition-colors focus-visible:ring-2 focus-visible:outline-none',
              current
                ? 'border-border bg-card text-foreground font-medium'
                : 'text-muted-foreground hover:text-foreground border-transparent',
            )}
          >
            {t.analytics.period[period]}
          </Link>
        )
      })}
    </nav>
  )
}
