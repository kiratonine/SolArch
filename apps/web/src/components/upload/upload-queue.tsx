import { Button } from '@/components/ui/button'
import { useI18n } from '@/lib/i18n'
import type { UploadItem } from '@/lib/use-archive-upload'
import { cn } from '@/lib/utils'

/**
 * Очередь передачи: строка на файл.
 *
 * Полоса та же по толщине, что корешок карточки, — три пикселя цвета «идёт работа».
 * Ни теней, ни объёма: заполненная часть отличается от пустой цветом, и только.
 */
function ProgressBar({ ratio, label }: { ratio: number; label: string }) {
  const percent = Math.round(Math.min(Math.max(ratio, 0), 1) * 100)

  return (
    <div
      role="progressbar"
      aria-label={label}
      aria-valuemin={0}
      aria-valuemax={100}
      aria-valuenow={percent}
      className="bg-border mt-2 h-0.75 w-full overflow-hidden"
    >
      <div
        className="bg-state-progress h-full transition-[width] duration-150"
        style={{ width: `${percent}%` }}
      />
    </div>
  )
}

export function UploadQueue({
  items,
  onCancel,
  onRetry,
  className,
}: {
  items: UploadItem[]
  onCancel: (id: string) => void
  onRetry: (id: string) => void
  className?: string
}) {
  const { t, format } = useI18n()
  if (items.length === 0) return null

  return (
    <section className={className} aria-label={t.dashboard.upload.queue}>
      <ul className="border-border divide-border divide-y rounded-lg border">
        {items.map((item) => {
          const running = item.status === 'uploading'
          const label = t.dashboard.upload.progress(item.name)
          // Пока файл идёт, состояние называет процент; в покое — слово.
          const state =
            item.status === 'uploading'
              ? format.percent(item.ratio)
              : t.dashboard.upload.status[item.status]

          return (
            <li key={item.id} className="px-4 py-3">
              <div className="flex items-baseline justify-between gap-4">
                <span className="min-w-0 truncate font-mono text-[0.8125rem]">{item.name}</span>

                <span className="flex shrink-0 items-baseline gap-3">
                  {/* Процент вытесняет слово статуса, пока файл идёт: и то и другое
                      отвечает на один вопрос, а два ответа рядом только спорят. */}
                  <span
                    className={cn(
                      'text-xs',
                      item.status === 'failed' ? 'text-state-error' : 'text-muted-foreground',
                      running && 'numeric',
                    )}
                  >
                    {state}
                  </span>
                  <span className="numeric text-muted-foreground text-xs">
                    {format.bytes(item.sizeBytes)}
                  </span>

                  {(running || item.status === 'queued') && (
                    <Button size="sm" variant="ghost" onClick={() => onCancel(item.id)}>
                      {t.dashboard.upload.cancel}
                    </Button>
                  )}

                  {/* Повторить предлагаем только упавшему: отменённый файл автор
                      убрал сам, и возвращать его без спроса не за что. */}
                  {item.status === 'failed' && (
                    <Button size="sm" variant="outline" onClick={() => onRetry(item.id)}>
                      {t.dashboard.upload.retry}
                    </Button>
                  )}
                </span>
              </div>

              {running && <ProgressBar ratio={item.ratio} label={label} />}

              {/* Формулировка приходит от backend: он один знает, что отказало. */}
              {item.error && (
                <p className="text-state-error mt-2 max-w-[62ch] text-[0.8125rem]">{item.error}</p>
              )}
            </li>
          )
        })}
      </ul>
    </section>
  )
}
