import { SectionHeading } from '@/components/layout/section-heading'
import { Button } from '@/components/ui/button'
import { useI18n } from '@/lib/i18n'

/** Кошельки, у которых есть поддержка Solana Wallet Standard и заметная доля рынка. */
const KNOWN_WALLETS = [
  { name: 'Phantom', href: 'https://phantom.com' },
  { name: 'Solflare', href: 'https://solflare.com' },
]

/**
 * Пустой экран — это указание, что делать дальше, а не сообщение о беде.
 *
 * Расширение, установленное при открытой вкладке, в реестр текущей страницы уже
 * не попадёт, поэтому нужна перезагрузка: кнопка честно делает именно её.
 */
export function NoWallets() {
  const { t } = useI18n()

  return (
    <div className="border-border bg-card rounded-lg border p-5">
      <SectionHeading>{t.auth.noWallets.title}</SectionHeading>
      <p className="text-muted-foreground mt-2 text-[0.8125rem] leading-relaxed">
        {t.auth.noWallets.body}
      </p>

      <div className="mt-4 flex flex-wrap items-center gap-2">
        {KNOWN_WALLETS.map((wallet) => (
          <a
            key={wallet.name}
            href={wallet.href}
            target="_blank"
            rel="noreferrer noopener"
            className="border-border hover:bg-muted focus-visible:ring-ring/60 rounded-sm border px-2.5 py-1 text-[0.8125rem] font-medium transition-colors focus-visible:ring-2 focus-visible:outline-none"
          >
            {wallet.name}
          </a>
        ))}
        <Button variant="ghost" size="sm" onClick={() => window.location.reload()}>
          {t.auth.noWallets.reload}
        </Button>
      </div>
    </div>
  )
}
