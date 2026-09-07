import { HttpResponse, http } from 'msw'

import type { WalletChallengeRequest, WalletVerifyRequest } from '@/lib/api/types'
import { MOCK_CREATOR, db, nextId } from '../db'
import { apiError, route } from './shared'

/**
 * Мок аутентификации по подписи кошелька.
 *
 * Подпись здесь не проверяется — настоящая верификация ed25519 выполняется backend
 * (`docs/SECURITY.md`). Мок нужен только для UX-потока логина.
 */
export const authHandlers = [
  http.post(route('/auth/wallet/challenge'), async ({ request }) => {
    const { wallet } = (await request.json()) as WalletChallengeRequest

    if (!wallet || wallet.length < 32) {
      return apiError(400, 'INVALID_WALLET', 'Некорректный адрес Solana-кошелька')
    }

    const challengeId = nextId('chl')
    db.challenges.set(challengeId, wallet)

    return HttpResponse.json({
      challenge_id: challengeId,
      message: `Sign this message to authenticate with SolArch.\nWallet: ${wallet}\nNonce: ${challengeId}`,
    })
  }),

  http.post(route('/auth/wallet/verify'), async ({ request }) => {
    const body = (await request.json()) as WalletVerifyRequest
    const expectedWallet = db.challenges.get(body.challenge_id)

    if (!expectedWallet || expectedWallet !== body.wallet) {
      return apiError(400, 'CHALLENGE_INVALID', 'Challenge не найден или истёк')
    }

    if (!body.signature) {
      return apiError(400, 'SIGNATURE_REQUIRED', 'Отсутствует подпись')
    }

    db.challenges.delete(body.challenge_id)
    db.session = { ...MOCK_CREATOR, wallet: body.wallet }

    return HttpResponse.json({ authenticated: true, user: db.session })
  }),

  http.get(route('/me'), () => {
    if (!db.session) return apiError(401, 'UNAUTHORIZED', 'Требуется вход автора')
    return HttpResponse.json(db.session)
  }),

  http.post(route('/auth/logout'), () => {
    db.session = null
    return new HttpResponse(null, { status: 204 })
  }),
]
