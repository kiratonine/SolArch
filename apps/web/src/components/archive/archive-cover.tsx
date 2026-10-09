import { useState } from 'react'

import { SealMark } from '@/components/brand/seal-mark'
import { cn } from '@/lib/utils'

/**
 * Обложка архива.
 *
 * Рамка кадра задана жёстко, а картинка вписана `object-cover`: пропорции обложек
 * контракт не оговаривает (открытый вопрос Q3), и без фиксированного кадра страница
 * дёргалась бы при загрузке — каждая обложка двигала бы весь текст под собой.
 *
 * Обложка ничего не сообщает сверх заголовка, который стоит прямо над ней, поэтому
 * `alt` пустой: диктовать имя файла или пересказывать название — шум в скринридере.
 * Битая ссылка показывает ту же нейтральную заглушку, что карточки каталога.
 */
export function ArchiveCover({ url, className }: { url: string; className?: string }) {
  const [brokenUrl, setBrokenUrl] = useState<string | null>(null)
  const broken = brokenUrl === url

  return (
    <div className={cn('border-border bg-muted overflow-hidden rounded-lg border', className)}>
      {broken ? (
        <div
          aria-hidden="true"
          className="text-foreground/85 grid aspect-[1200/630] w-full place-items-center"
          data-testid="cover-fallback"
        >
          <SealMark className="size-12" />
        </div>
      ) : (
        <img
          src={url}
          alt=""
          className="aspect-[1200/630] w-full object-cover"
          onError={() => setBrokenUrl(url)}
        />
      )}
    </div>
  )
}
