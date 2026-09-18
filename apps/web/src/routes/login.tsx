import { useState } from 'react'

import { useQueryClient } from '@tanstack/react-query'
import { createFileRoute, redirect, useNavigate } from '@tanstack/react-router'
import { z } from 'zod'

import { NoWallets } from '@/components/auth/no-wallets'
import { SigningMessage } from '@/components/auth/signing-message'
import { WalletChoice } from '@/components/auth/wallet-choice'
import { Container } from '@/components/layout/container'
import { PageHeader } from '@/components/layout/page-header'
import {
  isApiError,
  queryKeys,
  requestWalletChallenge,
  sessionQuery,
  verifyWalletSignature,
  type WalletChallengeResponse,
} from '@/lib/api'
import { safeRedirect } from '@/lib/auth/redirect'
import { useI18n } from '@/lib/i18n'
import { isWalletError, useWallets, type AvailableWallet, type ConnectedWallet } from '@/lib/wallet'

export const Route = createFileRoute('/login')({
  // Мусор в параметре гасится в умолчание: адрес входа публичный и приходит битым.
  validateSearch: z.object({ redirect: z.string().optional().catch(undefined) }),
  // Вошедшему автору тут делать нечего: он попадает туда, куда шёл.
  beforeLoad: async ({ context, search }) => {
    const session = await context.queryClient.ensureQueryData(sessionQuery())

    if (session) {
      throw redirect({ to: safeRedirect(search.redirect) as '/dashboard', replace: true })
    }
  },
  component: LoginPage,
})

/**
 * Вход автора по подписи кошелька (`docs/API.md` §2).
 *
 * Два шага, а не один: сначала подключение, потом подпись — и между ними человек
 * читает сообщение целиком. Один клик был бы короче, но приучал бы подписывать
 * вслепую, а это ровно та привычка, на которой работает фишинг.
 *
 * Приватный ключ через приложение не проходит: расширение отдаёт публичный адрес
 * и байты подписи.
 */

type Step =
  | { kind: 'choose' }
  | { kind: 'connecting'; walletId: string }
  | { kind: 'sign'; wallet: ConnectedWallet; challenge: WalletChallengeResponse }
  | { kind: 'signing'; wallet: ConnectedWallet; challenge: WalletChallengeResponse }
  | { kind: 'verifying'; wallet: ConnectedWallet; challenge: WalletChallengeResponse }

function LoginPage() {
  const { t } = useI18n()
  const wallets = useWallets()
  const search = Route.useSearch()
  const navigate = useNavigate()
  const queryClient = useQueryClient()

  const [step, setStep] = useState<Step>({ kind: 'choose' })
  const [error, setError] = useState<string | null>(null)

  /** Шаг 1: подключение и запрос сообщения у backend. */
  async function choose(wallet: AvailableWallet) {
    setError(null)
    setStep({ kind: 'connecting', walletId: wallet.id })

    try {
      const connected = await wallet.connect()
      const challenge = await requestWalletChallenge(connected.address)
      setStep({ kind: 'sign', wallet: connected, challenge })
    } catch (failure) {
      setStep({ kind: 'choose' })
      setError(describe(failure, wallet.name))
    }
  }

  /** Шаг 2: подпись и проверка на backend. */
  async function sign(wallet: ConnectedWallet, challenge: WalletChallengeResponse) {
    setError(null)
    setStep({ kind: 'signing', wallet, challenge })

    try {
      const signature = await wallet.signMessage(challenge.message)

      setStep({ kind: 'verifying', wallet, challenge })
      const { user } = await verifyWalletSignature({
        challenge_id: challenge.challenge_id,
        wallet: wallet.address,
        signature,
      })

      // Сессия известна до перехода, поэтому guard кабинета не ходит за ней снова.
      queryClient.setQueryData(queryKeys.session, user)

      // Адрес возврата — строка из адресной строки. Типы роутера знают только
      // статические пути, поэтому за безопасность отвечает `safeRedirect`.
      await navigate({ to: safeRedirect(search.redirect) as '/dashboard', replace: true })
    } catch (failure) {
      setStep({ kind: 'sign', wallet, challenge })
      setError(describe(failure, wallet.name))
    }
  }

  function describe(failure: unknown, walletName: string): string {
    if (isWalletError(failure)) {
      return failure.declined ? t.auth.declined(walletName) : t.auth.failed
    }
    return isApiError(failure) ? t.auth.verifyFailed : t.auth.serverFailed
  }

  const signing = step.kind === 'signing' || step.kind === 'verifying'
  const onMessageStep = step.kind === 'sign' || signing

  return (
    // Вход — одно решение, а не документ: колонка стоит по левой кромке страницы,
    // но по высоте держится середины экрана, иначе под ней зияет пустой подвал.
    <Container className="flex min-h-[58vh] items-center">
      <div className="w-full max-w-136">
        <PageHeader title={t.auth.title} lead={t.auth.lead} className="mb-8" />

        {onMessageStep ? (
          <SigningMessage
            wallet={step.wallet}
            message={step.challenge.message}
            busy={signing}
            status={
              step.kind === 'signing'
                ? t.auth.message.signing(step.wallet.name)
                : step.kind === 'verifying'
                  ? t.auth.message.verifying
                  : undefined
            }
            onSign={() => void sign(step.wallet, step.challenge)}
            onBack={() => {
              setError(null)
              setStep({ kind: 'choose' })
            }}
          />
        ) : wallets.length === 0 ? (
          <NoWallets />
        ) : (
          <WalletChoice
            wallets={wallets}
            onChoose={(wallet) => void choose(wallet)}
            busyWallet={step.kind === 'connecting' ? step.walletId : undefined}
          />
        )}

        {error && (
          <p className="text-state-error mt-4 text-[0.8125rem] leading-relaxed" role="status">
            {error}
          </p>
        )}

        <p className="text-muted-foreground mt-6 text-[0.8125rem] leading-relaxed">
          {t.auth.keyNote}
        </p>
      </div>
    </Container>
  )
}
