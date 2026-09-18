import { getWallets } from '@wallet-standard/app'
import type { Wallet, WalletAccount, WalletIcon } from '@wallet-standard/base'

import { MOCK_CREATOR } from './db'

/**
 * Кошелёк для разработки, пока настоящего расширения в браузере нет.
 *
 * Живёт рядом с мок-backend и подключается там же (`main.tsx` → `enableMocking`),
 * поэтому в production-сборку не попадает: модуль импортируется динамически и
 * только при `import.meta.env.DEV`.
 *
 * Регистрируется он ровно тем же способом, что и Phantom, — через реестр Wallet
 * Standard. Приложение не отличает его от настоящего и не содержит ни одной ветки
 * «если это демо».
 */

const ICON: WalletIcon = `data:image/svg+xml;base64,${btoa(
    '<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 16 16"><rect width="16" height="16" rx="3" fill="#1b2438"/><path d="M4.5 3h7a1 1 0 0 1 1 1v8a1 1 0 0 1-1 1h-7a1 1 0 0 1-1-1V4a1 1 0 0 1 1-1Z" fill="#e0b24c"/></svg>',
  )}`

/** Адрес совпадает с автором в моке: иначе кабинет открывался бы пустым. */
const account: WalletAccount = {
  address: MOCK_CREATOR.wallet,
  publicKey: new Uint8Array(32),
  chains: ['solana:devnet'],
  features: ['solana:signMessage'],
}

const demoWallet: Wallet = {
  version: '1.0.0',
  name: 'Demo wallet (dev)',
  icon: ICON,
  chains: ['solana:devnet'],
  accounts: [],
  features: {
    'standard:connect': {
      version: '1.0.0',
      connect: async () => ({ accounts: [account] }),
    },
    'solana:signMessage': {
      version: '1.1.0',
      signMessage: async (...inputs: readonly { message: Uint8Array }[]) =>
        inputs.map((input) => ({
          signedMessage: input.message,
          // Подпись здесь произвольная: ed25519 проверяет backend, а не фронт.
          signature: crypto.getRandomValues(new Uint8Array(64)),
        })),
    },
  },
}

export function registerDemoWallet(): void {
  getWallets().register(demoWallet)
}
