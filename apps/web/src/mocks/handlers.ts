import type { RequestHandler } from 'msw'

/**
 * Мок Marketplace Backend.
 *
 * Источник истины по контрактам — `docs/API.md`. Хендлеры наполняются на этапе S1
 * и переиспользуются в трёх местах: dev-сервер (browser.ts), Vitest (node.ts) и E2E.
 *
 * Правило: мок повторяет реальный контракт, а не подстраивается под удобство компонента.
 */
export const handlers: RequestHandler[] = []
