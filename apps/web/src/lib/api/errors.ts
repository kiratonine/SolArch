/**
 * Ошибки API.
 *
 * Backend возвращает единый формат (`docs/API.md` §1.3):
 * `{ code, message, request_id }`.
 */

export interface ApiErrorBody {
  code: string
  message: string
  request_id?: string
}

export class ApiError extends Error {
  readonly code: string
  readonly status: number
  readonly requestId: string | undefined

  constructor(status: number, body: ApiErrorBody) {
    super(body.message)
    this.name = 'ApiError'
    this.code = body.code
    this.status = status
    this.requestId = body.request_id
  }

  /** Сессия истекла или пользователь не аутентифицирован. */
  get isUnauthorized(): boolean {
    return this.status === 401
  }

  /** Нет прав на чужой ресурс. */
  get isForbidden(): boolean {
    return this.status === 403
  }

  get isNotFound(): boolean {
    return this.status === 404
  }
}

/** Сеть недоступна или ответ не удалось разобрать. */
export class NetworkError extends Error {
  constructor(message: string, options?: { cause?: unknown }) {
    super(message, options)
    this.name = 'NetworkError'
  }
}

/**
 * Ответ backend не совпал с контрактом из `docs/API.md`.
 *
 * Это не ошибка пользователя, а расхождение реализации с общим документом.
 * По `docs/INTEGRATION.md` §14 такое чинится согласованием и правкой доков,
 * а не молчаливой подгонкой фронтенда.
 */
export class ContractError extends Error {
  readonly path: string
  readonly issues: string[]

  constructor(path: string, issues: string[]) {
    super(`Ответ ${path} не соответствует контракту API: ${issues.join('; ')}`)
    this.name = 'ContractError'
    this.path = path
    this.issues = issues
  }
}

export function isApiError(error: unknown): error is ApiError {
  return error instanceof ApiError
}

/** Текст ошибки для показа пользователю. */
export function toUserMessage(error: unknown): string {
  if (isApiError(error)) return error.message
  if (error instanceof NetworkError) return 'Сервер недоступен. Проверьте соединение.'
  if (error instanceof ContractError) return 'Сервер вернул неожиданный ответ.'
  if (error instanceof Error) return error.message
  return 'Неизвестная ошибка'
}
