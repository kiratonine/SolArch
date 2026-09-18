import { queryOptions } from '@tanstack/react-query'

import { apiRequest } from './http'
import { queryKeys } from './query-keys'
import { archiveAnalyticsSchema } from './types'
import type { AnalyticsPeriod, ArchiveAnalytics } from './types'

/**
 * Аналитика автора (`docs/API.md` §11). Только для владельца архива.
 *
 * Frontend ничего не агрегирует и не считает конверсии сам — все числа приходят
 * с backend (`docs/INTEGRATION.md` §11).
 */
export function getArchiveAnalytics(
  archiveId: string,
  period: AnalyticsPeriod,
  signal?: AbortSignal,
): Promise<ArchiveAnalytics> {
  return apiRequest(`/archives/${encodeURIComponent(archiveId)}/analytics`, {
    query: { period },
    signal,
    schema: archiveAnalyticsSchema,
  })
}

export function archiveAnalyticsQuery(archiveId: string, period: AnalyticsPeriod) {
  return queryOptions({
    queryKey: queryKeys.archives.analytics(archiveId, period),
    queryFn: ({ signal }) => getArchiveAnalytics(archiveId, period, signal),
  })
}
