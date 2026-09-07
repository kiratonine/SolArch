import { useQuery } from '@tanstack/react-query'
import { createFileRoute } from '@tanstack/react-router'

import { WalletAddress } from '@/components/auth/wallet-address'
import { Container } from '@/components/layout/container'
import { PageHeader } from '@/components/layout/page-header'
import { sessionQuery } from '@/lib/api'
import { useI18n } from '@/lib/i18n'

export const Route = createFileRoute('/dashboard/')({
  component: DashboardPage,
})

/**
 * Каркас кабинета: список архивов приходит на S6.
 *
 * Пустого состояния здесь намеренно нет. «Архивов пока нет» — утверждение о числе
 * архивов, а страница их ещё не запрашивает; у автора в моке они как раз есть.
 * Поэтому сказано только то, что известно наверняка: каким кошельком человек вошёл.
 * Полный адрес, а не сокращённый: в шапке он обрезан, а сверять кошелёк перед
 * созданием архива придётся целиком.
 */
function DashboardPage() {
  const { t } = useI18n()
  const { data: session } = useQuery(sessionQuery())

  return (
    <Container>
      <PageHeader title={t.dashboard.title} lead={t.dashboard.lead} />

      {session && (
        <p className="text-muted-foreground flex flex-wrap items-baseline gap-2 text-[0.8125rem]">
          {t.dashboard.signedInAs}
          <WalletAddress address={session.wallet} className="text-foreground break-all" full />
        </p>
      )}
    </Container>
  )
}
