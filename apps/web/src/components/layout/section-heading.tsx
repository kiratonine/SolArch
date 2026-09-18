import { cn } from '@/lib/utils'

/**
 * Заголовок раздела внутри страницы.
 *
 * Unbounded закреплён за `h1` и логотипом, поэтому разделы набираются интерфейсным
 * шрифтом. Базовый слой стилей назначает `font-display` всем h1–h3, и снимать его
 * приходится явно — иначе каждая новая страница получала бы широкий заголовок там,
 * где нужен обычный.
 */
export function SectionHeading({
  children,
  className,
}: {
  children: string
  className?: string
}) {
  return (
    <h2
      className={cn(
        'font-sans text-[1.0625rem] leading-snug font-semibold tracking-[-0.01em]',
        className,
      )}
    >
      {children}
    </h2>
  )
}
