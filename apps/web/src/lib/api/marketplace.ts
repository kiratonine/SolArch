import { queryOptions } from '@tanstack/react-query'

import { apiUrl } from './config'
import { apiRequest } from './http'
import { queryKeys } from './query-keys'
import {
  marketplaceArchiveDetailSchema,
  marketplaceArchiveListSchema,
  publicFileListResponseSchema,
} from './types'
import type {
  MarketplaceArchiveDetail,
  MarketplaceArchiveListItem,
  MarketplaceListParams,
  Paginated,
  PublicFileListResponse,
} from './types'
import { visitorId } from './visitor'

/**
 * Публичный Marketplace API (`docs/API.md` §5).
 * Регистрация не требуется ни для одного запроса в этом модуле.
 */

/**
 * Каталог опубликованных архивов.
 *
 * Порядок выдачи определяет backend: frontend только передаёт `sort`
 * и рисует результат (`docs/roles/02_MARKETPLACE_FRONTEND.md` §4).
 */
export function listMarketplaceArchives(
  params: MarketplaceListParams = {},
  signal?: AbortSignal,
): Promise<Paginated<MarketplaceArchiveListItem>> {
  return apiRequest('/marketplace/archives', {
    query: {
      sort: params.sort,
      search: params.search,
      category: params.category,
      page: params.page,
    },
    signal,
    schema: marketplaceArchiveListSchema,
  })
}

/**
 * Карточка архива.
 *
 * Каждый такой запрос backend засчитывает как просмотр (ответ на Q10), а повторы
 * отбрасывает только по заголовку `X-Session-Id`. Поэтому запрос называет посетителя.
 */
export function getMarketplaceArchive(
  slug: string,
  signal?: AbortSignal,
): Promise<MarketplaceArchiveDetail> {
  return apiRequest(`/marketplace/archives/${encodeURIComponent(slug)}`, {
    signal,
    headers: { 'X-Session-Id': visitorId() },
    schema: marketplaceArchiveDetailSchema,
  })
}

export function getMarketplaceArchiveFiles(
  slug: string,
  signal?: AbortSignal,
): Promise<PublicFileListResponse> {
  return apiRequest(`/marketplace/archives/${encodeURIComponent(slug)}/files`, {
    signal,
    schema: publicFileListResponseSchema,
  })
}

/**
 * Ссылка на гостевое скачивание `.slr`.
 *
 * Скачивание идёт обычной навигацией браузера, а не через fetch: так работают
 * заголовки Content-Disposition, а backend успевает засчитать событие download.
 * Возвращается всегда сгенерированный `.slr`, никогда не исходный ZIP (AC-04).
 */
export function marketplaceDownloadUrl(slug: string): string {
  return apiUrl(`/marketplace/archives/${encodeURIComponent(slug)}/download`)
}

// ------------------------------------------------------------ query options

export function marketplaceListQuery(params: MarketplaceListParams = {}) {
  return queryOptions({
    queryKey: queryKeys.marketplace.list(params),
    queryFn: ({ signal }) => listMarketplaceArchives(params, signal),
  })
}

export function marketplaceArchiveQuery(slug: string) {
  return queryOptions({
    queryKey: queryKeys.marketplace.detail(slug),
    queryFn: ({ signal }) => getMarketplaceArchive(slug, signal),
  })
}

export function marketplaceArchiveFilesQuery(slug: string) {
  return queryOptions({
    queryKey: queryKeys.marketplace.files(slug),
    queryFn: ({ signal }) => getMarketplaceArchiveFiles(slug, signal),
    // Список файлов меняется только при перегенерации архива.
    staleTime: 5 * 60_000,
  })
}
