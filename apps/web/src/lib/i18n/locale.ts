/**
 * Список локалей и выбор текущей.
 *
 * Английский — база: маркетплейс продаёт за USDC международной аудитории.
 * Русский включается автоматически, если браузер его просит, и вручную переключателем.
 */

export const LOCALES = ['en', 'ru'] as const

export type Locale = (typeof LOCALES)[number]

export const DEFAULT_LOCALE: Locale = 'en'

const STORAGE_KEY = 'solarch.locale'

export function isLocale(value: unknown): value is Locale {
  return typeof value === 'string' && (LOCALES as readonly string[]).includes(value)
}

/**
 * localStorage недоступен в приватном режиме и в части тестовых окружений,
 * поэтому любое обращение к нему не должно ронять приложение.
 */
function readStored(): Locale | null {
  try {
    const stored = globalThis.localStorage?.getItem(STORAGE_KEY)
    return isLocale(stored) ? stored : null
  } catch {
    return null
  }
}

export function storeLocale(locale: Locale): void {
  try {
    globalThis.localStorage?.setItem(STORAGE_KEY, locale)
  } catch {
    // Выбор языка не сохранится, но интерфейс продолжит работать.
  }
}

/** Явный выбор пользователя важнее языка браузера, браузер важнее умолчания. */
export function detectLocale(): Locale {
  const stored = readStored()
  if (stored) return stored

  const preferred = globalThis.navigator?.languages ?? []
  for (const tag of preferred) {
    const base = tag.split('-')[0]
    if (isLocale(base)) return base
  }

  return DEFAULT_LOCALE
}
