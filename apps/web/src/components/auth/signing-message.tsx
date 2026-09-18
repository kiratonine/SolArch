import { Button } from '@/components/ui/button'
import { WalletAddress } from '@/components/auth/wallet-address'
import { SectionHeading } from '@/components/layout/section-heading'
import { useI18n } from '@/lib/i18n'
import type { ConnectedWallet } from '@/lib/wallet'

/**
 * Второй шаг входа: текст, который человек подписывает, показан целиком.
 *
 * Привычка подписывать вслепую — то, на чём работает фишинг кошельков. Поэтому
 * сообщение стоит на экране до того, как расширение его запросит, и набрано моно:
 * это машинная строка, а не проза (`CLAUDE.md`, дизайн-язык).
 */
export function SigningMessage({
  wallet,
  message,
  status,
  busy,
  onSign,
  onBack,
}: {
  wallet: ConnectedWallet
  message: string
  status?: string
  busy: boolean
  onSign: () => void
  onBack: () => void
}) {
  const { t } = useI18n()

  return (
    <div>
      <SectionHeading>{t.auth.message.title}</SectionHeading>
      <p className="text-muted-foreground mt-1.5 text-[0.8125rem] leading-relaxed">
        {t.auth.message.hint}
      </p>

      {/* `wrap-anywhere`, а не прокрутка: адрес кошелька — это 44 знака без пробелов,
          и на узком экране он уезжал за правый край. Плита стоит здесь затем,
          чтобы сообщение читалось целиком, поэтому строка переносится. */}
      <pre className="border-border bg-card mt-3 rounded-lg border p-4 font-mono text-[0.8125rem] leading-6 wrap-anywhere whitespace-pre-wrap">
        {message}
      </pre>

      <div className="text-muted-foreground mt-3 flex items-center gap-2 text-[0.8125rem]">
        <img src={wallet.icon} alt="" className="size-4 rounded-sm" />
        <span>{t.auth.message.wallet}</span>
        <WalletAddress address={wallet.address} />
      </div>

      <div className="mt-5 flex flex-wrap items-center gap-2">
        <Button size="lg" onClick={onSign} disabled={busy}>
          {t.auth.message.sign}
        </Button>
        {/* Рамка, а не «призрак»: без неё возврат к выбору кошелька читается
            подписью рядом с кнопкой, а не вторым действием. */}
        <Button size="lg" variant="outline" onClick={onBack} disabled={busy}>
          {t.auth.message.back}
        </Button>
      </div>

      {status && (
        <p className="text-state-progress mt-3 text-[0.8125rem]" role="status">
          {status}
        </p>
      )}
    </div>
  )
}
