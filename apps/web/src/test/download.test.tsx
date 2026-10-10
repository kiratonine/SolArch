import { screen, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { describe, expect, it } from 'vitest'

import { renderApp } from './render'

describe('Viewer download page', () => {
  it('opens directly with honest unavailable state and installation steps', async () => {
    renderApp({ path: '/download' })
    await screen.findByRole('heading', { level: 1, name: 'SolArch Viewer for Windows' })
    expect(screen.getByText('Windows 10 / 11 · x64')).toBeInTheDocument()
    expect(screen.getByText('0.1.0')).toBeInTheDocument()
    expect(screen.getByRole('button', { name: /Download for Windows/ })).toBeDisabled()
    expect(screen.getByRole('status')).toHaveTextContent('not available yet')
    expect(screen.getByText(/payment and activation happen inside the Viewer/)).toBeInTheDocument()
    expect(screen.getByText(/test USDC, not real money/)).toBeInTheDocument()
    expect(within(screen.getByRole('list')).getAllByRole('listitem')).toHaveLength(3)
  })

  it('has full RU copy', async () => {
    renderApp({ path: '/download', locale: 'ru' })
    await screen.findByRole('heading', { level: 1, name: 'SolArch Viewer для Windows' })
    expect(screen.getByRole('button', { name: /Скачать для Windows/ })).toBeDisabled()
    expect(screen.getByRole('status')).toHaveTextContent('Установщик пока недоступен')
    expect(screen.getByText(/оплата и активация происходят внутри Viewer/)).toBeInTheDocument()
  })

  it('is reachable from footer and mobile menu, which closes after navigation', async () => {
    const { router } = renderApp({ path: '/how-it-works' })
    await screen.findByRole('heading', { level: 1 })
    const footer = screen.getByRole('contentinfo')
    expect(within(footer).getByRole('link', { name: 'Get the Viewer' })).toHaveAttribute('href', '/download')
    await userEvent.click(screen.getByRole('button', { name: 'Menu' }))
    await userEvent.click(within(screen.getByRole('navigation', { name: 'Menu' })).getByRole('link', { name: 'Get the Viewer' }))
    await screen.findByRole('heading', { level: 1, name: 'SolArch Viewer for Windows' })
    expect(router.state.location.pathname).toBe('/download')
    expect(screen.queryByRole('navigation', { name: 'Menu' })).not.toBeInTheDocument()
  })
})
