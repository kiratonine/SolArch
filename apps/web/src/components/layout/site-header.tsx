import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { Link, useNavigate } from '@tanstack/react-router'

import { WalletAddress } from '@/components/auth/wallet-address'
import { Logo } from '@/components/brand/logo'
import { Container } from '@/components/layout/container'
import { LanguageSwitch } from '@/components/layout/language-switch'
import { ThemeSwitch } from '@/components/layout/theme-switch'
import { logout, queryKeys, sessionQuery } from '@/lib/api'
import { useI18n } from '@/lib/i18n'
import { cn } from '@/lib/utils'

/**
 * Шапка сознательно содержит только то, что действительно существует.
 * `Get the Viewer` появится, когда закроется Q6 (откуда берётся дистрибутив Viewer).
 *
 * Вошедший автор видит адрес своего кошелька: это единственное имя, которое у него
 * есть в системе без пароля и почты. На узком экране адрес прячется — кабинет
 * и выход важнее.
 */
export function SiteHeader() {
  const { t } = useI18n()
  const { data: session } = useQuery(sessionQuery())

  return (
    <header className="border-border bg-background/85 sticky top-0 z-40 border-b backdrop-blur-sm">
      <Container className="flex h-14 items-center gap-4">
        <Link
          to="/"
          className="focus-visible:ring-ring/60 rounded-sm focus-visible:ring-2 focus-visible:outline-none"
        >
          <Logo markClassName="size-4.5" wordClassName="text-[0.95rem]" />
        </Link>

        <nav className="ml-auto flex items-center gap-3 sm:gap-4">
          {/* На узком экране ссылку в каталог несёт логотип: с кабинетом и выходом
              в строке пять органов управления не помещались, и шапка уезжала
              за правый край вместе со всей страницей. */}
          <Link
            to="/"
            className={cn(navLink, 'hidden sm:inline')}
            activeProps={{ className: navLinkActive }}
            activeOptions={{ exact: true }}
          >
            {t.nav.catalog}
          </Link>

          {session ? <SignedIn wallet={session.wallet} /> : <SignInLink />}

          <LanguageSwitch />
          <ThemeSwitch className="-mr-1.5" />
        </nav>
      </Container>
    </header>
  )
}

/**
 * Ссылки шапки набраны основным цветом, а не приглушённым: это единственная
 * навигация сайта, и приглушать её незачем. Где человек сейчас находится,
 * показывает волосяное подчёркивание — цветом это сказать нельзя, янтарь
 * закреплён за деньгами.
 */
const navLink =
  'text-foreground hover:text-foreground/70 focus-visible:ring-ring/60 rounded-sm text-[0.8125rem] font-medium transition-colors focus-visible:ring-2 focus-visible:outline-none'

const navLinkActive = 'underline decoration-1 underline-offset-[6px]'

function SignInLink() {
  const { t } = useI18n()

  return (
    <Link to="/login" className={navLink} activeProps={{ className: navLinkActive }}>
      {t.nav.signIn}
    </Link>
  )
}

function SignedIn({ wallet }: { wallet: string }) {
  const { t } = useI18n()
  const navigate = useNavigate()
  const queryClient = useQueryClient()

  const signOut = useMutation({
    mutationFn: logout,
    onSuccess: async () => {
      // Сессия обнуляется вручную, а не инвалидацией: повторный запрос `/me`
      // ответил бы 401, и человек увидел бы вспышку ошибки на ровном месте.
      queryClient.setQueryData(queryKeys.session, null)
      queryClient.removeQueries({ queryKey: queryKeys.archives.all })
      await navigate({ to: '/' })
    },
  })

  return (
    <>
      <Link to="/dashboard" className={navLink} activeProps={{ className: navLinkActive }}>
        {t.nav.dashboard}
      </Link>

      <button
        type="button"
        onClick={() => signOut.mutate()}
        disabled={signOut.isPending}
        className={navLink}
      >
        {t.auth.session.signOut}
      </button>

      {/* Адрес — не пункт навигации, а сведение о том, кем ты вошёл. Среди ссылок
          он читался сломанной ссылкой, поэтому убран в плашку с волосяной рамкой
          и поставлен в один ряд с переключателями языка и темы. */}
      <WalletAddress
        address={wallet}
        className="border-border text-muted-foreground hidden rounded-sm border px-2 py-1.5 text-xs leading-none sm:inline"
      />
    </>
  )
}
