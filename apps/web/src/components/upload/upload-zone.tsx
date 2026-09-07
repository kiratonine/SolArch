import { useRef, useState } from 'react'

import { Button } from '@/components/ui/button'
import { useI18n } from '@/lib/i18n'
import { ACCEPT_ATTRIBUTE, type RejectedFile } from '@/lib/upload-files'
import { cn } from '@/lib/utils'

/**
 * Выбор файлов для архива.
 *
 * Пунктирная рамка — та же, что у пустого состояния: место под содержимое есть,
 * содержимого пока нет. Кнопка настоящая, а не подпись поверх невидимого поля:
 * `input` спрятан, но клавиатура и программы чтения с экрана работают с кнопкой,
 * которая его открывает.
 *
 * Перетаскивание — дополнение, а не единственный путь: мышью удобно, но без мыши
 * страница обязана работать целиком.
 */
export function UploadZone({
  onFiles,
  rejected,
  disabled = false,
  className,
}: {
  onFiles: (files: File[]) => void
  rejected: RejectedFile[]
  disabled?: boolean
  className?: string
}) {
  const { t } = useI18n()
  const input = useRef<HTMLInputElement>(null)
  const [over, setOver] = useState(false)

  function take(list: FileList | null) {
    if (!list || list.length === 0) return
    onFiles([...list])
  }

  return (
    <div className={className}>
      <div
        onDragOver={(event) => {
          if (disabled) return
          event.preventDefault()
          setOver(true)
        }}
        onDragLeave={() => setOver(false)}
        onDrop={(event) => {
          if (disabled) return
          event.preventDefault()
          setOver(false)
          take(event.dataTransfer.files)
        }}
        className={cn(
          'rounded-lg border border-dashed px-6 py-8 transition-colors',
          // Янтарь принадлежит деньгам и только им, поэтому рамка под курсором
          // берёт цвет «идёт работа» — тот же, что у полосы прогресса ниже.
          over ? 'border-state-progress bg-state-progress/5' : 'border-border',
          disabled && 'opacity-60',
        )}
      >
        <h3 className="font-sans text-base font-semibold tracking-[-0.01em]">
          {over ? t.dashboard.upload.dropping : t.dashboard.upload.title}
        </h3>
        <p className="text-muted-foreground mt-2 max-w-[58ch] text-sm">
          {t.dashboard.upload.body}
        </p>

        <div className="mt-5 flex flex-wrap items-center gap-x-3 gap-y-2">
          <Button size="lg" disabled={disabled} onClick={() => input.current?.click()}>
            {t.dashboard.upload.choose}
          </Button>
          <span className="text-muted-foreground text-[0.8125rem]">
            {t.dashboard.upload.drop}
          </span>
        </div>

        {/* Форматы — машинный перечень, поэтому набран тем же моноширинным,
            что пути и адреса кошельков. */}
        <p className="text-muted-foreground mt-4 font-mono text-xs">
          {t.dashboard.upload.formats}
        </p>

        <input
          ref={input}
          type="file"
          multiple
          accept={ACCEPT_ATTRIBUTE}
          className="sr-only"
          tabIndex={-1}
          aria-hidden="true"
          onChange={(event) => {
            take(event.currentTarget.files)
            // Тот же файл, выбранный второй раз подряд, не даёт события change,
            // пока поле помнит прежнее значение.
            event.currentTarget.value = ''
          }}
        />
      </div>

      {/* Отклонённое не пропадает молча: каждый файл назван по имени и с причиной. */}
      {rejected.length > 0 && (
        <div className="mt-4" role="alert">
          <p className="text-state-error text-[0.8125rem] font-medium">
            {t.dashboard.upload.refused.title}
          </p>
          <ul className="mt-1.5 space-y-1">
            {rejected.map((file) => (
              <li key={file.name} className="text-muted-foreground text-[0.8125rem]">
                <span className="text-foreground font-mono text-[0.8125rem]">{file.name}</span>
                {' — '}
                {t.dashboard.upload.refused[file.problem]}
              </li>
            ))}
          </ul>
        </div>
      )}
    </div>
  )
}
