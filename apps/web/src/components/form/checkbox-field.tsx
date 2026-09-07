import { cn } from '@/lib/utils'

/**
 * Условие лицензии: флажок, подпись и одно предложение о том, что он меняет.
 *
 * Флажок здесь нативный, а не переключатель на примитиве: это форма-документ,
 * где условия отмечают, а не панель настроек, где тумблеры щёлкают. Нативный
 * `input` вдобавок связывается с подписью средствами браузера — клик по тексту
 * работает без единой строки кода, и никакой `aria-labelledby` не нужен.
 */
export function CheckboxField({
  id,
  label,
  body,
  checked,
  onChange,
  className,
}: {
  id: string
  label: string
  body: string
  checked: boolean
  onChange: (checked: boolean) => void
  className?: string
}) {
  return (
    <div className={cn('flex gap-3', className)}>
      <input
        type="checkbox"
        id={id}
        checked={checked}
        onChange={(event) => onChange(event.currentTarget.checked)}
        className="accent-primary focus-visible:ring-ring/50 mt-0.5 size-4 shrink-0 outline-none focus-visible:ring-3"
      />
      <div className="space-y-1">
        <label htmlFor={id} className="text-[0.9375rem] leading-none font-medium select-none">
          {label}
        </label>
        <p className="text-muted-foreground max-w-[62ch] text-[0.8125rem]">{body}</p>
      </div>
    </div>
  )
}
