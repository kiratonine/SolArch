import { SolanaSignMessage, type SolanaSignMessageFeature } from '@solana/wallet-standard-features'
import type { Wallet, WalletAccount, WalletWithFeatures } from '@wallet-standard/base'
import { StandardConnect, type StandardConnectFeature } from '@wallet-standard/features'

import { WalletError } from './errors'
import type { AvailableWallet, ConnectedWallet } from './types'

/**
 * Перевод кошелька из Wallet Standard в интерфейс приложения.
 *
 * Здесь единственное место, где приложение знает про фичи `standard:connect`
 * и `solana:signMessage`.
 */

type SigningWallet = WalletWithFeatures<StandardConnectFeature & SolanaSignMessageFeature>

/** Кошелёк подходит, если умеет подключаться и подписывать сообщения. */
function canSignMessages(wallet: Wallet): wallet is SigningWallet {
  return StandardConnect in wallet.features && SolanaSignMessage in wallet.features
}

export function toAvailableWallet(wallet: Wallet): AvailableWallet | null {
  if (!canSignMessages(wallet)) return null

  return {
    id: wallet.name,
    name: wallet.name,
    icon: wallet.icon,
    connect: () => connect(wallet),
  }
}

async function connect(wallet: SigningWallet): Promise<ConnectedWallet> {
  const { accounts } = await run(() => wallet.features[StandardConnect].connect())
  const account = accounts[0]

  if (!account) {
    throw new WalletError(`${wallet.name} returned no account`, { declined: false })
  }

  return {
    name: wallet.name,
    icon: wallet.icon,
    address: account.address,
    signMessage: (message) => signMessage(wallet, account, message),
  }
}

async function signMessage(
  wallet: SigningWallet,
  account: WalletAccount,
  message: string,
): Promise<string> {
  const [output] = await run(() =>
    wallet.features[SolanaSignMessage].signMessage({
      account,
      message: new TextEncoder().encode(message),
    }),
  )

  if (!output) {
    throw new WalletError(`${wallet.name} returned no signature`, { declined: false })
  }

  return toBase64(output.signature)
}

/**
 * Любой сбой расширения приводится к `WalletError`.
 *
 * Отказ подписать — не ошибка приложения, а решение человека, и говорить о нём
 * надо иначе, чем о сломанном кошельке.
 */
async function run<T>(action: () => Promise<T>): Promise<T> {
  try {
    return await action()
  } catch (error) {
    throw new WalletError(errorMessage(error), { declined: isDeclined(error), cause: error })
  }
}

/** Отказ пользователя: EIP-1193 `4001` — общее место у расширений; текст — запасной признак. */
function isDeclined(error: unknown): boolean {
  if (typeof error !== 'object' || error === null) return false
  if ('code' in error && error.code === 4001) return true
  return /reject|denied|declin|cancel/i.test(errorMessage(error))
}

function errorMessage(error: unknown): string {
  return error instanceof Error ? error.message : String(error)
}

/** `docs/API.md` §2 принимает подпись в base58 или base64; base64 не требует зависимостей. */
function toBase64(bytes: Uint8Array): string {
  let binary = ''
  for (const byte of bytes) binary += String.fromCharCode(byte)
  return btoa(binary)
}
