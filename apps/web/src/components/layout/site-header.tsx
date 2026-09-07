import { Link } from '@tanstack/react-router'

import { SealMark } from '@/components/brand/seal-mark'
import { Wordmark } from '@/components/brand/wordmark'
import { Container } from '@/components/layout/container'
import { LanguageSwitch } from '@/components/layout/language-switch'
import { ThemeSwitch } from '@/components/layout/theme-switch'
import { useI18n } from '@/lib/i18n'

/**
 * Шапка сознательно содержит только то, что действительно существует.
 * `Sign in` появится вместе с реальным роутом авторизации на S5,
 * `Get the Viewer` — когда закроется Q6 (откуда берётся дистрибутив Viewer).
 */
export function SiteHeader() {
  const { t } = useI18n()

  return (
    <header className="border-border bg-background/85 sticky top-0 z-40 border-b backdrop-blur-sm">
      <Container className="flex h-14 items-center gap-4">
        <Link
          to="/"
          className="focus-visible:ring-ring/60 flex items-center gap-2 rounded-sm focus-visible:ring-2 focus-visible:outline-none"
        >
          <SealMark className="size-4.5" />
          <Wordmark className="text-[0.95rem]" />
        </Link>

        <span aria-hidden="true" className="bg-border hidden h-4 w-px sm:block" />
        <p className="text-muted-foreground hidden text-[0.8125rem] sm:block">{t.brand.tagline}</p>

        <nav className="ml-auto flex items-center gap-4">
          <Link
            to="/"
            className="text-muted-foreground hover:text-foreground focus-visible:ring-ring/60 rounded-sm text-[0.8125rem] font-medium transition-colors focus-visible:ring-2 focus-visible:outline-none"
            activeProps={{ className: 'text-foreground' }}
            activeOptions={{ exact: true }}
          >
            {t.nav.catalog}
          </Link>
          <LanguageSwitch />
          <ThemeSwitch className="-mr-1.5" />
        </nav>
      </Container>
    </header>
  )
}
