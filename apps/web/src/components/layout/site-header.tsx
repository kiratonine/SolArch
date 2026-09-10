import { useQuery } from '@tanstack/react-query'
import { Link } from '@tanstack/react-router'

import { SignOutButton } from '@/components/auth/sign-out-button'
import { WalletAddress } from '@/components/auth/wallet-address'
import { Logo } from '@/components/brand/logo'
import { Container } from '@/components/layout/container'
import { LanguageSwitch } from '@/components/layout/language-switch'
import { ProductNav } from '@/components/layout/product-nav'
import { SiteMenu } from '@/components/layout/site-menu'
import { ThemeSwitch } from '@/components/layout/theme-switch'
import { sessionQuery } from '@/lib/api'
import { useI18n } from '@/lib/i18n'

/**
 * Шапка сознательно содержит только то, что действительно существует.
 * `Get the Viewer` появится, когда закроется Q6 (откуда берётся дистрибутив Viewer).
 *
 * Навигация живёт в двух видах, а не в одном с исчезающими частями. С `lg` она
 * стоит строкой целиком; ниже — уходит в меню (`site-menu.tsx`). Раньше ссылки
 * прятались поштучно по мере сужения — сперва «Каталог» (F50), потом продуктовые
 * страницы, — и с приходом `/how-it-works` и `/download` прятать стало нечего:
 * на 390px строка не держит даже одну из них.
 *
 * Вошедший автор видит адрес своего кошелька: это единственное имя, которое у него
 * есть в системе без пароля и почты. В узком виде адрес стоит последней строкой меню.
 */
export function SiteHeader() {
  const { data: session } = useQuery(sessionQuery())

  return (
    <header className="border-border bg-background/85 sticky top-0 z-40 border-b backdrop-blur-sm">
      {/* Высота строки — общий токен: меню рисуется в портале и висит ровно
          под ней, а достать её оттуда через DOM нельзя. */}
      <Container className="flex h-(--header-height) items-center gap-4">
        <Link
          to="/"
          className="focus-visible:ring-ring/60 rounded-sm focus-visible:ring-2 focus-visible:outline-none"
        >
          <Logo markClassName="size-4.5" wordClassName="text-[0.95rem]" />
        </Link>

        {/* Промежутки поджаты на узком экране: рядом с кнопкой меню стоят ещё
            два переключателя, и на 375px (390 минус полоса прокрутки) шапка
            при gap-3 вылезала за правый край вместе со всей страницей.
            Ширину кромки трогать нельзя — она общая (F21). */}
        <nav className="ml-auto flex items-center gap-2 sm:gap-4">
          <FullNav wallet={session?.wallet} />

          <LanguageSwitch />
          <ThemeSwitch className="lg:-mr-1.5" />

          {/* Кнопка стоит последней, у самого края: на телефоне это единственное
              место строки, куда большой палец достаёт не перехватывая телефон.
              Панель уходит в портал и висит слоем под шапкой — обе половины меню
              живут в одном компоненте.

              Отрицательный отступ отбирается у последнего в ряду: у кнопки-значка
              бокс шире самого значка, и без поправки край значка не совпал бы
              с кромкой страницы. Ниже `lg` последняя здесь кнопка меню, с `lg`
              она скрыта и последним снова становится переключатель темы. */}
          <SiteMenu wallet={session?.wallet} className="-mr-1.5 lg:hidden" />
        </nav>
      </Container>
    </header>
  )
}

/**
 * Навигация во всю строку. Порог `lg` измерен, а не выбран на глаз: худший
 * случай — вошедший автор в русской локали с двумя продуктовыми ссылками —
 * просит 750px. Мера страницы даёт 800 (54rem минус кромки), `md` — 689.
 * Запас в 50px значит, что третья такая ссылка встанет только вместо одной
 * из этих, а не рядом с ними.
 */
function FullNav({ wallet }: { wallet?: string }) {
  const { t } = useI18n()

  return (
    <div className="hidden items-center gap-4 lg:flex">
      <Link
        to="/"
        className={navLink}
        activeProps={{ className: navLinkActive }}
        activeOptions={{ exact: true }}
      >
        {t.nav.catalog}
      </Link>

      <ProductNav linkClassName={navLink} activeClassName={navLinkActive} />

      {wallet ? (
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
            className="border-border text-muted-foreground rounded-sm border px-2 py-1.5 text-xs leading-none"
          />
        </>
      ) : (
        <Link to="/login" className={navLink} activeProps={{ className: navLinkActive }}>
          {t.nav.signIn}
        </Link>
      )}
    </div>
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
