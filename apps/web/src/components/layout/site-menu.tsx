import { Dialog } from '@base-ui/react/dialog'
import { Link, useRouterState } from '@tanstack/react-router'
import { useEffect, useRef, useState } from 'react'

import { SignOutButton } from '@/components/auth/sign-out-button'
import { WalletAddress } from '@/components/auth/wallet-address'
import { Container } from '@/components/layout/container'
import { ProductNav } from '@/components/layout/product-nav'
import { Button } from '@/components/ui/button'
import { useI18n } from '@/lib/i18n'
import { cn } from '@/lib/utils'

/**
 * Навигация узкого экрана.
 *
 * До этого ссылки просто прятались по мере сужения: сперва «Каталог» (F50),
 * затем продуктовые страницы (F119). Прятать больше нечего — с приходом
 * `/how-it-works` и `/download` в строку перестало помещаться то, ради чего
 * человек на сайт и пришёл. Ниже `lg` навигация целиком уходит сюда (F122).
 *
 * Панель лежит слоем над страницей, а не в её потоке: раскрываясь внутри потока,
 * она отодвигала бы вниз всё содержимое, и «плавное появление» означало бы плавную
 * перекладку страницы — самое дорогое, что может делать браузер, и самое заметное
 * глазу. Слой всплывает над неподвижной страницей и стоит два свойства: прозрачность
 * и сдвиг (F125).
 *
 * Слой не запирает экран. `modal="trap-focus"` держит табуляцию внутри списка,
 * но оставляет живой шапку: язык, тему и саму кнопку меню видно и можно нажать,
 * пока меню открыто. Иначе бургер — то место, куда рука тянется закрыть меню, —
 * оказался бы под затемнением и не отвечал (F126).
 *
 * Escape, нажатие мимо, возврат фокуса на кнопку и снятие слоя после анимации —
 * всё это делает Base UI. Своего кода здесь ровно столько, сколько нужно, чтобы
 * закрыть меню на переходе.
 */
export function SiteMenu({ wallet, className }: { wallet?: string; className?: string }) {
  const { t } = useI18n()
  const [open, setOpen] = useState(false)

  return (
    <Dialog.Root open={open} onOpenChange={setOpen} modal="trap-focus">
      <Dialog.Trigger
        render={<Button variant="ghost" size="icon-sm" />}
        // Значок остаётся размером с соседние переключатели, а нажимается область
        // вокруг него: 36×44 вместо 28×28. Растёт невидимая псевдострока, а не сама
        // кнопка, поэтому подсветка при наведении и выравнивание по кромке не меняются.
        // Это главный орган управления на телефоне, и целиться в него пальцем
        // человек должен грубо.
        className={cn('relative before:absolute before:-inset-x-1 before:-inset-y-2', className)}
        aria-label={t.nav.menu}
      >
        <BurgerMark open={open} />
      </Dialog.Trigger>

      <Dialog.Portal>
        {/* Затемнение начинается под шапкой: шапка остаётся частью интерфейса,
            а не тем, что меню накрыло. Размытие то же, что у диалога выхода, —
            теней в теме нет ни у чего, и слой отделяется только так. */}
        <Dialog.Backdrop
          className="bg-foreground/25 fixed inset-x-0 bottom-0 top-(--header-height) z-30 backdrop-blur-[2px] transition-opacity duration-150 data-ending-style:opacity-0 data-starting-style:opacity-0 lg:hidden"
        />

        <Dialog.Popup
          // Открыли пальцем или мышью — фокус не двигаем: он ушёл бы на первую
          // ссылку, и та встала бы в кольцо фокуса, читаясь выбранной строкой.
          // Открыли с клавиатуры — наоборот, фокус обязан войти в список, иначе
          // до него нечем добраться.
          initialFocus={(openedBy) => openedBy === 'keyboard'}
          className={cn(
            'border-border bg-background fixed inset-x-0 top-(--header-height) z-30 border-b outline-none lg:hidden',
            // Панель выезжает из-под шапки: сдвиг небольшой, потому что ехать
            // ей некуда — она уже на месте, и движение только показывает откуда.
            //
            // В списке перехода именно `translate`, а не `transform`: Tailwind v4
            // пишет сдвиг в отдельное свойство `translate`, и `transition-transform`
            // его не подхватывает — панель проявлялась, но прыгала на место.
            // Проверено в браузере: со `transform` сдвиг менялся между кадрами
            // скачком, с `translate` идёт плавно.
            'transition-[opacity,translate] duration-150 ease-out',
            'data-ending-style:-translate-y-2 data-ending-style:opacity-0',
            'data-starting-style:-translate-y-2 data-starting-style:opacity-0',
          )}
        >
          {/* Имя слоя. Видимого заголовка у меню нет и не нужно: список
              из четырёх строк называет себя сам. */}
          <Dialog.Title className="sr-only">{t.nav.menu}</Dialog.Title>

          <MenuRows wallet={wallet} onNavigate={() => setOpen(false)} />
        </Dialog.Popup>
      </Dialog.Portal>
    </Dialog.Root>
  )
}

/**
 * Три черты, которые складываются в крест.
 *
 * Смена значка на другой значок — подмена, её видно как мигание. Здесь черты
 * те же самые: крайние съезжаются к середине и поворачиваются, средняя гаснет.
 * Движение и есть объяснение: то, что открылось этой кнопкой, ею же закрывается.
 *
 * Собран из трёх полосок, а не взят из набора значков: готового бургера,
 * который умеет превращаться в крест, там нет, а поворот двух линий описывается
 * тремя строчками стилей.
 */
function BurgerMark({ open }: { open: boolean }) {
  return (
    <span aria-hidden="true" className="relative block size-4">
      <span className={cn(bar, open ? 'top-2 rotate-45' : 'top-1')} />
      <span className={cn(bar, 'top-2', open && 'scale-x-0 opacity-0')} />
      <span className={cn(bar, open ? 'top-2 -rotate-45' : 'top-3')} />
    </span>
  )
}

/**
 * Полоска бургера: волосяная линия во всю ширину значка.
 *
 * В списке перехода `rotate` и `scale` по отдельности, а не общий `transform`:
 * Tailwind v4 пишет поворот и сжатие в собственные свойства, и `transform`
 * в переходе не двигает ни одно из них — крест складывался бы рывком.
 */
const bar =
  'absolute inset-x-0 h-px bg-current transition-[top,rotate,scale,opacity] duration-200 ease-out'

/** Содержимое меню: те же ссылки, что и в строке шапки, только сверху вниз. */
function MenuRows({ wallet, onNavigate }: { wallet?: string; onNavigate: () => void }) {
  const { t } = useI18n()

  // Переход закрывает меню и тогда, когда его начали не из списка: выход из сессии
  // уводит на главную сам, и меню не должно остаться висеть над новой страницей.
  // Адрес на момент открытия запоминается — иначе эффект закрыл бы меню сразу же.
  const pathname = useRouterState({ select: (state) => state.location.pathname })
  const openedAt = useRef(pathname)

  useEffect(() => {
    if (pathname !== openedAt.current) onNavigate()
  }, [pathname, onNavigate])

  return (
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
