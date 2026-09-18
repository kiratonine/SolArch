import { cn } from '@/lib/utils'

export interface MetricItem {
  /** Уже отформатированное значение: компонент ничего не считает и не форматирует. */
  value: string
  label: string
}

/**
 * Манифест: числа над подписями, разделённые воздухом, а не точками-разделителями.
 *
 * В разметке подпись идёт первой (`dt` перед `dd` — требование HTML), а визуально
 * поднимается наверх через `flex-col-reverse`: скринридер читает «файлы — четыре»,
 * глаз читает число.
 *
 * Значения набраны табличными цифрами, чтобы колонки не дрожали при обновлении данных.
 */
export function MetricGrid({ items, className }: { items: MetricItem[]; className?: string }) {
  return (
    <dl className={cn('flex flex-wrap gap-x-8 gap-y-3', className)}>
      {items.map((item) => (
        <div key={item.label} className="flex min-w-0 flex-col-reverse">
          <dt className="text-muted-foreground mt-0.5 text-xs">{item.label}</dt>
          <dd className="numeric text-foreground text-[0.9375rem] leading-tight font-medium">
            {item.value}
          </dd>
        </div>
      ))}
    </dl>
  )
}
