import type { ReactNode } from 'react'

import { Label } from '@/components/ui/label'
import { cn } from '@/lib/utils'

/**
 * Поле формы: подпись, пояснение, счётчик длины и ошибка вокруг одного органа ввода.
 *
 * Связь подписи с полем и пояснения с полем делается здесь один раз, а не в каждой
 * форме по-своему: экранный диктор обязан прочитать и то, зачем поле, и то, чем
 * оно не устроило.
 *
 * Орган ввода приходит функцией, потому что он у каждого поля свой (строка, текст,
 * переключатель), а идентификаторы для `aria-*` знает только поле.
 */

export interface FieldControlProps {
  id: string
  'aria-describedby': string | undefined
  'aria-invalid': true | undefined
}

export interface FieldProps {
  id: string
  label: string
  hint?: string
  /** Готовая строка вида «118 / 120». Показывается только у длинных значений. */
  counter?: string
  error?: string
  children: (control: FieldControlProps) => ReactNode
  className?: string
}

export function Field({ id, label, hint, counter, error, children, className }: FieldProps) {
  const hintId = hint ? `${id}-hint` : undefined
  const errorId = error ? `${id}-error` : undefined
  const describedBy = [hintId, errorId].filter(Boolean).join(' ') || undefined

  return (
    <div className={cn('space-y-2', className)}>
      <div className="flex items-baseline justify-between gap-4">
        <Label htmlFor={id} className="text-[0.9375rem]">
          {label}
        </Label>
        {counter && <span className="numeric text-muted-foreground text-xs">{counter}</span>}
      </div>

      {hint && (
        <p id={hintId} className="text-muted-foreground max-w-[62ch] text-[0.8125rem]">
          {hint}
        </p>
      )}

      {children({
        id,
        'aria-describedby': describedBy,
        'aria-invalid': error ? true : undefined,
      })}

      {error && (
        <p id={errorId} role="alert" className="text-state-error text-[0.8125rem]">
          {error}
        </p>
      )}
    </div>
  )
}
