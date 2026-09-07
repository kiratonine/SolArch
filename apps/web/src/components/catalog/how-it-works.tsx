import { useI18n } from '@/lib/i18n'
import { cn } from '@/lib/utils'

/**
 * Три шага механики на главной.
 *
 * Продукт устроен не так, как ожидает посетитель магазина: файл забирают до оплаты,
 * а платят потом и в другом приложении. Пока это не сказано словами, кнопка
 * «скачать» рядом с ценой читается как ошибка вёрстки.
 *
 * Разделители — щели `gap-px` на цвете границы: те же волосяные линии, что и везде,
 * без единой тени.
 */
export function HowItWorks({ className }: { className?: string }) {
  const { t } = useI18n()

  return (
    <ol
      className={cn(
        'bg-border border-border grid gap-px overflow-hidden rounded-lg border sm:grid-cols-3',
        className,
      )}
    >
      {t.catalog.steps.map((step, index) => (
        <li key={step.title} className="bg-card px-5 py-4">
          <p className="text-muted-foreground font-mono text-[0.6875rem]">
            {String(index + 1).padStart(2, '0')}
          </p>
          <h2 className="mt-1.5 font-sans text-[0.9375rem] font-semibold tracking-[-0.01em]">
            {step.title}
          </h2>
          <p className="text-muted-foreground mt-1 text-[0.8125rem] leading-relaxed">{step.body}</p>
        </li>
      ))}
    </ol>
  )
}
