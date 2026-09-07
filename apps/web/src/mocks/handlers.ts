import type { RequestHandler } from 'msw'

import { analyticsHandlers } from './handlers/analytics'
import { archiveHandlers } from './handlers/archives'
import { authHandlers } from './handlers/auth'
import { marketplaceHandlers } from './handlers/marketplace'
import { uploadHandlers } from './handlers/uploads'

/**
 * Мок Marketplace Backend.
 *
 * Источник истины по контрактам — `docs/API.md`. Хендлеры переиспользуются в трёх местах:
 * dev-сервер (`browser.ts`), Vitest (`node.ts`) и будущие E2E.
 *
 * Правило: мок повторяет реальный контракт, а не подстраивается под удобство компонента.
 * Порядок важен — более специфичные пути идут раньше общих.
 */
export const handlers: RequestHandler[] = [
  ...authHandlers,
  ...marketplaceHandlers,
  ...uploadHandlers,
  ...analyticsHandlers,
  ...archiveHandlers,
]
