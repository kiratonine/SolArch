import { Link } from '@tanstack/react-router'
import { DownloadIcon } from 'lucide-react'
import { useId, useState } from 'react'

import { buttonVariants } from '@/components/ui/button'
import { useI18n } from '@/lib/i18n'
import { cn } from '@/lib/utils'
import { VIEWER_DOWNLOAD_URL, VIEWER_INSTALLER_NAME } from '@/lib/viewer-download'

/**
 * Кнопка установщика в шапке — с любой страницы.
 *
 * Пока релиза нет, она ведёт не в никуда, а к разделу скачивания на лендинге:
 * там большая кнопка и объяснение, почему установщика ещё нет. Когда адрес
 * появится, кнопка начнёт отдавать `.exe` напрямую, без захода на лендинг.
 *
 * Ниже `sm` от кнопки остаётся значок: рядом стоят переключатели языка, темы
 * и кнопка меню, и подпись не помещается на 375px. Имя для скринридера —
 * полное действие, а не одно слово.
 */
export function HeaderDownloadButton({ className }: { className?: string }) {
  const { t } = useI18n()
  const classes = cn(
    buttonVariants({ variant: 'outline', size: 'sm' }),
    'max-sm:size-7 max-sm:px-0',
    className,
  )
  const content = (
    <>
      <DownloadIcon aria-hidden="true" />
      <span className="max-sm:sr-only">{t.download.short}</span>
    </>
  )

  if (VIEWER_DOWNLOAD_URL) {
    return (
      <a href={VIEWER_DOWNLOAD_URL} download className={classes} aria-label={t.download.action}>
        {content}
      </a>
    )
  }

  return (
    <Link to="/" hash="download" className={classes} aria-label={t.download.action}>
      {content}
    </Link>
  )
}

/**
 * Большая кнопка установщика на лендинге.
 *
 * Сделана как сам знак SolArch: чернильный лист с латунным углом печати.
 * Латунь здесь законна — она лежит на чернилах, а не на бумаге (`--seal`
 * по бумаге даёт 1.8:1). На наведении угол печати растёт: кнопка отвечает
 * на руку, а не двигается сама.
 *
 * Под подписью — имя файла моноширинным: это машинная строка, и человек видит
 * ровно то, что окажется в загрузках.
 *
 * Заглушка: пока адреса нет, кнопка — `button`, и нажатие показывает строку
 * о том, что установщик ещё не выложен. Строка объявляется скринридеру.
 */
export function ViewerDownloadButton({ className }: { className?: string }) {
  const { t } = useI18n()
  const [notice, setNotice] = useState(false)
  const noticeId = useId()

  const classes =
    'group/download bg-primary text-primary-foreground focus-visible:ring-ring/60 relative inline-flex items-center gap-4 overflow-hidden rounded-lg py-4 pr-14 pl-5 text-left transition-colors hover:bg-primary/90 focus-visible:ring-3 focus-visible:outline-none active:translate-y-px'

  const content = (
    <>
      <DownloadIcon aria-hidden="true" className="size-5 shrink-0" />
      <span className="flex flex-col">
        <span className="text-[1rem] leading-tight font-semibold">{t.download.action}</span>
        <span className="text-primary-foreground/70 mt-1 font-mono text-[0.75rem] leading-tight">
          {VIEWER_INSTALLER_NAME}
        </span>
      </span>
      {/* Угол печати — тот же жест, что в `SealMark`: прямоугольный треугольник
          в правом верхнем углу, 45°. */}
      <span
        aria-hidden="true"
        className="bg-seal absolute top-0 right-0 size-9 transition-[width,height] duration-200 ease-out [clip-path:polygon(0_0,100%_0,100%_100%)] group-hover/download:size-11 motion-reduce:transition-none"
      />
    </>
  )

  return (
    <div className={cn('flex flex-col items-start gap-2', className)}>
      {VIEWER_DOWNLOAD_URL ? (
        <a href={VIEWER_DOWNLOAD_URL} download className={classes}>
          {content}
        </a>
      ) : (
        <button
          type="button"
          className={classes}
          aria-describedby={notice ? noticeId : undefined}
          onClick={() => setNotice(true)}
        >
          {content}
        </button>
      )}

      <p id={noticeId} role="status" className="text-foreground max-w-[44ch] text-[0.8125rem]">
        {notice ? t.download.pending : null}
      </p>
    </div>
  )
}
