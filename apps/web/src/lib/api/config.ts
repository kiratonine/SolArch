/**
 * Настройки доступа к Marketplace Backend.
 *
 * Все пути API живут под префиксом `/v1` (`docs/API.md`).
 *
 * Cookie backend не выдаёт: сессия — Bearer-токен (ответ на Q1, `auth-token.ts`).
 * Поэтому запросы уходят без `credentials`, и фронту не о чем договариваться
 * с API насчёт SameSite, даже когда они живут на разных origin (Q7).
 */

const rawBaseUrl = import.meta.env.VITE_API_BASE_URL ?? 'http://localhost:3000'

/** Базовый URL backend без завершающего слэша. */
export const API_BASE_URL = rawBaseUrl.replace(/\/+$/, '')

export const API_PREFIX = '/v1'

/** Абсолютный URL эндпоинта: `apiUrl('/marketplace/archives')`. */
export function apiUrl(path: string): string {
  return `${API_BASE_URL}${API_PREFIX}${path}`
}
