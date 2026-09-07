import { render, type RenderOptions, type RenderResult } from '@testing-library/react'
import type { ReactElement, ReactNode } from 'react'

import { I18nProvider, type Locale } from '@/lib/i18n'

/**
 * Рендер с зафиксированной локалью.
 *
 * Язык в тестах задаётся явно, иначе результат зависел бы от `navigator.language`
 * машины, на которой их запустили.
 */
export function renderWithI18n(
  ui: ReactElement,
  { locale = 'en', ...options }: RenderOptions & { locale?: Locale } = {},
): RenderResult {
  function Wrapper({ children }: { children: ReactNode }) {
    return <I18nProvider locale={locale}>{children}</I18nProvider>
  }

  return render(ui, { wrapper: Wrapper, ...options })
}
