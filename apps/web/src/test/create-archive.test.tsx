import { screen, waitFor, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { HttpResponse, http } from 'msw'
import { describe, expect, it } from 'vitest'

import { API_BASE_URL, API_PREFIX } from '@/lib/api/config'
import { MOCK_CREATOR, db } from '@/mocks/db'
import { server } from '@/mocks/node'
import { renderApp } from '@/test/render'

/**
 * Создание архива.
 *
 * Проверяется настоящий путь: guard пропускает вошедшего, форма собирает тело
 * запроса по контракту, мок замораживает экономику и отдаёт `archive_id`, автор
 * попадает на страницу созданного архива — туда, где у архива появятся файлы.
 */

describe('создание архива', () => {
  it('создаёт архив и ведёт автора к загрузке файлов', async () => {
    db.session = MOCK_CREATOR
    const user = userEvent.setup()

    const { router } = renderApp({ path: '/dashboard/new' })

    await user.type(await screen.findByLabelText('Title'), 'Field Notes on Rust')
    await user.type(screen.getByLabelText('Short description'), 'Twelve evenings of FFI')
    await user.type(screen.getByLabelText('Price'), '12.50')

    await user.click(screen.getByRole('button', { name: 'Create archive' }))

    // Адрес страницы — id, который вернул backend: своего архив ещё не знает.
    await waitFor(() => {
      expect(router.state.location.pathname).toBe(`/dashboard/${db.archives[0]?.archive_id}`)
    })
    expect(
      await screen.findByRole('heading', { name: 'Field Notes on Rust', level: 1 }),
    ).toBeInTheDocument()
    // Пустой архив открывается там, где его наполняют.
    expect(screen.getByRole('button', { name: 'Choose files' })).toBeInTheDocument()

    // Мок — это backend: смотрим, что до него доехало.
    expect(db.archives[0]).toMatchObject({
      title: 'Field Notes on Rust',
      short_description: 'Twelve evenings of FFI',
      price: { currency: 'USDC', amount: '12.50' },
      creator_payout_wallet: MOCK_CREATOR.wallet,
      license_policy: { max_devices: 1, allow_export: false, watermark_enabled: true },
    })
  })

  it('подставляет кошелёк, которым автор вошёл', async () => {
    db.session = MOCK_CREATOR

    renderApp({ path: '/dashboard/new' })

    expect(await screen.findByLabelText('Payout wallet')).toHaveValue(MOCK_CREATOR.wallet)
  })

  it('уносит в запрос выбранные условия лицензии', async () => {
    db.session = MOCK_CREATOR
    const user = userEvent.setup()

    renderApp({ path: '/dashboard/new' })

    await user.type(await screen.findByLabelText('Title'), 'Archive Scans 1998')
    await user.type(screen.getByLabelText('Short description'), 'Contact sheets')
    await user.type(screen.getByLabelText('Price'), '4')
    await user.click(screen.getByLabelText('Let buyers export files'))
    await user.click(screen.getByLabelText('Stamp a watermark'))

    await user.click(screen.getByRole('button', { name: 'Create archive' }))

    await waitFor(() => {
      expect(db.archives[0]).toMatchObject({
        title: 'Archive Scans 1998',
        license_policy: { max_devices: 1, allow_export: true, watermark_enabled: false },
      })
    })
  })
})

describe('путь к форме', () => {
  it('ведёт в форму из кабинета', async () => {
    db.session = MOCK_CREATOR
    const user = userEvent.setup()

    const { router } = renderApp({ path: '/dashboard' })

    await user.click(await screen.findByRole('link', { name: 'New archive' }))

    await waitFor(() => {
      expect(router.state.location.pathname).toBe('/dashboard/new')
    })
  })

  it('зовёт создать первый архив, когда их нет', async () => {
    db.session = MOCK_CREATOR
    db.archives = []

    renderApp({ path: '/dashboard' })

    expect(await screen.findByRole('heading', { name: 'No archives yet' })).toBeInTheDocument()
    // Ссылка ведёт на страницу «New archive», и названа она так же: создаёт архив
    // кнопка на форме, а не эта ссылка.
    expect(screen.getAllByRole('link', { name: 'New archive' })).toHaveLength(2)
  })
})

describe('проверка формы', () => {
  it('называет незаполненные поля и не идёт на сервер', async () => {
    db.session = MOCK_CREATOR
    const user = userEvent.setup()
    const before = db.archives.length

    const { router } = renderApp({ path: '/dashboard/new' })

    await user.click(await screen.findByRole('button', { name: 'Create archive' }))

    expect(await screen.findByText('Name the archive.')).toBeInTheDocument()
    expect(screen.getByText('Write the line that goes under the title.')).toBeInTheDocument()
    expect(screen.getByText('Set the price.')).toBeInTheDocument()

    expect(db.archives).toHaveLength(before)
    expect(router.state.location.pathname).toBe('/dashboard/new')
  })

  it('ставит фокус на первое незаполненное поле', async () => {
    db.session = MOCK_CREATOR
    const user = userEvent.setup()

    renderApp({ path: '/dashboard/new' })

    await user.click(await screen.findByRole('button', { name: 'Create archive' }))

    expect(screen.getByLabelText('Title')).toHaveFocus()
  })

  it('убирает ошибку, как только её исправили', async () => {
    db.session = MOCK_CREATOR
    const user = userEvent.setup()

    renderApp({ path: '/dashboard/new' })

    await user.click(await screen.findByRole('button', { name: 'Create archive' }))
    expect(await screen.findByText('Name the archive.')).toBeInTheDocument()

    await user.type(screen.getByLabelText('Title'), 'Anything')

    await waitFor(() => {
      expect(screen.queryByText('Name the archive.')).toBeNull()
    })
  })

  it('не отправляет чужую строку вместо адреса выплат', async () => {
    db.session = MOCK_CREATOR
    const user = userEvent.setup()
    const before = db.archives.length

    renderApp({ path: '/dashboard/new' })

    await user.type(await screen.findByLabelText('Title'), 'Field Notes on Rust')
    await user.type(screen.getByLabelText('Short description'), 'Twelve evenings of FFI')
    await user.type(screen.getByLabelText('Price'), '12.50')

    const wallet = screen.getByLabelText('Payout wallet')
    await user.clear(wallet)
    await user.type(wallet, '0x71C7656EC7ab88b098defB751B7401B5f6d8976F')

    await user.click(screen.getByRole('button', { name: 'Create archive' }))

    expect(await screen.findByText('This is not a Solana address.')).toBeInTheDocument()
    expect(db.archives).toHaveLength(before)
  })
})

describe('экономика на форме', () => {
  it('показывает долю автора по введённой цене и предупреждает о неизменности', async () => {
    db.session = MOCK_CREATOR
    const user = userEvent.setup()

    renderApp({ path: '/dashboard/new' })

    await user.type(await screen.findByLabelText('Price'), '10.00')

    const breakdown = screen.getByRole('heading', { name: 'How the price splits' }).parentElement
    expect(breakdown).not.toBeNull()
    expect(await within(breakdown as HTMLElement).findByText('9.50')).toBeInTheDocument()
    expect(within(breakdown as HTMLElement).getByText('0.50')).toBeInTheDocument()

    expect(
      screen.getByText(
        'The price is fixed when the archive is created and cannot be changed later.',
      ),
    ).toBeInTheDocument()
  })

  it('пересчитывает долю, пока цену правят', async () => {
    db.session = MOCK_CREATOR
    const user = userEvent.setup()

    renderApp({ path: '/dashboard/new' })

    const price = await screen.findByLabelText('Price')
    await user.type(price, '10.00')
    await screen.findByText('9.50')

    await user.clear(price)
    await user.type(price, '200')

    expect(await screen.findByText('190.00')).toBeInTheDocument()
  })
})

describe('отказ backend', () => {
  it('показывает отказ у поля и не теряет введённое', async () => {
    db.session = MOCK_CREATOR
    const user = userEvent.setup()

    server.use(
      http.post(`${API_BASE_URL}${API_PREFIX}/archives`, () =>
        HttpResponse.json(
          { code: 'INVALID_PAYOUT_WALLET', message: 'Кошелёк не принимает USDC' },
          { status: 400 },
        ),
      ),
    )

    renderApp({ path: '/dashboard/new' })

    await user.type(await screen.findByLabelText('Title'), 'Field Notes on Rust')
    await user.type(screen.getByLabelText('Short description'), 'Twelve evenings of FFI')
    await user.type(screen.getByLabelText('Price'), '12.50')

    await user.click(screen.getByRole('button', { name: 'Create archive' }))

    expect(await screen.findByText('Кошелёк не принимает USDC')).toBeInTheDocument()
    // Форма осталась заполненной: набирать всё заново из-за отказа сервера нельзя.
    expect(screen.getByLabelText('Title')).toHaveValue('Field Notes on Rust')
    expect(screen.getByLabelText('Price')).toHaveValue('12.50')
  })
})
