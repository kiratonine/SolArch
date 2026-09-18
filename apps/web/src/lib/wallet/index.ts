/**
 * Слой кошелька. Выше этой границы Wallet Standard не виден.
 *
 * Приватный ключ и seed-фраза не проходят через приложение ни в каком виде
 * (`docs/roles/02_MARKETPLACE_FRONTEND.md` §5).
 */

export { WalletError, isWalletError } from './errors'
export { detectWallets, onWalletsChange } from './registry'
export type { AvailableWallet, ConnectedWallet } from './types'
export { useWallets } from './use-wallets'
