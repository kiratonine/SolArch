import { SealMark } from '@/components/brand/seal-mark'
import { Wordmark } from '@/components/brand/wordmark'
import { cn } from '@/lib/utils'

/**
 * Локап: знак плюс надпись.
 *
 * Шапка и подвал берут логотип отсюда, а не собирают его каждая по-своему —
 * иначе отступ и выравнивание в двух местах рано или поздно разойдутся.
 *
 * Знак приподнят на 6% собственной высоты. `items-center` равняет боксы, а глаз
 * равняет прописные буквы, которые стоят выше центра строчного бокса примерно
 * на 0.1em: без поправки знак заметно проседает под надпись. Поправка задана
 * долей, а не пикселями, поэтому одинаково работает и на 18px в шапке,
 * и на 16px в подвале.
 */
export function Logo({
  className,
  markClassName,
  wordClassName,
}: {
  className?: string
  markClassName?: string
  wordClassName?: string
}) {
  return (
    <span className={cn('flex items-center gap-2', className)}>
      <SealMark className={cn('-translate-y-[6%]', markClassName)} />
      <Wordmark className={wordClassName} />
    </span>
  )
}
