/**
 * Кошелёк глазами приложения.
 *
 * Ниже этого файла живёт Wallet Standard, выше — только эти два интерфейса.
 * Приватного ключа здесь нет и быть не может: расширение отдаёт публичный адрес
 * и байты подписи, всё остальное остаётся внутри кошелька.
 */

/** Установленный кошелёк, готовый к подключению. */
export interface AvailableWallet {
  /** Имя кошелька; оно же различает записи в списке. */
  readonly id: string
  readonly name: string
  /** Иконка приходит от самого кошелька — своих логотипов мы не рисуем. */
  readonly icon: string
  connect(): Promise<ConnectedWallet>
}

/** Подключённый кошелёк: адрес известен, подпись доступна. */
export interface ConnectedWallet {
  readonly name: string
  readonly icon: string
  readonly address: string
  /** Подписывает текст и отдаёт подпись в base64 (`docs/API.md` §2). */
  signMessage(message: string): Promise<string>
}
