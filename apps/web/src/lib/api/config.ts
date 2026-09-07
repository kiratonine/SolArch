/**
 * Настройки доступа к Marketplace Backend.
 *
 * Все пути API живут под префиксом `/v1` (`docs/API.md`).
 */

const rawBaseUrl = import.meta.env.VITE_API_BASE_URL ?? 'http://localhost:3000'

/** Базовый URL backend без завершающего слэша. */
export const API_BASE_URL = rawBaseUrl.replace(/\/+$/, '')

export const API_PREFIX = '/v1'

/** Абсолютный URL эндпоинта: `apiUrl('/marketplace/archives')`. */
export function apiUrl(path: string): string {
  return `${API_BASE_URL}${API_PREFIX}${path}`
}

/**
 * ДОПУЩЕНИЕ (открытый вопрос Q1): считаем, что backend выдаёт httpOnly cookie-сессию,
 * поэтому запросы идут с `credentials: 'include'`. Если команда выберет Bearer-токен,
 * менять нужно только это место и `http.ts`.
 */
export const API_CREDENTIALS: RequestCredentials = 'include'
