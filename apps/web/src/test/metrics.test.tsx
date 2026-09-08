import { render, screen, within } from '@testing-library/react'
import { HttpResponse, http } from 'msw'
import { describe, expect, it } from 'vitest'

import { ArchiveCard } from '@/components/archive/archive-card'
import { MetricGrid } from '@/components/archive/metric-grid'
import { API_BASE_URL, API_PREFIX } from '@/lib/api/config'
import type { MarketplaceArchiveListItem } from '@/lib/api'
import { server } from '@/mocks/node'
import { renderApp, renderWithRouter } from '@/test/render'

/**
 * Публичные метрики — продуктовая константа, а не решение экрана:
 *
 * ```text
 * public metrics = views · downloads · paid_unlocks
 * ```
 *
 * Из этого следуют два запрета, которые до сих пор нигде не были удержаны тестом.
 *
 * Первый: фронт метрики не считает. Ни одной производной величины на публичных
 * экранах быть не может — ни конверсии, ни выручки, ни «в среднем за день».
 * Всё, что похоже на арифметику, приходит с backend посчитанным (`docs/API.md`),
 * и единственное, что делает страница, — раскладывает числа по разрядам локали.
 *
 * Второй: четвёртой метрики не существует. Появись она — это молчаливое
 * изменение общего контракта, а его менять молча нельзя.
 */

const ARCHIVE: MarketplaceArchiveListItem = {
  archive_id: 'arc_solana_course',
  slug: 'solana-program-security',
  title: 'Solana Program Security',
  short_description: 'Audits, checklists and report templates.',
  cover_url: null,
  creator: { display_name: 'Aurora Labs' },
  price: { amount: '49.00', currency: 'USDC' },
  file_count: 4,
  size_bytes: 3_760_000,
  metrics: { views: 18_420, downloads: 4_210, paid_unlocks: 612 },
}

interface MetricCell {
  value: string
  label: string
}

/** Ячейки манифеста в порядке разметки. */
function readMetrics(list: HTMLElement): MetricCell[] {
  return Array.from(list.querySelectorAll('div')).map((cell) => ({
    value: cell.querySelector('dd')?.textContent ?? '',
    label: cell.querySelector('dt')?.textContent ?? '',
  }))
}

/** Значение метрики по подписи. Отсутствие подписи — тоже провал теста. */
function metric(cells: MetricCell[], label: string): string {
  const found = cells.find((cell) => cell.label === label)
  if (!found) throw new Error(`В манифесте нет метрики «${label}»`)
  return found.value
}

/** Единственный манифест на странице. */
function manifest(root: ParentNode = document): HTMLElement {
  const list = root.querySelector('dl')
  if (!list) throw new Error('На экране нет манифеста')
  return list
}

describe('MetricGrid', () => {
  it('печатает значения ровно так, как их дали: он не считает и не форматирует', () => {
    const { container } = render(
      <MetricGrid
        items={[
          { value: '18 420', label: 'просмотра' },
          { value: '0', label: 'открытий' },
        ]}
      />,
    )

    // Ноль остаётся нулём, а не превращается в прочерк: это тоже показание.
    expect(readMetrics(manifest(container))).toEqual([
      { value: '18 420', label: 'просмотра' },
      { value: '0', label: 'открытий' },
    ])
  })

  it('в разметке подпись идёт перед числом, а на экране — под ним', () => {
    const { container } = render(<MetricGrid items={[{ value: '612', label: 'unlocks' }]} />)

    const cell = container.querySelector('dl > div')
    if (!cell) throw new Error('MetricGrid не отдал ячейку')

    // `dt` перед `dd` — требование HTML: скринридер читает «unlocks — 612».
    // Глазу порядок переворачивает `flex-col-reverse`, разметку он не трогает.
    expect(Array.from(cell.children).map((child) => child.tagName)).toEqual(['DT', 'DD'])
    expect(cell.className).toContain('flex-col-reverse')
  })
})

describe('публичные метрики в каталоге', () => {
  it('карточка показывает открытия — ту метрику, ради которой каталог сортируют', async () => {
    renderWithRouter(<ArchiveCard archive={ARCHIVE} />)

    const card = await screen.findByRole('article')
    expect(readMetrics(manifest(card))).toEqual([
      { value: '4', label: 'files' },
      { value: '3.8 MB', label: 'size' },
      { value: '612', label: 'unlocks' },
    ])
  })

  it('карточка не считает ничего сама: ни доли, ни конверсии, ни суммы', async () => {
    renderWithRouter(<ArchiveCard archive={ARCHIVE} />)
    await screen.findByRole('article')

    // 612 / 4210 ≈ 14.5 % — конверсия, которую посчитал бы фронт, если бы взялся.
    expect(screen.queryByText(/%/)).toBeNull()
    // 612 × 49.00 = 29 988 — выручка, которой на публичном экране быть не может.
    expect(screen.queryByText(/29,988|29988/)).toBeNull()
    // Цена стоит строкой backend и в арифметику метрик не входит.
    expect(screen.getByText('49.00')).toBeInTheDocument()
  })

  it('разряды разделяются по правилам локали, а число остаётся тем же', async () => {
    renderWithRouter(<ArchiveCard archive={{ ...ARCHIVE, file_count: 18_420 }} />, {
      locale: 'ru',
    })

    const card = await screen.findByRole('article')
    // В русской локали разделитель — неразрывный пробел, а не запятая.
    expect(within(card).getByText('18 420')).toBeInTheDocument()
    expect(within(card).queryByText('18,420')).toBeNull()
  })
})

describe('публичные метрики на странице архива', () => {
  it('показывает все три метрики контракта и ни одной сверх них', async () => {
    renderApp({ path: '/archives/solana-program-security' })
    await screen.findByRole('heading', { level: 1 })

    const rows = readMetrics(manifest())

    // Ровно пять ячеек: опись архива и три публичные метрики. Шестая означала бы,
    // что на публичный экран просочилось что-то, чего в контракте нет.
    expect(rows.map((cell) => cell.label)).toEqual([
      'files',
      'size',
      'views',
      'downloads',
      'unlocks',
    ])
    expect(metric(rows, 'files')).toBe('6')
    expect(metric(rows, 'size')).toBe('4 MB')

    // Просмотры — единственная метрика, которую нельзя сверить с фикстурой:
    // открытие этой страницы само по себе событие `archive_view`, и мок его
    // засчитывает (`docs/TESTING.md` §10). Проверяем поэтому не число, а то,
    // что число вообще пришло и разложено по разрядам локали.
    expect(metric(rows, 'views')).toMatch(/^18,4\d\d$/)

    // Скачивания и открытия визит не меняет — их сверяем с фикстурой точно.
    expect(metric(rows, 'downloads')).toBe('4,210')
    expect(metric(rows, 'unlocks')).toBe('612')
  })

  it('метрики берутся из ответа целиком, включая нули', async () => {
    server.use(
      http.get(`${API_BASE_URL}${API_PREFIX}/marketplace/archives/:slug`, () =>
        HttpResponse.json({
          archive_id: 'arc_fresh',
          slug: 'fresh-archive',
          title: 'Fresh Archive',
          short_description: 'short',
          description: 'description',
          cover_url: null,
          creator: { display_name: 'Creator' },
          price: { amount: '1.00', currency: 'USDC' },
          file_count: 1,
          size_bytes: 1024,
          metrics: { views: 3, downloads: 0, paid_unlocks: 0 },
          license_policy: { max_devices: 1, allow_export: false, watermark_enabled: true },
          marketplace_status: 'published',
          download_available: true,
        }),
      ),
    )

    renderApp({ path: '/archives/fresh-archive' })
    await screen.findByRole('heading', { level: 1, name: 'Fresh Archive' })

    // Ни один ноль не спрятан и не заменён прочерком: архив только что вышел,
    // и это его честное состояние, а не отсутствие данных. Просмотры здесь
    // сверяются точно: обработчик подменён, и счётчик мока их уже не трогает.
    expect(readMetrics(manifest())).toEqual([
      { value: '1', label: 'file' },
      { value: '1 kB', label: 'size' },
      { value: '3', label: 'views' },
      { value: '0', label: 'downloads' },
      { value: '0', label: 'unlocks' },
    ])
  })

  it('не показывает гостю ничего из аналитики автора', async () => {
    renderApp({ path: '/archives/solana-program-security' })
    await screen.findByRole('heading', { level: 1 })

    // Всё это существует — но за guard'ом `/dashboard`, а не на публичной странице.
    expect(screen.queryByText(/of views ended in a download/)).toBeNull()
    expect(screen.queryByText(/of downloads ended in a paid unlock/)).toBeNull()
    expect(screen.queryByText(/Revenue/)).toBeNull()
    expect(screen.queryByText(/Your share/)).toBeNull()
    expect(screen.queryByText(/SolArch fee/)).toBeNull()
  })
})
