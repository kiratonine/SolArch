/**
 * Публичная точка входа в API-слой.
 *
 * Компоненты импортируют только отсюда: `import { marketplaceListQuery } from '@/lib/api'`.
 * Прямой `fetch()` в компонентах запрещён (`docs/roles/02_MARKETPLACE_FRONTEND.md` §11).
 */

export * from './analytics'
export * from './archives'
export * from './auth'
export * from './errors'
export * from './marketplace'
export * from './query-keys'
export * from './types'
export * from './uploads'
export { API_BASE_URL, API_PREFIX, apiUrl } from './config'
