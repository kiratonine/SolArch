import { Link } from '@tanstack/react-router'
import { useEffect, useState } from 'react'

import { Button } from '@/components/ui/button'
import { useI18n } from '@/lib/i18n'
import { publicArchiveUrl } from '@/lib/public-url'
import { cn } from '@/lib/utils'

/**
 * Публичная ссылка на опубликованный архив.
 *
 * Адрес показан целиком и моноширинным: это машинная строка, её сверяют по знакам
 * и отдают другим людям, а не читают. Он же — единственное, что автор уносит
 * с этой страницы наружу, поэтому рядом стоят оба способа им воспользоваться:
 * скопировать и открыть.
 *
 * Кнопка копирования появляется только там, где буфер обмена доступен: по
 * незащищённому соединению `navigator.clipboard` не существует вовсе, и кнопка
 * молча ничего не делала бы. Адрес остаётся выделяемым текстом в любом случае.
 */
export function PublicLink({ slug, className }: { slug: string; className?: string }) {
  const { t } = useI18n()
  const [copied, setCopied] = useState(false)

  const url = publicArchiveUrl(slug, window.location.origin)
  const clipboard = typeof navigator !== 'undefined' ? navigator.clipboard : undefined

  // Подтверждение гаснет само: копирование не оставляет следа на экране,
  // и без возврата к обычной надписи кнопка застыла бы на «Скопировано».
  useEffect(() => {
    if (!copied) return
    const timer = setTimeout(() => setCopied(false), 2000)
    return () => clearTimeout(timer)
  }, [copied])

  async function copy() {
    if (!clipboard) return
    try {
      await clipboard.writeText(url)
      setCopied(true)
    } catch {
      // Браузер вправе отказать в доступе к буферу обмена. Отказ ничего не ломает:
      // адрес рядом остаётся обычным выделяемым текстом, и это запасной путь.
    }
  }

  return (
    <div className={cn('border-border bg-background rounded-sm border p-3', className)}>
      <p className="text-muted-foreground text-xs">{t.dashboard.detail.listing.link.label}</p>
      <p className="text-foreground mt-1.5 font-mono text-[0.8125rem] break-all">{url}</p>

      <div className="mt-3 flex flex-wrap items-center gap-2">
        {clipboard && (
          <Button
            variant="outline"
            size="sm"
            onClick={() => void copy()}
            // Смену надписи объявляем: нажатие ничего больше на экране не двигает.
            aria-live="polite"
          >
            {copied ? t.dashboard.detail.listing.link.copied : t.dashboard.detail.listing.link.copy}
          </Button>
        )}

        <Link
          to="/archives/$slug"
          params={{ slug }}
          className="text-foreground focus-visible:ring-ring/60 rounded-sm text-[0.8125rem] font-medium underline underline-offset-4 focus-visible:ring-2 focus-visible:outline-none"
        >
          {t.dashboard.card.publicPage}
        </Link>
      </div>
    </div>
  )
}
