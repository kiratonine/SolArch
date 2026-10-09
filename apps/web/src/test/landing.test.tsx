import { screen, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { describe, expect, it } from 'vitest'

import { renderApp } from './render'

describe('лендинг', () => {
  it('стоит на главной и ведёт в каталог', async () => {
    const { router } = renderApp({ path: '/' })

    expect(
      await screen.findByRole('heading', {
        level: 1,
        name: 'Files that open only after payment',
      }),
    ).toBeInTheDocument()

    await userEvent.click(screen.getByRole('link', { name: 'Browse the catalog' }))
    expect(router.state.location.pathname).toBe('/catalog')
    expect(await screen.findByRole('heading', { level: 1, name: 'Catalog' })).toBeInTheDocument()
  })

  it('кнопка установщика — заглушка, пока релиза нет', async () => {
    renderApp({ path: '/' })
    await screen.findByRole('heading', { level: 1 })

    const section = document.getElementById('download')!
    const button = within(section).getByRole('button', { name: /Download for Windows/ })
    expect(within(section).getByText('SolArch Viewer_0.1.0_x64-setup.exe')).toBeInTheDocument()

    await userEvent.click(button)
    expect(within(section).getByRole('status')).toHaveTextContent(
      'The installer is not published yet',
    )
  })

  it('говорит по-русски', async () => {
    renderApp({ path: '/', locale: 'ru' })

    expect(
      await screen.findByRole('heading', {
        level: 1,
        name: 'Файлы, которые открываются только после оплаты',
      }),
    ).toBeInTheDocument()
    expect(screen.getAllByRole('button', { name: /Скачать для Windows/ }).length).toBeGreaterThan(0)
  })
})
