import { queryOptions } from '@tanstack/react-query'

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

/** Шаг 2: отправить подпись и получить сессию. */
export function verifyWalletSignature(input: {
  challenge_id: string
  wallet: string
  signature: string
}): Promise<WalletVerifyResponse> {
  return apiRequest('/auth/wallet/verify', {
    method: 'POST',
    body: input,
    schema: walletVerifyResponseSchema,
  })
}

/**
 * Текущая сессия. `null` означает «гость», а не ошибку:
 * публичная часть маркетплейса работает без логина.
 */
export async function getSession(signal?: AbortSignal): Promise<SessionUser | null> {
  try {
    return await apiRequest('/me', { signal, schema: sessionUserSchema })
  } catch (error) {
    if (error instanceof ApiError && error.isUnauthorized) return null
    throw error
  }
}

export function logout(): Promise<void> {
  return apiRequest('/auth/logout', { method: 'POST' })
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
