import { screen, waitFor, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { describe, expect, it } from 'vitest'

import { MOCK_CREATOR, db } from '@/mocks/db'
import { renderApp } from '@/test/render'

/**
 * Меню узкого экрана.
 *
 * Ниже `lg` навигации в строке шапки нет вовсе — она целиком уходит сюда, потому
 * что прятать её по одной ссылке стало нечего (F122). Тесты держат то, ради чего
 * меню и заводили: до каждой страницы можно дойти, и меню не остаётся висеть
 * над той, куда пришли.
 *
 * Ширину экрана тесты не изображают: в jsdom стилей нет, и оба вида навигации
 * лежат в дереве одновременно. Поэтому каждый запрос сужен до самого меню —
 * иначе он поймал бы ссылку из строки шапки и ничего бы не проверил.
 */

/** Открывает меню и возвращает его область. */
async function openMenu(): Promise<HTMLElement> {
  await userEvent.click(screen.getByRole('button', { name: 'Menu' }))
  return screen.getByRole('navigation', { name: 'Menu' })
}

describe('меню узкого экрана', () => {
  it('собирает в себе все страницы, доступные гостю', async () => {
    renderApp()
    await screen.findAllByRole('article')

    const menu = await openMenu()

    expect(within(menu).getByRole('link', { name: 'Catalog' })).toBeInTheDocument()
    expect(within(menu).getByRole('link', { name: 'How it works' })).toBeInTheDocument()
    expect(within(menu).getByRole('link', { name: 'Sign in' })).toBeInTheDocument()
  })

  it('доводит до страницы и закрывается за собой', async () => {
    renderApp()
    await screen.findAllByRole('article')

    const menu = await openMenu()
    await userEvent.click(within(menu).getByRole('link', { name: 'How it works' }))

    expect(await screen.findByRole('heading', { level: 1, name: 'How it works' })).toBeInTheDocument()
    await waitFor(() => {
      expect(screen.queryByRole('navigation', { name: 'Menu' })).not.toBeInTheDocument()
    })
  })

  it('отпускает по Escape и возвращает фокус на кнопку', async () => {
    renderApp()
    await screen.findAllByRole('article')

    await openMenu()
    await userEvent.keyboard('{Escape}')

    await waitFor(() => {
      expect(screen.queryByRole('navigation', { name: 'Menu' })).not.toBeInTheDocument()
    })
    // Меню закрыли с клавиатуры — человек должен остаться там, откуда открыл,
    // а не в начале страницы.
    expect(screen.getByRole('button', { name: 'Menu' })).toHaveFocus()
  })

  it('вошедшему автору показывает кабинет, выход и адрес кошелька', async () => {
    db.session = MOCK_CREATOR

    renderApp()
    await screen.findAllByRole('article')

    const menu = await openMenu()

    expect(within(menu).getByRole('link', { name: 'Dashboard' })).toBeInTheDocument()
    expect(within(menu).getByRole('button', { name: 'Sign out' })).toBeInTheDocument()
    expect(within(menu).getByTitle(MOCK_CREATOR.wallet)).toHaveTextContent('7xKX…gAsU')
    expect(within(menu).queryByRole('link', { name: 'Sign in' })).not.toBeInTheDocument()
  })

  it('выход из меню уводит на главную и закрывает меню', async () => {
    db.session = MOCK_CREATOR

    const { router } = renderApp({ path: '/dashboard' })
    await screen.findByRole('heading', { level: 1, name: 'Your archives' })

    const menu = await openMenu()
    await userEvent.click(within(menu).getByRole('button', { name: 'Sign out' }))

    // Меню остаётся открытым под вопросом: диалог живёт внутри него.
    const dialog = await screen.findByRole('dialog')
    await userEvent.click(within(dialog).getByRole('button', { name: 'Sign out' }))

    await waitFor(() => {
      expect(router.state.location.pathname).toBe('/')
    })
    await waitFor(() => {
      expect(screen.queryByRole('navigation', { name: 'Menu' })).not.toBeInTheDocument()
    })
  })

  it('называется по-русски вместе со всем остальным', async () => {
    renderApp({ locale: 'ru' })
    await screen.findAllByRole('article')

    await userEvent.click(screen.getByRole('button', { name: 'Меню' }))
    const menu = screen.getByRole('navigation', { name: 'Меню' })

    expect(within(menu).getByRole('link', { name: 'Как это работает' })).toBeInTheDocument()
  })
})
