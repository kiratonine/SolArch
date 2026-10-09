import { cn } from '@/lib/utils'

/**
 * Логотип-надпись.
 *
 * «Sol» набран янтарём — тем же токеном, что и цена: акцент связывает имя продукта
 * с тем, ради чего он существует. Название не переводится и потому живёт не в словаре,
 * а здесь: одно место на шапку и подвал, чтобы написание не разошлось.
 */
export function Wordmark({ className }: { className?: string }) {
  return (
    <span className={cn('font-display leading-none font-bold tracking-[-0.04em]', className)}>
      <span className="text-seal-ink">Sol</span>Arch
    </span>
  )
}
