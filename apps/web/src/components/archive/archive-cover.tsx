import { useState } from 'react'

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
 * Битая ссылка убирает блок целиком, а не оставляет иконку сломанной картинки.
 */
export function ArchiveCover({ url, className }: { url: string; className?: string }) {
  const [broken, setBroken] = useState(false)

  if (broken) return null

  return (
    <div className={cn('border-border bg-muted overflow-hidden rounded-lg border', className)}>
      <img
        src={url}
        alt=""
        className="aspect-[1200/630] w-full object-cover"
        onError={() => setBroken(true)}
      />
    </div>
  )
}
