import { getWallets } from '@wallet-standard/app'

import { toAvailableWallet } from './adapter'
import type { AvailableWallet } from './types'

/**
 * Список установленных кошельков.
 *
 * Реестр страницы наполняют сами расширения — приложение не знает имён конкретных
 * кошельков и не ищет их в `window`. Кошельки регистрируются асинхронно, поэтому
 * список нужно не только прочитать, но и слушать.
 */
export function detectWallets(): AvailableWallet[] {
  return getWallets()
    .get()
    .map(toAvailableWallet)
    .filter((wallet): wallet is AvailableWallet => wallet !== null)
}

/** Подписка на появление и исчезновение кошельков. Возвращает функцию отписки. */
export function onWalletsChange(listener: () => void): () => void {
  const wallets = getWallets()
  const offRegister = wallets.on('register', listener)
  const offUnregister = wallets.on('unregister', listener)

  return () => {
    offRegister()
    offUnregister()
  }
}
