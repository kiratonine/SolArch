import type { AnalyticsPeriod, MarketplaceListParams } from './types'

/**
 * Единая фабрика ключей TanStack Query.
 *
 * Ключи собраны в одном месте, чтобы инвалидация была точной: например, после
 * publish/unpublish достаточно сбросить `queryKeys.marketplace.all` и карточку архива,
 * не трогая аналитику и сессию.
 */
export const queryKeys = {
  session: ['session'] as const,

  marketplace: {
    all: ['marketplace'] as const,
    list: (params: MarketplaceListParams) => ['marketplace', 'list', params] as const,
    detail: (slug: string) => ['marketplace', 'detail', slug] as const,
    files: (slug: string) => ['marketplace', 'files', slug] as const,
  },

  archives: {
    all: ['archives'] as const,
    list: () => ['archives', 'list'] as const,
    detail: (archiveId: string) => ['archives', 'detail', archiveId] as const,
    files: (archiveId: string) => ['archives', 'files', archiveId] as const,
    analytics: (archiveId: string, period: AnalyticsPeriod) =>
      ['archives', 'analytics', archiveId, period] as const,
  },
} as const
