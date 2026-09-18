import { Button } from '@/components/ui/button'
import { useI18n } from '@/lib/i18n'
import { cn } from '@/lib/utils'

/**
 * Ошибка называет, что именно не получилось, и даёт следующий шаг.
 * Извиняться и рассуждать о причинах здесь нечему: `message` приходит из
 * `toUserMessage()` и уже сформулирован для человека.
 */
export function ErrorState({
  title,
  message,
  onRetry,
  className,
}: {
  title: string
  message: string
  onRetry?: () => void
  className?: string
}) {
  const { t } = useI18n()

  return (
    <div
      role="alert"
      className={cn(
        'border-destructive/25 bg-destructive/5 rounded-lg border px-6 py-6',
        className,
      )}
    >
      <h2 className="text-destructive font-sans text-base font-semibold tracking-[-0.01em]">
        {title}
      </h2>
      <p className="text-muted-foreground mt-2 max-w-[52ch] text-sm">{message}</p>
      {onRetry && (
        <Button variant="outline" size="sm" className="mt-5" onClick={onRetry}>
          {t.common.retry}
        </Button>
      )}
    </div>
  )
}
