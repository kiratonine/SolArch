import { queryOptions } from '@tanstack/react-query'

import { clearAuthToken, readAuthToken, saveAuthToken } from './auth-token'
import { ApiError } from './errors'
import { apiRequest } from './http'
import { queryKeys } from './query-keys'
import {
  sessionUserSchema,
  walletChallengeResponseSchema,
  walletVerifyResponseSchema,
} from './types'
import type { SessionUser, WalletChallengeResponse, WalletVerifyResponse } from './types'

/**
 * Аутентификация автора по подписи кошелька (`docs/API.md` §2).
 *
 * Frontend НИКОГДА не видит приватный ключ и seed-фразу: подпись создаёт
 * кошелёк пользователя, сюда приходит только её результат.
 */

/** Шаг 1: получить сообщение, которое кошелёк должен подписать. */
export function requestWalletChallenge(wallet: string): Promise<WalletChallengeResponse> {
  return apiRequest('/auth/wallet/challenge', {
    method: 'POST',
    body: { wallet },
    schema: walletChallengeResponseSchema,
  })
}

/** Шаг 2: отправить подпись и получить сессию — токен, который дальше едет с каждым запросом. */
export async function verifyWalletSignature(input: {
  challenge_id: string
  wallet: string
  signature: string
}): Promise<WalletVerifyResponse> {
  const result = await apiRequest('/auth/wallet/verify', {
    method: 'POST',
    body: input,
    schema: walletVerifyResponseSchema,
  })

  saveAuthToken(result.access_token)
  return result
}

/**
 * Текущая сессия. `null` означает «гость», а не ошибку:
 * публичная часть маркетплейса работает без логина.
 *
 * Без токена backend заведомо ответит 401 (ответ на Q12), поэтому гость узнаётся
 * без запроса — и консоль не краснеет ошибкой на каждой публичной странице.
 */
export async function getSession(signal?: AbortSignal): Promise<SessionUser | null> {
  if (!readAuthToken()) return null

  try {
    return await apiRequest('/me', { signal, schema: sessionUserSchema })
  } catch (error) {
    if (error instanceof ApiError && error.isUnauthorized) return null
    throw error
  }
}

/**
 * Выход.
 *
 * Токен — JWT без состояния: backend не хранит сессий и отозвать его у себя
 * не может. Выход поэтому совершается здесь, стиранием токена, а запрос к backend
 * лишь сообщает о нём. Его сбой выхода не отменяет: токена, которого нет,
 * предъявить уже нечем.
 */
export async function logout(): Promise<void> {
  try {
    await apiRequest('/auth/logout', { method: 'POST' })
  } catch {
    // Выход уже состоялся — ниже, в `finally`.
  } finally {
    clearAuthToken()
  }
}

// ------------------------------------------------------------ query options

export function sessionQuery() {
  return queryOptions({
    queryKey: queryKeys.session,
    queryFn: ({ signal }) => getSession(signal),
    staleTime: 5 * 60_000,
    // 401 — это валидный ответ «гость», повторять запрос незачем.
    retry: false,
  })
}
