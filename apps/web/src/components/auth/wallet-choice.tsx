import { SectionHeading } from '@/components/layout/section-heading'
import type { AvailableWallet } from '@/lib/wallet'
import { useI18n } from '@/lib/i18n'

/**
 * Выбор кошелька.
 *
 * Иконку и имя даёт сам кошелёк через реестр Wallet Standard: своих логотипов
 * мы не рисуем и имён расширений не зашиваем.
 */
export function WalletChoice({
  wallets,
  onChoose,
  busyWallet,
}: {
  wallets: AvailableWallet[]
  onChoose: (wallet: AvailableWallet) => void
  busyWallet?: string
}) {
  const { t } = useI18n()

  return (
    <div>
      <SectionHeading>{t.auth.choose}</SectionHeading>

      <ul className="border-border bg-card divide-border mt-3 divide-y rounded-lg border">
        {wallets.map((wallet) => {
          const busy = busyWallet === wallet.id

          return (
            <li key={wallet.id}>
              <button
                type="button"
                onClick={() => onChoose(wallet)}
                disabled={busyWallet !== undefined}
                className="focus-visible:ring-ring/60 hover:bg-muted/60 flex w-full items-center gap-3 px-4 py-3.5 text-left transition-colors first:rounded-t-lg last:rounded-b-lg focus-visible:ring-2 focus-visible:outline-none disabled:cursor-default disabled:opacity-60"
              >
                <img src={wallet.icon} alt="" className="size-6 rounded-sm" />
                <span className="text-[0.9375rem] font-medium">{wallet.name}</span>
                {busy && (
                  <span className="text-state-progress ml-auto text-[0.8125rem]">
                    {t.auth.connecting(wallet.name)}
                  </span>
                )}
              </button>
            </li>
          )
        })}
      </ul>
    </div>
  )
}
