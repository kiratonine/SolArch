import { useSyncExternalStore } from 'react'

import { detectWallets, onWalletsChange } from './registry'
import type { AvailableWallet } from './types'

/**
 * Список кошельков как внешнее хранилище.
 *
 * Расширения регистрируются асинхронно и могут появиться уже после первой отрисовки,
 * поэтому список нельзя прочитать один раз в `useEffect`. Снимок кешируется: React
 * сравнивает его по ссылке, а `detectWallets()` каждый раз собирает новый массив.
 */

let snapshot: AvailableWallet[] | null = null
let watching = false

function read(): AvailableWallet[] {
  if (!watching) {
    watching = true
    onWalletsChange(() => {
      snapshot = null
    })
  }

  snapshot ??= detectWallets()
  return snapshot
}

function subscribe(notify: () => void): () => void {
  return onWalletsChange(() => {
    snapshot = null
    notify()
  })
}

export function useWallets(): AvailableWallet[] {
  return useSyncExternalStore(subscribe, read, read)
}
