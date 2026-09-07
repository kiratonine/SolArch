import type { z } from 'zod'

import { API_CREDENTIALS, apiUrl } from './config'
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
 * Единственная точка выхода в сеть.
 *
 * Компоненты не вызывают `fetch()` напрямую (`docs/roles/02_MARKETPLACE_FRONTEND.md` §11) —
 * они работают через модули `lib/api/*`, которые используют эту функцию.
 */
export async function apiRequest<T>(path: string, options: RequestOptions<T> = {}): Promise<T> {
  const { method = 'GET', body, query, signal, headers, schema } = options

  let response: Response
  try {
    response = await fetch(buildUrl(path, query), {
      method,
      credentials: API_CREDENTIALS,
      signal,
      headers: {
        Accept: 'application/json',
        ...(body === undefined ? {} : { 'Content-Type': 'application/json' }),
        ...headers,
      },
      ...(body === undefined ? {} : { body: JSON.stringify(body) }),
    })
  } catch (cause) {
    if (cause instanceof DOMException && cause.name === 'AbortError') throw cause
    throw new NetworkError('Не удалось выполнить запрос к серверу', { cause })
  }

  if (!response.ok) {
    throw new ApiError(response.status, await readErrorBody(response))
  }

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
