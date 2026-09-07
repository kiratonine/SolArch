/**
 * Светлая и тёмная тема.
 *
 * Ключ хранения и правило выбора продублированы во встроенном скрипте `index.html`:
 * тема должна примениться до первой отрисовки, иначе тёмный интерфейс моргает белым.
 * Менять их нужно в двух местах одновременно.
 */

export type Theme = 'light' | 'dark'

const STORAGE_KEY = 'solarch.theme'

export function isTheme(value: unknown): value is Theme {
  return value === 'light' || value === 'dark'
}

function readStored(): Theme | null {
  try {
    const stored = globalThis.localStorage?.getItem(STORAGE_KEY)
    return isTheme(stored) ? stored : null
  } catch {
    return null
  }
}

export function storeTheme(theme: Theme): void {
  try {
    globalThis.localStorage?.setItem(STORAGE_KEY, theme)
  } catch {
    // Выбор не сохранится, но тема применится на текущей сессии.
  }
}

export function systemTheme(): Theme {
  return globalThis.matchMedia?.('(prefers-color-scheme: dark)').matches ? 'dark' : 'light'
}

/** Явный выбор важнее системной настройки. */
export function detectTheme(): Theme {
  return readStored() ?? systemTheme()
}

export function applyTheme(theme: Theme): void {
  document.documentElement.classList.toggle('dark', theme === 'dark')
}
