import { useCallback, useEffect, useMemo, useState, type ReactNode } from 'react'

import { I18nContext, type I18nValue } from './context'
import { en } from './dict.en'
import { ru } from './dict.ru'
import { createFormatters } from './format'
import { detectLocale, storeLocale, type Locale } from './locale'

const DICTIONARIES = { en, ru }

export interface I18nProviderProps {
  children: ReactNode
  /** Фиксирует язык в тестах и сторибуке; в приложении не передаётся. */
  locale?: Locale
}

export function I18nProvider({ children, locale: forced }: I18nProviderProps) {
  const [detected, setDetected] = useState<Locale>(() => forced ?? detectLocale())
  const locale = forced ?? detected

  const setLocale = useCallback((next: Locale) => {
    setDetected(next)
    storeLocale(next)
  }, [])

  // Язык документа читают скринридеры, переносы слов и системный поиск по странице.
  useEffect(() => {
    document.documentElement.lang = locale
  }, [locale])

  const value = useMemo<I18nValue>(
    () => ({
      locale,
      setLocale,
      t: DICTIONARIES[locale],
      format: createFormatters(locale),
    }),
    [locale, setLocale],
  )

  return <I18nContext value={value}>{children}</I18nContext>
}
