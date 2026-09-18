import { Link } from '@tanstack/react-router'

import { useI18n } from '@/lib/i18n'

/**
 * Ссылки на продуктовые страницы — те, что объясняют устройство SolArch
 * и выдают Viewer. Список один на все три места, где эти ссылки стоят: шапка,
 * меню узкого экрана и подвал. Следующая такая страница добавляется здесь,
 * и все три получают её сразу, а не расходятся.
 *
 * Ссылки перечислены явным JSX, а не собраны из массива: `to` у роутера
 * типизирован деревом маршрутов, и опечатка в адресе падает на `tsc`,
 * а не в браузере.
 *
 * Компонент отдаёт только ссылки, без своего `nav`: в шапке и в меню они встают
 * внутрь уже существующей навигации, а вложенный `nav` в `nav` — сломанный ландмарк.
 */
export function ProductNav({
  linkClassName,
  activeClassName,
  onNavigate,
}: {
  linkClassName?: string
  activeClassName?: string
  /** Меню узкого экрана закрывается по переходу — иначе оно осталось бы поверх. */
  onNavigate?: () => void
}) {
  const { t } = useI18n()

  return (
    <>
      <Link
        to="/how-it-works"
        className={linkClassName}
        activeProps={{ className: activeClassName }}
        onClick={onNavigate}
      >
        {t.nav.howItWorks}
      </Link>

      {/* Вторая ссылка — `t.nav.viewer` на `/download` — встаёт сюда вместе
          со страницей; ключ для неё уже лежит в обоих словарях. */}
    </>
  )
}
