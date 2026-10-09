/** Куда попадает автор сразу после входа, если он не шёл никуда конкретно. */
export const AFTER_LOGIN = '/dashboard'

/**
 * Адрес возврата после входа.
 *
 * Значение приходит из адресной строки, то есть от кого угодно: ссылку
 * `/login?redirect=https://evil.example` присылают затем, чтобы вход на настоящем
 * сайте закончился на поддельном. Пропускаем только путь внутри приложения.
 */
export function safeRedirect(value: string | undefined): string {
  if (!value) return AFTER_LOGIN

  // Всё, что не начинается со слэша, — чужая схема: `https:`, `javascript:`.
  if (!value.startsWith('/')) return AFTER_LOGIN

  // `//host` и `/\host` браузер выпрямляет в адрес чужого сайта, а не в путь.
  if (value.startsWith('//') || value.startsWith('/\\')) return AFTER_LOGIN

  return value
}
