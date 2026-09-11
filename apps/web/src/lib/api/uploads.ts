import { clearAuthToken } from './auth-token'
import { apiUrl } from './config'
import { ApiError, NetworkError, type ApiErrorBody } from './errors'
import { apiRequest, authHeaders } from './http'
import { uploadCompleteResponseSchema, uploadInitResponseSchema } from './types'
import type { UploadCompleteResponse, UploadInitRequest, UploadInitResponse } from './types'

/**
 * Загрузка содержимого архива (`docs/API.md` §4).
 *
 * Транспорт один — через сам API (ответ на Q2): `init` → байты ZIP
 * в `POST /uploads/:id/data` → `complete`. Распаковку, проверку и сборку `.slr`
 * делает backend. Браузер только передаёт байты (`docs/roles/02_MARKETPLACE_FRONTEND.md` §9).
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

/** Формулировка отказа из тела ответа, если backend её прислал. */
function errorBody(xhr: XMLHttpRequest): ApiErrorBody {
  try {
    const body = JSON.parse(xhr.responseText) as Partial<ApiErrorBody>
    if (typeof body.code === 'string' && typeof body.message === 'string') {
      return body as ApiErrorBody
    }
  } catch {
    // тело не JSON — ниже общая фраза
  }

  return {
    code: 'UPLOAD_FAILED',
    message: `Загрузка файла завершилась с кодом ${xhr.status}`,
  }
}

/**
 * Передаёт байты ZIP.
 *
 * XMLHttpRequest, а не fetch: только он даёт события прогресса отправки, а полоса
 * прогресса обязательна по роли §9.
 *
 * Адрес backend присылает и сам (`upload_url`), но это относительный путь того же
 * API: принятый как есть, он ушёл бы на origin фронтенда. Поэтому адрес строится
 * здесь, от `API_BASE_URL`, — и заодно токен сессии не может уехать на чужой хост.
 */
export function uploadArchiveData(
  uploadId: string,
  content: Blob,
  options: UploadOptions = {},
): Promise<void> {
  const { onProgress, signal } = options

  return new Promise<void>((resolve, reject) => {
    if (signal?.aborted) {
      reject(new DOMException('Upload aborted', 'AbortError'))
      return
    }

    const xhr = new XMLHttpRequest()
    xhr.open('POST', apiUrl(`/uploads/${encodeURIComponent(uploadId)}/data`), true)
    xhr.setRequestHeader('Content-Type', 'application/zip')

    for (const [header, value] of Object.entries(authHeaders())) {
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
        onProgress?.({ loaded: content.size, total: content.size, ratio: 1 })
        resolve()
        return
      }

      // То же правило, что у остальных запросов (`http.ts`): отвергнутый токен не держим.
      if (xhr.status === 401) clearAuthToken()
      reject(new ApiError(xhr.status, errorBody(xhr)))
    }

    xhr.onerror = () => {
      cleanup()
      reject(new NetworkError('Не удалось передать файл на сервер'))
    }

    xhr.onabort = () => {
      cleanup()
      reject(new DOMException('Upload aborted', 'AbortError'))
    }

    xhr.send(content)
  })
}

/**
 * Полный цикл одной загрузки: init → байты → complete.
 *
 * Загрузка считается завершённой только после подтверждения backend (роль §9):
 * до ответа `complete` архив в UI не может считаться готовым.
 */
export async function uploadArchiveContent(
  archiveId: string,
  content: File,
  options: UploadOptions = {},
): Promise<UploadCompleteResponse> {
  const init = await initUpload({
    archive_id: archiveId,
    filename: content.name,
    size_bytes: content.size,
  })

  try {
    await uploadArchiveData(init.upload_id, content, options)
  } catch (error) {
    // Отменённую или упавшую загрузку не оставляем висеть на backend.
    await cancelUpload(init.upload_id).catch(() => undefined)
    throw error
  }

  return completeUpload(init.upload_id)
}
