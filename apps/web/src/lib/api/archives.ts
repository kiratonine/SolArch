import { queryOptions } from '@tanstack/react-query'

import { apiUrl } from './config'
import { apiRequest } from './http'
import { queryKeys } from './query-keys'
import {
  createArchiveResponseSchema,
  creatorArchiveListSchema,
  creatorArchiveSchema,
  publicFileListResponseSchema,
} from './types'
import type {
  CreateArchiveRequest,
  CreateArchiveResponse,
  CreatorArchive,
  PublicFileListResponse,
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

/**
 * Опись файлов собственного архива.
 *
 * ДОПУЩЕНИЕ (открытый вопрос Q15): в `docs/API.md` описи для автора нет вовсе.
 * `GET /v1/archives/:archiveId` отдаёт только `file_count` и `size_bytes`, а разбор
 * по `display_path` есть лишь у опубликованного архива — на публичном эндпоинте
 * по slug. До публикации slug'а не существует, то есть автор не может увидеть,
 * что backend распаковал из его ZIP, до того как выставит архив на витрину.
 * Считаем, что это `GET /v1/archives/:archiveId/files` с той же формой ответа,
 * что и публичный listing.
 */
export function getMyArchiveFiles(
  archiveId: string,
  signal?: AbortSignal,
): Promise<PublicFileListResponse> {
  return apiRequest(`/archives/${encodeURIComponent(archiveId)}/files`, {
    signal,
    schema: publicFileListResponseSchema,
  })
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

/**
 * Список архивов автора.
 *
 * Пока хотя бы один архив собирается, список обновляется сам: `uploading` и
 * `processing` кончаются на стороне backend, и без опроса кабинет показывал бы
 * «обрабатывается» до тех пор, пока человек не перезагрузит страницу руками.
 * Как только переходных архивов не остаётся, опрос прекращается.
 */
export function myArchivesQuery() {
  return queryOptions({
    queryKey: queryKeys.archives.list(),
    queryFn: ({ signal }) => listMyArchives(signal),
    refetchInterval: (query) => {
      const building = query.state.data?.some(
        (archive) =>
          archive.technical_status === 'uploading' || archive.technical_status === 'processing',
      )
      return building ? 5_000 : false
    },
  })
}

export function myArchiveQuery(archiveId: string) {
  return queryOptions({
    queryKey: queryKeys.archives.detail(archiveId),
    queryFn: ({ signal }) => getMyArchive(archiveId, signal),
  })
}

/**
 * Опись собственного архива.
 *
 * `staleTime` здесь нет намеренно: содержимое меняется ровно тогда, когда автор
 * загружает файлы, и после каждой удачной загрузки запрос сбрасывается вручную.
 */
export function myArchiveFilesQuery(archiveId: string) {
  return queryOptions({
    queryKey: queryKeys.archives.files(archiveId),
    queryFn: ({ signal }) => getMyArchiveFiles(archiveId, signal),
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
