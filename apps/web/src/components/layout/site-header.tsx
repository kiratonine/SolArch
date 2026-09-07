import { useQuery } from '@tanstack/react-query'
import { Link } from '@tanstack/react-router'

import { SignOutButton } from '@/components/auth/sign-out-button'
import { WalletAddress } from '@/components/auth/wallet-address'
import { Logo } from '@/components/brand/logo'
import { Container } from '@/components/layout/container'
import { LanguageSwitch } from '@/components/layout/language-switch'
import { ThemeSwitch } from '@/components/layout/theme-switch'
import { sessionQuery } from '@/lib/api'
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

        {/* Промежутки поджаты на узком экране: у вошедшего автора в строке
            четыре органа управления и логотип, и на 375px (390 минус полоса
            прокрутки) шапка при gap-3 вылезала за правый край вместе со всей
            страницей. Ширину кромки трогать нельзя — она общая (F21). */}
        <nav className="ml-auto flex items-center gap-2 sm:gap-4">
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
  'text-foreground hover:text-foreground/70 focus-visible:ring-ring/60 rounded-sm text-[0.8125rem] font-medium whitespace-nowrap transition-colors focus-visible:ring-2 focus-visible:outline-none'

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

  return (
    <>
      <Link to="/dashboard" className={navLink} activeProps={{ className: navLinkActive }}>
        {t.nav.dashboard}
      </Link>

      {/* Выход спрашивает подтверждение: кнопка стоит вплотную к ссылкам, а вернуться
          после промаха можно только через кошелёк и новую подпись. */}
      <SignOutButton className={navLink} />

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
