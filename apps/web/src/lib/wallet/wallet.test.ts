import { afterEach, describe, expect, it } from 'vitest'

import { fakeWallet, registerFakeWallets } from '@/test/fake-wallet'
import { detectWallets } from './registry'

let unregister: (() => void) | undefined

afterEach(() => {
  unregister?.()
  unregister = undefined
})

describe('обнаружение кошельков', () => {
  it('находит кошелёк, объявивший себя в реестре страницы', () => {
    unregister = registerFakeWallets(fakeWallet({ name: 'Phantom' }))

    expect(detectWallets().map((wallet) => wallet.name)).toEqual(['Phantom'])
  })

  it('пропускает кошелёк, который не умеет подписывать сообщения', () => {
    unregister = registerFakeWallets(
      fakeWallet({ name: 'Signer' }),
      fakeWallet({ name: 'Transactions only', withoutSignMessage: true }),
    )

    expect(detectWallets().map((wallet) => wallet.name)).toEqual(['Signer'])
  })
})

describe('подключение и подпись', () => {
  it('отдаёт адрес счёта и подпись в base64', async () => {
    unregister = registerFakeWallets(
      fakeWallet({ address: 'So1anaAddress', signature: new Uint8Array([1, 2, 3, 4]) }),
    )

    const [wallet] = detectWallets()
    const connected = await wallet!.connect()

    expect(connected.address).toBe('So1anaAddress')
    expect(await connected.signMessage('Sign this message')).toBe('AQIDBA==')
  })

  it('отличает отказ человека от сбоя кошелька', async () => {
    unregister = registerFakeWallets(
      fakeWallet({
        onSignMessage: () => {
          // Так отказ от подписи выглядит со стороны расширения.
          throw Object.assign(new Error('User rejected the request'), { code: 4001 })
        },
      }),
    )

    const [wallet] = detectWallets()
    const connected = await wallet!.connect()

    await expect(connected.signMessage('Sign this message')).rejects.toMatchObject({
      declined: true,
    })
  })
})
