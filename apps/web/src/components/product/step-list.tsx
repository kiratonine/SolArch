import { cn } from '@/lib/utils'

export interface Step {
  title: string
  body: string
}

/**
 * Нумерованные шаги механики.
 *
 * Форма восстановлена из `components/catalog/how-it-works.tsx`, снятого с главной
 * на S4 (F41). Убирали его не за форму, а за место: три шага на главной повторяли
 * подзаголовок каталога и подвал, а треть блока была адресована автору, а не
 * покупателю. Здесь у обеих половин есть свой раздел, и блок вернулся целиком.
 *
 * Продукт устроен не так, как ожидает посетитель магазина: файл забирают до оплаты,
 * а платят потом и в другом приложении. Пока это не сказано словами, кнопка
 * «скачать» рядом с ценой читается как ошибка вёрстки.
 *
 * Разделители — щели `gap-px` на цвете границы: те же волосяные линии, что и везде,
 * без единой тени.
 */
export function StepList({ steps, className }: { steps: readonly Step[]; className?: string }) {
  return (
    <ol
      className={cn(
        'bg-border border-border grid gap-px overflow-hidden rounded-lg border sm:grid-cols-3',
        className,
      )}
    >
      {steps.map((step, index) => (
        <li key={step.title} className="bg-card px-5 py-4">
          <p className="text-muted-foreground font-mono text-[0.6875rem]">
            {String(index + 1).padStart(2, '0')}
          </p>
          {/* На главной шаг был `h2` — он стоял прямо под `h1`. Здесь над шагами
              есть заголовок раздела, поэтому уровень сдвинут на один вниз. */}
          <h3 className="mt-1.5 font-sans text-[0.9375rem] font-semibold tracking-[-0.01em]">
            {step.title}
          </h3>
          <p className="text-muted-foreground mt-1 text-[0.8125rem] leading-relaxed">{step.body}</p>
        </li>
      ))}
    </ol>
  )
}
