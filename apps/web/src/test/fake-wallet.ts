import { getWallets } from '@wallet-standard/app'
import type { Wallet, WalletAccount, WalletIcon } from '@wallet-standard/base'

/**
 * Поддельный кошелёк, зарегистрированный тем же способом, каким это делает Phantom.
 *
 * Wallet Standard не знает, кто его позвал: расширение объявляет себя через реестр
 * страницы, и тест объявляет себя точно так же. Поэтому проверяется настоящий путь
 * обнаружения, а не подменённый модуль.
 */

const ICON: WalletIcon = 'data:image/svg+xml;base64,PHN2Zy8+'

export interface FakeWalletOptions {
  name?: string
  address?: string
  /** Чем ответит расширение на запрос подключения. */
  onConnect?: () => void
  /** Чем ответит расширение на запрос подписи. */
  onSignMessage?: () => void
  signature?: Uint8Array
  /** Кошелёк без подписи сообщений — например, чисто транзакционный. */
  withoutSignMessage?: boolean
}

export function fakeWallet({
  name = 'Fake Wallet',
  address = 'FakeWa11etAddress1111111111111111111111111111',
  onConnect,
  onSignMessage,
  signature = new Uint8Array([1, 2, 3, 4]),
  withoutSignMessage = false,
}: FakeWalletOptions = {}): Wallet {
  const account: WalletAccount = {
    address,
    publicKey: new Uint8Array(32),
    chains: ['solana:mainnet'],
    features: ['solana:signMessage'],
  }

  const signMessageFeature = {
    'solana:signMessage': {
      version: '1.1.0' as const,
      signMessage: async (...inputs: readonly { message: Uint8Array }[]) => {
        onSignMessage?.()
        return inputs.map((input) => ({ signedMessage: input.message, signature }))
      },
    },
  }

  return {
    version: '1.0.0',
    name,
    icon: ICON,
    chains: ['solana:mainnet'],
    accounts: [],
    features: {
      'standard:connect': {
        version: '1.0.0' as const,
        connect: async () => {
          onConnect?.()
          return { accounts: [account] }
        },
      },
      ...(withoutSignMessage ? {} : signMessageFeature),
    },
  }
}

/** Регистрирует кошельки в реестре страницы и возвращает функцию отмены. */
export function registerFakeWallets(...wallets: Wallet[]): () => void {
  return getWallets().register(...wallets)
}
