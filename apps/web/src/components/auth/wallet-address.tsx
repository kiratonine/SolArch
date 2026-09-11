import { cn } from '@/lib/utils'

/**
 * Адрес кошелька: моноширинный, сокращённый серединой.
 *
 * Полный адрес в 44 знака нигде не помещается в строку интерфейса, а начало и хвост
 * — то, по чему человек сверяет адрес глазами. Целиком он остаётся в `title`
 * и доступен для копирования.
 *
 * Набран золотом — `--seal-ink`, тем же токеном, что и цена: кошелёк — это то,
 * куда приходят деньги (F136). Цвет задан здесь, а не у вызывающих, чтобы адрес
 * выглядел одинаково в шапке, меню, кабинете и при подписи; переопределять его
 * снаружи не нужно — `cn` оставит последний класс, и золото пропадёт.
 */
export function WalletAddress({
  address,
  full = false,
  className,
}: {
  address: string
  /** Целиком — там, где адрес сверяют перед действием, а не узнают мельком. */
  full?: boolean
  className?: string
}) {
  const short = address.length > 12 ? `${address.slice(0, 4)}…${address.slice(-4)}` : address

  return (
    <span className={cn('text-seal-ink font-mono text-[0.8125rem] tracking-tight', className)} title={address}>
      {full ? address : short}
    </span>
  )
}
