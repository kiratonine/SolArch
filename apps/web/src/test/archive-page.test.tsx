import { screen } from '@testing-library/react'
import { describe, expect, it } from 'vitest'

import { renderApp } from '@/test/render'

/**
 * Публичная страница архива глазами гостя: ни сессии, ни оплаты в браузере.
 * Единственное действие здесь — забрать `.slr`.
 */
describe('страница архива', () => {
  it('показывает архив и ссылку на скачивание .slr', async () => {
    renderApp({ path: '/archives/solana-program-security' })

    expect(
      await screen.findByRole('heading', { level: 1, name: 'Solana Program Security' }),
    ).toBeInTheDocument()
    expect(screen.getByText('49.00')).toBeInTheDocument()
    expect(screen.getByText('by Aurora Labs')).toBeInTheDocument()

    const download = screen.getByRole('link', { name: 'Download .slr' })
    expect(download).toHaveAttribute(
      'href',
      expect.stringContaining('/v1/marketplace/archives/solana-program-security/download'),
    )
    expect(download).toHaveAttribute('download', 'solana-program-security.slr')
  })

  it('говорит, что скачивание бесплатно, а открывает архив Viewer', async () => {
    renderApp({ path: '/archives/nebula-brand-kit' })

    expect(await screen.findByText('Free to download')).toBeInTheDocument()
    expect(screen.getByText('Opens in the SolArch Viewer after payment')).toBeInTheDocument()
  })

  it('не выдаёт закрытые поля автора', async () => {
    renderApp({ path: '/archives/solana-program-security' })
    await screen.findByRole('heading', { level: 1 })

    // Payout wallet и экономика в публичный ответ не попадают вовсе — на экране
    // им взяться неоткуда, и это стоит удерживать тестом.
    expect(screen.queryByText(/7xKXtg2CW87d97TXJSDpbD5jBkheTqA83TZRuJosgAsU/)).toBeNull()
    expect(screen.queryByText(/SolArch fee/)).toBeNull()
  })

  it('показывает отсутствующий архив как недоступный, а не как сбой', async () => {
    renderApp({ path: '/archives/такого-нет' })

    expect(
      await screen.findByRole('heading', { name: 'This archive is not available' }),
    ).toBeInTheDocument()
    expect(screen.getByRole('link', { name: 'Back to the catalog' })).toHaveAttribute('href', '/')
    // Красная плашка ошибки — это про сбой сети или сервера, а не про снятый архив.
    expect(screen.queryByRole('alert')).toBeNull()
  })

  it('переводит страницу на русский', async () => {
    renderApp({ path: '/archives/quant-trading-journal', locale: 'ru' })

    expect(await screen.findByRole('link', { name: 'Скачать .slr' })).toBeInTheDocument()
    expect(screen.getByText('Скачивание бесплатно')).toBeInTheDocument()
  })
})
