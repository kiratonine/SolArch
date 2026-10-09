/**
 * Сбой на стороне кошелька.
 *
 * `declined` отделяет отказ человека подписать от поломки: первое — обычный ход
 * событий, о котором говорят спокойно, второе — ошибка.
 */
export class WalletError extends Error {
  readonly declined: boolean

  constructor(message: string, { declined, cause }: { declined: boolean; cause?: unknown }) {
    super(message, { cause })
    this.name = 'WalletError'
    this.declined = declined
  }
}

export function isWalletError(error: unknown): error is WalletError {
  return error instanceof WalletError
}
