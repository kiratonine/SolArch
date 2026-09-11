import { screen, waitFor, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { afterEach, describe, expect, it } from 'vitest'

import { fakeWallet, registerFakeWallets } from '@/test/fake-wallet'
import { queryKeys } from '@/lib/api'
import { MOCK_CREATOR, db } from '@/mocks/db'
import { renderApp } from '@/test/render'
import { signIn } from '@/test/session'

/**
 * Вход автора целиком: настоящее дерево маршрутов, настоящий API-клиент, MSW вместо
 * сети и настоящий реестр Wallet Standard, в который тест объявляет себя так же,
 * как это делает расширение кошелька.
 */

let unregister: (() => void) | undefined

afterEach(() => {
  unregister?.()
  unregister = undefined
})

describe('доступ в кабинет', () => {
  it('уводит гостя на вход и запоминает, куда он шёл', async () => {
    const { router } = renderApp({ path: '/dashboard' })

    await waitFor(() => {
      expect(router.state.location.pathname).toBe('/login')
    })
    expect(router.state.location.search).toMatchObject({ redirect: '/dashboard' })
  })
})

describe('страница входа', () => {
  it('показывает установленные кошельки', async () => {
    unregister = registerFakeWallets(fakeWallet({ name: 'Phantom' }), fakeWallet({ name: 'Solflare' }))

    renderApp({ path: '/login' })

    expect(await screen.findByRole('button', { name: /Phantom/ })).toBeInTheDocument()
    expect(screen.getByRole('button', { name: /Solflare/ })).toBeInTheDocument()
  })

  it('ведёт через сообщение к подписи и возвращает туда, куда человек шёл', async () => {
    const user = userEvent.setup()
    unregister = registerFakeWallets(
      fakeWallet({ name: 'Phantom', address: '7xKXtg2CW87d97TXJSDpbD5jBkheTqA83TZRuJosgAsU' }),
    )

    const { router } = renderApp({ path: '/dashboard' })

    await user.click(await screen.findByRole('button', { name: /Phantom/ }))

    // Человек видит текст целиком до того, как кошелёк попросит подпись.
    expect(
      await screen.findByText(/Sign this message to authenticate with SolArch/),
    ).toBeInTheDocument()

    await user.click(screen.getByRole('button', { name: 'Sign the message' }))

    await waitFor(() => {
      expect(router.state.location.pathname).toBe('/dashboard')
    })
  })

  it('спокойно говорит об отказе подписать и даёт подписать снова', async () => {
    const user = userEvent.setup()
    unregister = registerFakeWallets(
      fakeWallet({
        name: 'Phantom',
        onSignMessage: () => {
          throw Object.assign(new Error('User rejected the request'), { code: 4001 })
        },
      }),
    )

    renderApp({ path: '/login' })

    await user.click(await screen.findByRole('button', { name: /Phantom/ }))
    await user.click(await screen.findByRole('button', { name: 'Sign the message' }))

    expect(await screen.findByText(/Phantom did not sign the message/)).toBeInTheDocument()
    expect(screen.getByRole('button', { name: 'Sign the message' })).toBeEnabled()
  })

  it('объясняет, что делать, когда кошелька в браузере нет', async () => {
    renderApp({ path: '/login' })

    expect(await screen.findByText('No Solana wallet in this browser')).toBeInTheDocument()
  })

  it('не уводит на чужой сайт по подсунутому адресу возврата', async () => {
    const user = userEvent.setup()
    unregister = registerFakeWallets(fakeWallet({ name: 'Phantom' }))

    const { router } = renderApp({ path: '/login?redirect=https://evil.example' })

    await user.click(await screen.findByRole('button', { name: /Phantom/ }))
    await user.click(await screen.findByRole('button', { name: 'Sign the message' }))

    await waitFor(() => {
      expect(router.state.location.pathname).toBe('/dashboard')
    })
  })
})

describe('сессия автора', () => {
  it('показывает кошелёк в шапке и выпускает по кнопке выхода', async () => {
    const user = userEvent.setup()
    signIn()

    const { router } = renderApp({ path: '/dashboard' })

    // Короткий адрес — то, по чему человек узнаёт свой кошелёк среди прочих.
    // Ищем именно в шапке: полный адрес есть ещё и на странице кабинета.
    const header = await screen.findByRole('banner')
    expect(within(header).getByTitle(MOCK_CREATOR.wallet)).toHaveTextContent('7xKX…gAsU')

    await user.click(screen.getByRole('button', { name: 'Sign out' }))

    // Выход спрашивает подтверждение: одного нажатия недостаточно.
    const dialog = await screen.findByRole('dialog')
    await user.click(within(dialog).getByRole('button', { name: 'Sign out' }))

    await waitFor(() => {
      expect(router.state.location.pathname).toBe('/')
    })
    expect(screen.getByRole('link', { name: 'Sign in' })).toBeInTheDocument()
  })

  it('не выпускает по случайному нажатию: выход спрашивает подтверждение', async () => {
    const user = userEvent.setup()
    signIn()

    const { router } = renderApp({ path: '/dashboard' })

    await user.click(await screen.findByRole('button', { name: 'Sign out' }))

    const dialog = await screen.findByRole('dialog')
    await user.click(within(dialog).getByRole('button', { name: 'Stay signed in' }))

    await waitFor(() => {
      expect(screen.queryByRole('dialog')).not.toBeInTheDocument()
    })
    expect(router.state.location.pathname).toBe('/dashboard')
    expect(db.session).toEqual(MOCK_CREATOR)
  })

  it('отпускает вопрос по клику мимо и по Escape, оставляя сессию', async () => {
    const user = userEvent.setup()
    signIn()

    renderApp({ path: '/dashboard' })

    await user.click(await screen.findByRole('button', { name: 'Sign out' }))
    await screen.findByRole('dialog')

    // Клик мимо — это «нет». Требовать за него отдельного нажатия не за что.
    const backdrop = document.querySelector('[data-slot="dialog-backdrop"]')
    expect(backdrop).not.toBeNull()
    await user.click(backdrop as HTMLElement)

    await waitFor(() => {
      expect(screen.queryByRole('dialog')).not.toBeInTheDocument()
    })
    expect(db.session).toEqual(MOCK_CREATOR)

    await user.click(screen.getByRole('button', { name: 'Sign out' }))
    await screen.findByRole('dialog')
    await user.keyboard('{Escape}')

    await waitFor(() => {
      expect(screen.queryByRole('dialog')).not.toBeInTheDocument()
    })
    expect(db.session).toEqual(MOCK_CREATOR)
  })

  it('не держит вошедшего автора на странице входа', async () => {
    signIn()

    const { router } = renderApp({ path: '/login' })

    await waitFor(() => {
      expect(router.state.location.pathname).toBe('/dashboard')
    })
  })

  it('выводит из кабинета, когда сессия перестала действовать', async () => {
    signIn()

    const { router, queryClient } = renderApp({ path: '/dashboard' })
    await screen.findByRole('heading', { name: 'Your archives' })

    // Так выглядит просроченная сессия: 401 обнулил её в кеше (см. query-client).
    db.session = null
    queryClient.setQueryData(queryKeys.session, null)
    await router.invalidate()

    await waitFor(() => {
      expect(router.state.location.pathname).toBe('/login')
    })
  })

  it('говорит с автором по-русски', async () => {
    renderApp({ path: '/login', locale: 'ru' })

    expect(await screen.findByRole('heading', { name: 'Вход по кошельку' })).toBeInTheDocument()
  })
})
