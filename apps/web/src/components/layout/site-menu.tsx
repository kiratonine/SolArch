import { Link, useRouterState } from '@tanstack/react-router'
import { useEffect, useRef, type Ref } from 'react'

import { SignOutButton } from '@/components/auth/sign-out-button'
import { WalletAddress } from '@/components/auth/wallet-address'
import { Container } from '@/components/layout/container'
import { ProductNav } from '@/components/layout/product-nav'
import { useI18n } from '@/lib/i18n'
import { cn } from '@/lib/utils'

/**
 * Навигация узкого экрана.
 *
 * До этого ссылки просто прятались по мере сужения: сперва «Каталог» (F50),
 * затем продуктовые страницы (F119). Прятать больше нечего — с приходом
 * `/how-it-works` и `/download` в строку перестало помещаться то, ради чего
 * человек на сайт и пришёл, а подвал как единственный вход означал пролистать
 * весь каталог до низа. Поэтому ниже `lg` навигация целиком уходит в меню.
 *
 * Меню — не модальное окно, а раскрывающаяся панель: она стоит в потоке под
 * строкой шапки и отодвигает страницу вниз, а не накрывает её. В теме нет теней,
 * и всплывающий слой пришлось бы отделять затемнением — как диалог, который
 * запирает экран. Меню ничего не запирает: его открывают, чтобы уйти.
 *
 * Переключатели языка и темы остаются в строке всегда. Меню отвечает на вопрос
 * «куда пойти», а они — на вопрос «как это выглядит», и прятать их за нажатием
 * не за что: места они просят немного.
 */

/** Кнопка, открывающая меню. Живёт в строке шапки, рядом с переключателями. */
export function MenuToggle({
  open,
  onToggle,
  className,
  ref,
}: {
  open: boolean
  onToggle: () => void
  className?: string
  ref?: Ref<HTMLButtonElement>
}) {
  const { t } = useI18n()

  return (
    <button
      ref={ref}
      type="button"
      onClick={onToggle}
      aria-expanded={open}
      className={cn(
        'border-border focus-visible:ring-ring/60 rounded-sm border px-2.5 py-1.5 text-[0.8125rem] leading-none font-medium transition-colors focus-visible:ring-2 focus-visible:outline-none',
        // Открытое состояние залито, как выбранный язык в переключателе рядом:
        // цветом его показать нельзя, янтарь закреплён за деньгами (F17).
        open ? 'bg-foreground text-background border-foreground' : 'hover:bg-muted',
        className,
      )}
    >
      {t.nav.menu}
    </button>
  )
}

/**
 * Раскрытая панель. Смонтирована только когда открыта, поэтому Escape слушается
 * здесь: пока меню закрыто, слушателя на документе нет вовсе.
 */
export function MenuPanel({
  wallet,
  onNavigate,
  onEscape,
}: {
  /** Адрес кошелька вошедшего автора; `undefined` — гость. */
  wallet?: string
  onNavigate: () => void
  onEscape: () => void
}) {
  const { t } = useI18n()

  useEffect(() => {
    function onKeyDown(event: KeyboardEvent) {
      if (event.key === 'Escape') onEscape()
    }

    document.addEventListener('keydown', onKeyDown)
    return () => document.removeEventListener('keydown', onKeyDown)
  }, [onEscape])

  // Переход закрывает меню и тогда, когда его начали не из списка: выход из сессии
  // уводит на главную сам, и меню не должно остаться висеть над новой страницей.
  // Адрес на момент открытия запоминается — иначе эффект закрыл бы меню сразу же.
  const pathname = useRouterState({ select: (state) => state.location.pathname })
  const openedAt = useRef(pathname)

  useEffect(() => {
    if (pathname !== openedAt.current) onNavigate()
  }, [pathname, onNavigate])

  return (
    <div className="border-border border-t lg:hidden">
      <Container>
        <nav aria-label={t.nav.menu} className="flex flex-col py-1">
          <Link
            to="/"
            className={menuRow}
            activeProps={{ className: menuRowActive }}
            activeOptions={{ exact: true }}
            onClick={onNavigate}
          >
            {t.nav.catalog}
          </Link>

          <ProductNav
            linkClassName={menuRow}
            activeClassName={menuRowActive}
            onNavigate={onNavigate}
          />

          {wallet ? (
            <>
              <Link
                to="/dashboard"
                className={menuRow}
                activeProps={{ className: menuRowActive }}
                onClick={onNavigate}
              >
                {t.nav.dashboard}
              </Link>

              {/* Выход и здесь спрашивает подтверждение (F63). Меню при этом
                  не закрывается: диалог живёт внутри него, и снять список
                  значило бы снять вместе с ним и вопрос. Закрывает меню сам
                  выход — он уводит на главную, а переход меню закрывает. */}
              <SignOutButton className={cn(menuRow, 'w-full text-left')} />

              {/* Адрес — не пункт назначения, поэтому стоит после черты и набран
                  моноширинным: это машинная строка, а не ссылка (F53). */}
              <WalletAddress
                address={wallet}
                className="text-muted-foreground border-border border-t py-3 text-xs"
              />
            </>
          ) : (
            <Link
              to="/login"
              className={menuRow}
              activeProps={{ className: menuRowActive }}
              onClick={onNavigate}
            >
              {t.nav.signIn}
            </Link>
          )}
        </nav>
      </Container>
    </div>
  )
}

/**
 * Строка меню во всю меру: палец попадает в неё, не целясь в слово.
 * Волосяная линия между строками — та же, что делит опись файлов и условия лицензии.
 */
const menuRow =
  'border-border text-foreground focus-visible:ring-ring/60 border-b py-3 text-[0.9375rem] font-medium last:border-b-0 focus-visible:ring-2 focus-visible:outline-none'

/** Где человек находится, показывает подчёркивание, как и в шапке (F52). */
const menuRowActive = 'underline decoration-1 underline-offset-[6px]'
