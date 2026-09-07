import { API_CREDENTIALS, apiUrl } from './config'
import { ApiError, NetworkError } from './errors'
import { apiRequest } from './http'
import { uploadCompleteResponseSchema, uploadInitResponseSchema } from './types'
import type { UploadCompleteResponse, UploadInitRequest, UploadInitResponse } from './types'

/**
 * Загрузка исходных файлов автора (`docs/API.md` §4).
 *
 * Криптографическая упаковка выполняется на backend. Браузер только передаёт байты
 * (`docs/roles/02_MARKETPLACE_FRONTEND.md` §9).
 */

export interface UploadProgress {
  loaded: number
  total: number
  /** Доля от 0 до 1. */
  ratio: number
}

export interface UploadOptions {
  onProgress?: (progress: UploadProgress) => void
  signal?: AbortSignal
}

export function initUpload(input: UploadInitRequest): Promise<UploadInitResponse> {
  return apiRequest('/uploads/init', {
    method: 'POST',
    body: input,
    schema: uploadInitResponseSchema,
  })
}

export function completeUpload(uploadId: string): Promise<UploadCompleteResponse> {
  return apiRequest(`/uploads/${encodeURIComponent(uploadId)}/complete`, {
    method: 'POST',
    schema: uploadCompleteResponseSchema,
  })
}

export function cancelUpload(uploadId: string): Promise<void> {
  return apiRequest(`/uploads/${encodeURIComponent(uploadId)}/cancel`, { method: 'POST' })
}

/**
 * Передаёт байты файла.
 *
 * Используется XMLHttpRequest, а не fetch: только он даёт события прогресса
 * отправки, а прогресс-бар обязателен по роли §9.
 *
 * Работают оба транспорта из вопроса Q2: если backend вернул `upload_url` —
 * пишем прямо в хранилище, иначе отправляем через сам API.
 */
export function uploadFileData(
  init: UploadInitResponse,
  file: File,
  options: UploadOptions = {},
): Promise<void> {
  const { onProgress, signal } = options

  const direct = Boolean(init.upload_url)
  const url = init.upload_url ?? apiUrl(`/uploads/${encodeURIComponent(init.upload_id)}/data`)
  const method = init.method ?? (direct ? 'PUT' : 'POST')

  return new Promise<void>((resolve, reject) => {
    if (signal?.aborted) {
      reject(new DOMException('Upload aborted', 'AbortError'))
      return
    }

    const xhr = new XMLHttpRequest()
    xhr.open(method, url, true)

    // Cookie-сессия нужна только своему API; в подписанный URL хранилища её слать нельзя.
    xhr.withCredentials = !direct && API_CREDENTIALS === 'include'

    for (const [header, value] of Object.entries(init.headers ?? {})) {
      xhr.setRequestHeader(header, value)
    }

    const onAbort = () => xhr.abort()
    signal?.addEventListener('abort', onAbort, { once: true })

    const cleanup = () => signal?.removeEventListener('abort', onAbort)

    xhr.upload.onprogress = (event) => {
      if (!onProgress || !event.lengthComputable) return
      onProgress({
        loaded: event.loaded,
        total: event.total,
        ratio: event.total > 0 ? event.loaded / event.total : 0,
      })
    }

    xhr.onload = () => {
      cleanup()
      if (xhr.status >= 200 && xhr.status < 300) {
        onProgress?.({ loaded: file.size, total: file.size, ratio: 1 })
        resolve()
        return
      }
      reject(
        new ApiError(xhr.status, {
          code: 'UPLOAD_FAILED',
          message: `Загрузка файла завершилась с кодом ${xhr.status}`,
        }),
      )
    }

    xhr.onerror = () => {
      cleanup()
      reject(new NetworkError('Не удалось передать файл на сервер'))
    }

    xhr.onabort = () => {
      cleanup()
      reject(new DOMException('Upload aborted', 'AbortError'))
    }

    xhr.send(file)
  })
}

/**
 * Полный цикл загрузки одного файла: init → передача байтов → complete.
 *
 * Загрузка считается завершённой только после подтверждения backend (роль §9):
 * до ответа `complete` архив в UI не может считаться готовым.
 */
export async function uploadArchiveFile(
  archiveId: string,
  file: File,
  options: UploadOptions = {},
): Promise<UploadCompleteResponse> {
  const init = await initUpload({
    archive_id: archiveId,
    filename: file.name,
    size_bytes: file.size,
  })

  try {
    await uploadFileData(init, file, options)
  } catch (error) {
    // Отменённую или упавшую загрузку не оставляем висеть на backend.
    await cancelUpload(init.upload_id).catch(() => undefined)
    throw error
  }

  return completeUpload(init.upload_id)
}
