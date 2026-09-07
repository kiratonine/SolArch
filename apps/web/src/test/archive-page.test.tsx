import { screen, within } from '@testing-library/react'
import { HttpResponse, http } from 'msw'
import { describe, expect, it } from 'vitest'

import { API_BASE_URL, API_PREFIX } from '@/lib/api/config'
import { server } from '@/mocks/node'
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

  it('говорит, что скачивание бесплатно, а платят в Viewer и не в браузере', async () => {
    renderApp({ path: '/archives/nebula-brand-kit' })

    expect(await screen.findByText('Free to download')).toBeInTheDocument()
    // Цена в объяснении — та же строка, что пришла с backend, без пересчёта.
    expect(
      screen.getByText(/You pay 19\.00 USDC later, inside the SolArch Viewer/),
    ).toBeInTheDocument()
    expect(screen.getByText(/never in this browser/)).toBeInTheDocument()
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
    expect(await screen.findByRole('heading', { name: 'Содержимое' })).toBeInTheDocument()
    expect(screen.getByRole('heading', { name: 'Что даёт оплата' })).toBeInTheDocument()
    expect(screen.getByText('Одно устройство')).toBeInTheDocument()
  })
})

/**
 * Опись содержимого: что именно гость узнаёт о запечатанном контейнере,
 * не открывая его.
 */
describe('опись файлов', () => {
  it('показывает имена и веса файлов, сгруппированные по папкам', async () => {
    renderApp({ path: '/archives/solana-program-security' })

    expect(await screen.findByRole('heading', { name: 'Contents' })).toBeInTheDocument()

    // Файл в корне идёт первым и заголовка папки не получает.
    expect(await screen.findByText('read-me-first.pdf')).toBeInTheDocument()

    // Заголовок папки несёт путь и её состав.
    expect(await screen.findByText('security/')).toBeInTheDocument()
    expect(screen.getByText('security/checklists/')).toBeInTheDocument()
    expect(screen.getByText('3 files')).toBeInTheDocument()
    expect(screen.getByText('2 files')).toBeInTheDocument()

    expect(screen.getByText('00-intro.pdf')).toBeInTheDocument()
    expect(screen.getByText('audit-checklist.xlsx')).toBeInTheDocument()

    // Вес файла: 820 KiB в описи, десятичные единицы CLDR в выводе.
    expect(screen.getByText('840 kB')).toBeInTheDocument()
  })

  it('не выдаёт ничего сверх публичных полей', async () => {
    renderApp({ path: '/archives/solana-program-security' })
    await screen.findByText('read-me-first.pdf')

    // Полный путь виден только заголовком папки; строк вида «security/00-intro.pdf»
    // на экране нет, как нет и storage keys, хешей и encryption metadata.
    expect(screen.queryByText('security/00-intro.pdf')).toBeNull()
    expect(screen.queryByText(/application\/pdf/)).toBeNull()
  })

  it('переживает сбой списка файлов, не роняя страницу', async () => {
    server.use(
      http.get(`${API_BASE_URL}${API_PREFIX}/marketplace/archives/:slug/files`, () =>
        HttpResponse.json({ code: 'INTERNAL', message: 'boom' }, { status: 500 }),
      ),
    )

    renderApp({ path: '/archives/solana-program-security' })

    // Описание, цена и кнопка остаются на месте: сломался список, а не архив.
    expect(await screen.findByRole('link', { name: 'Download .slr' })).toBeInTheDocument()
    expect(
      await screen.findByText('The file list did not load. The archive itself is fine.'),
    ).toBeInTheDocument()
  })
})

/** Условия открытия: что даёт оплата. Гость обязан узнать это до скачивания. */
describe('условия лицензии', () => {
  it('переводит license_policy на человеческий язык', async () => {
    renderApp({ path: '/archives/solana-program-security' })

    const terms = (await screen.findByRole('heading', { name: 'What paying gives you' }))
      .parentElement
    expect(terms).not.toBeNull()

    expect(within(terms as HTMLElement).getByText('One device')).toBeInTheDocument()
    expect(within(terms as HTMLElement).getByText('No export')).toBeInTheDocument()
    expect(within(terms as HTMLElement).getByText('Watermarked')).toBeInTheDocument()
  })

  it('молчит о водяном знаке, когда его нет', async () => {
    server.use(
      http.get(`${API_BASE_URL}${API_PREFIX}/marketplace/archives/:slug`, () =>
        HttpResponse.json({
          archive_id: 'arc_plain',
          slug: 'plain-archive',
          title: 'Plain Archive',
          short_description: 'short',
          description: 'description',
          cover_url: null,
          creator: { display_name: 'Creator' },
          price: { amount: '1.00', currency: 'USDC' },
          file_count: 0,
          size_bytes: 0,
          metrics: { views: 0, downloads: 0, paid_unlocks: 0 },
          license_policy: { max_devices: 3, allow_export: true, watermark_enabled: false },
          marketplace_status: 'published',
          download_available: true,
        }),
      ),
    )

    renderApp({ path: '/archives/plain-archive' })

    expect(await screen.findByText('3 devices')).toBeInTheDocument()
    expect(screen.getByText('Export allowed')).toBeInTheDocument()
    expect(screen.queryByText('Watermarked')).toBeNull()
    expect(screen.queryByText('No export')).toBeNull()
  })
})

describe('обложка', () => {
  it('показывает обложку, когда автор её дал', async () => {
    renderApp({ path: '/archives/nebula-brand-kit' })
    await screen.findByRole('heading', { level: 1 })

    // Обложка декоративна: заголовок стоит прямо над ней, поэтому alt пустой
    // и в дерево доступности картинка не попадает.
    const cover = document.querySelector('img[alt=""]')
    expect(cover).not.toBeNull()
    expect(cover?.getAttribute('src')).toMatch(/^data:image\/svg\+xml,/)
  })

  it('не рисует пустую рамку, когда обложки нет', async () => {
    renderApp({ path: '/archives/solana-program-security' })
    await screen.findByRole('heading', { level: 1 })

    expect(document.querySelector('img[alt=""]')).toBeNull()
  })
})
