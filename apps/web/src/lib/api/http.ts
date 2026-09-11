import type { z } from 'zod'

import { clearAuthToken, readAuthToken } from './auth-token'
import { apiUrl } from './config'
import { ApiError, ContractError, NetworkError, type ApiErrorBody } from './errors'

export type QueryParams = Record<string, string | number | boolean | undefined | null>

export interface RequestOptions<T = unknown> {
  method?: 'GET' | 'POST' | 'PATCH' | 'PUT' | 'DELETE'
  /** Тело запроса; сериализуется в JSON. */
  body?: unknown
  query?: QueryParams
  signal?: AbortSignal
  headers?: Record<string, string>
  /**
   * Схема ответа. Если задана, тело проверяется в рантайме, и расхождение
   * с `docs/API.md` падает здесь, а не в глубине компонента.
   */
  schema?: z.ZodType<T>
}

function buildUrl(path: string, query?: QueryParams): string {
  const url = new URL(apiUrl(path))

  if (query) {
    for (const [key, value] of Object.entries(query)) {
      if (value === undefined || value === null || value === '') continue
      url.searchParams.set(key, String(value))
    }
  }

  return url.toString()
}

async function readErrorBody(response: Response): Promise<ApiErrorBody> {
  try {
    const body = (await response.json()) as Partial<ApiErrorBody>
    if (typeof body.code === 'string' && typeof body.message === 'string') {
      return body as ApiErrorBody
    }
  } catch {
    // тело не JSON — падаем на дефолт ниже
  }

  return {
    code: 'UNEXPECTED_ERROR',
    message: `Запрос завершился с кодом ${response.status}`,
  }
}

/**
 * Заголовок сессии, если автор вошёл. Гость запросы шлёт без него.
 *
 * Наружу отдаётся для загрузки файлов: она идёт через XMLHttpRequest, а не через
 * `apiRequest`, и собирать заголовок второй раз по-своему незачем.
 */
export function authHeaders(): Record<string, string> {
  const token = readAuthToken()
  return token ? { Authorization: `Bearer ${token}` } : {}
}

/**
 * Ответ 401 на запрос с токеном значит, что токен больше не действует: истёк или
 * backend его не узнаёт. Держать его дальше — слать заведомо отвергнутый заголовок
 * с каждым следующим запросом.
 */
async function failure(response: Response, sentToken: boolean): Promise<ApiError> {
  if (response.status === 401 && sentToken) clearAuthToken()
  return new ApiError(response.status, await readErrorBody(response))
}

/**
 * Единственная точка выхода в сеть.
 *
 * Компоненты не вызывают `fetch()` напрямую (`docs/roles/02_MARKETPLACE_FRONTEND.md` §11) —
 * они работают через модули `lib/api/*`, которые используют эту функцию.
 */
export async function apiRequest<T>(path: string, options: RequestOptions<T> = {}): Promise<T> {
  const { method = 'GET', body, query, signal, headers, schema } = options
  const auth = authHeaders()

  let response: Response
  try {
    response = await fetch(buildUrl(path, query), {
      method,
      signal,
      headers: {
        Accept: 'application/json',
        ...(body === undefined ? {} : { 'Content-Type': 'application/json' }),
        ...auth,
        ...headers,
      },
      ...(body === undefined ? {} : { body: JSON.stringify(body) }),
    })
  } catch (cause) {
    if (cause instanceof DOMException && cause.name === 'AbortError') throw cause
    throw new NetworkError('Не удалось выполнить запрос к серверу', { cause })
  }

  if (!response.ok) throw await failure(response, 'Authorization' in auth)

  if (response.status === 204) return undefined as T

  let payload: unknown
  try {
    payload = await response.json()
  } catch (cause) {
    throw new NetworkError('Сервер вернул некорректный JSON', { cause })
  }

  if (!schema) return payload as T

  const parsed = schema.safeParse(payload)
  if (!parsed.success) {
    throw new ContractError(
      path,
      parsed.error.issues.map((issue) => `${issue.path.join('.') || 'root'}: ${issue.message}`),
    )
  }

  return parsed.data
}

/**
 * Файл, который отдают только вошедшему автору.
 *
 * Обычная ссылка не умеет нести заголовок `Authorization`, поэтому такой файл
 * приходит запросом целиком и отдаётся браузеру уже из памяти (`lib/save-file.ts`).
 * Гостевому `.slr` это не нужно: он публичный и скачивается ссылкой.
 */
export async function apiDownload(path: string, signal?: AbortSignal): Promise<Blob> {
  const auth = authHeaders()

  let response: Response
  try {
    response = await fetch(apiUrl(path), { signal, headers: auth })
  } catch (cause) {
    if (cause instanceof DOMException && cause.name === 'AbortError') throw cause
    throw new NetworkError('Не удалось скачать файл', { cause })
  }

  if (!response.ok) throw await failure(response, 'Authorization' in auth)

  return response.blob()
}
