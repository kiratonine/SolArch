import { saveAuthToken } from '@/lib/api/auth-token'
import type { SessionUser } from '@/lib/api/types'
import { MOCK_CREATOR, MOCK_TOKEN, db } from '@/mocks/db'

/**
 * Автор уже вошёл: мок помнит сессию, а клиент держит её токен.
 *
 * Нужны обе половины сразу. Backend узнаёт автора только по заголовку
 * `Authorization`, и сессия, о которой знает один мок, для клиента — гость.
 */
export function signIn(user: SessionUser = MOCK_CREATOR): void {
  db.session = user
  db.token = MOCK_TOKEN
  saveAuthToken(MOCK_TOKEN)
}
