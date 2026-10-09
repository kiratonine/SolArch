import { createContext } from 'react'

import type { Dictionary } from './dict.en'
import type { Formatters } from './format'
import type { Locale } from './locale'

export interface I18nValue {
  locale: Locale
  setLocale: (locale: Locale) => void
  /** Словарь текущей локали. */
  t: Dictionary
  format: Formatters
}

/**
 * Контекст живёт в отдельном файле от провайдера: так и провайдер, и хук
 * экспортируют по одной сущности, и Fast Refresh не перезагружает дерево целиком.
 */
export const I18nContext = createContext<I18nValue | null>(null)
