import { queryOptions } from '@tanstack/react-query'

import { apiUrl } from './config'
import { apiRequest } from './http'
import { queryKeys } from './query-keys'
import {
  createArchiveResponseSchema,
  creatorArchiveListSchema,
  creatorArchiveSchema,
} from './types'
import type {
  CreateArchiveRequest,
  CreateArchiveResponse,
  CreatorArchive,
  UpdateArchiveRequest,
} from './types'

/**
 * Архивы автора (`docs/API.md` §3). Все эндпоинты требуют сессию,
 * владение проверяет backend.
 */

/**
 * Создаёт архив и замораживает экономику.
 *
 * После этого вызова `price.amount`, `price.currency` и `platform_fee_bps`
 * неизменяемы (ADR-004). Другая цена — только новый архив.
 */
export function createArchive(input: CreateArchiveRequest): Promise<CreateArchiveResponse> {
  return apiRequest('/archives', {
    method: 'POST',
    body: input,
    schema: createArchiveResponseSchema,
  })
}

/**
 * ДОПУЩЕНИЕ (открытый вопрос Q8): в `docs/API.md` нет эндпоинта списка архивов автора,
 * хотя раздел My Archives обязателен по роли §6.1. Считаем, что это `GET /v1/archives`.
 */
export function listMyArchives(signal?: AbortSignal): Promise<CreatorArchive[]> {
  return apiRequest('/archives', { signal, schema: creatorArchiveListSchema })
}

export function getMyArchive(archiveId: string, signal?: AbortSignal): Promise<CreatorArchive> {
  return apiRequest(`/archives/${encodeURIComponent(archiveId)}`, { signal, schema: creatorArchiveSchema })
}

/** Меняет только редактируемые метаданные. Цену изменить нельзя — её здесь нет. */
export function updateArchive(
  archiveId: string,
  input: UpdateArchiveRequest,
): Promise<CreatorArchive> {
  return apiRequest(`/archives/${encodeURIComponent(archiveId)}`, {
    method: 'PATCH',
    body: input,
    schema: creatorArchiveSchema,
  })
}

/**
 * Публикация. Backend требует: владение, `technical_status = ready`,
 * валидный payout wallet и подготовленный USDC ATA автора.
 */
export function publishArchive(archiveId: string): Promise<CreatorArchive> {
  return apiRequest(`/archives/${encodeURIComponent(archiveId)}/publish`, {
    method: 'POST',
    schema: creatorArchiveSchema,
  })
}

export function unpublishArchive(archiveId: string): Promise<CreatorArchive> {
  return apiRequest(`/archives/${encodeURIComponent(archiveId)}/unpublish`, {
    method: 'POST',
    schema: creatorArchiveSchema,
  })
}

/** Ссылка на скачивание собственного `.slr`. Открывается навигацией браузера. */
export function ownerDownloadUrl(archiveId: string): string {
  return apiUrl(`/archives/${encodeURIComponent(archiveId)}/download`)
}

// ------------------------------------------------------------ query options

export function myArchivesQuery() {
  return queryOptions({
    queryKey: queryKeys.archives.list(),
    queryFn: ({ signal }) => listMyArchives(signal),
  })
}

export function myArchiveQuery(archiveId: string) {
  return queryOptions({
    queryKey: queryKeys.archives.detail(archiveId),
    queryFn: ({ signal }) => getMyArchive(archiveId, signal),
  })
}

/**
 * То же, но с поллингом, пока архив собирается.
 *
 * `uploading` и `processing` — переходные состояния: backend упакует `.slr`
 * и переведёт архив в `ready` или `failed`, и экран должен обновиться сам.
 */
export function myArchiveWithProcessingQuery(archiveId: string) {
  return queryOptions({
    ...myArchiveQuery(archiveId),
    refetchInterval: (query) => {
      const status = query.state.data?.technical_status
      return status === 'uploading' || status === 'processing' ? 3_000 : false
    },
  })
}
