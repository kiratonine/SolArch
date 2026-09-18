import { render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { afterEach, describe, expect, it, vi } from 'vitest'

import { ArchiveCard } from '@/components/archive/archive-card'
import { WalletAddress } from '@/components/auth/wallet-address'
import { LanguageSwitch } from '@/components/layout/language-switch'
import { I18nProvider, useI18n } from '@/lib/i18n'
import { PriceBreakdown } from '@/components/archive/price-breakdown'
import { StatusBadge } from '@/components/archive/status-badge'
import { EmptyState } from '@/components/state/empty-state'
import { ErrorState } from '@/components/state/error-state'
import type { MarketplaceArchiveListItem } from '@/lib/api'
import { renderWithI18n, renderWithRouter } from '@/test/render'

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

/**
 * Карточка ставит ссылку, поэтому ей нужен роутер, а он поднимается асинхронно —
 * отсюда `findBy*` вместо `getBy*` в первом обращении к каждому рендеру.
 */
describe('ArchiveCard', () => {
  it('показывает манифест архива на английском', async () => {
    renderWithRouter(<ArchiveCard archive={ARCHIVE} />)

    expect(
      await screen.findByRole('heading', { name: 'Solana Program Security' }),
    ).toBeInTheDocument()
    expect(screen.getByText('by Aurora Labs')).toBeInTheDocument()
    expect(screen.getByText('files')).toBeInTheDocument()
    expect(screen.getByText('unlocks')).toBeInTheDocument()
    expect(screen.getByText('612')).toBeInTheDocument()
  })

  it('склоняет единицы в русской локали', async () => {
    renderWithRouter(<ArchiveCard archive={ARCHIVE} />, { locale: 'ru' })

    // 4 файла — форма few, 612 открытий — форма many.
    expect(await screen.findByText('файла')).toBeInTheDocument()
    expect(screen.getByText('открытий')).toBeInTheDocument()
  })

  it('выводит цену строкой backend, без пересчёта', async () => {
    renderWithRouter(<ArchiveCard archive={ARCHIVE} />)

    expect(await screen.findByText('49.00')).toBeInTheDocument()
    expect(screen.getByText('USDC')).toBeInTheDocument()
  })

  it('ведёт на страницу архива, а имя ссылки — только название', async () => {
    renderWithRouter(<ArchiveCard archive={ARCHIVE} />)

    const link = await screen.findByRole('link', { name: 'Solana Program Security' })
    expect(link).toHaveAttribute('href', '/archives/solana-program-security')
  })
})

describe('StatusBadge', () => {
  it('переводит технический статус', () => {
    renderWithI18n(<StatusBadge kind="technical" value="failed" />)
    expect(screen.getByText('Failed')).toBeInTheDocument()
  })

  it('переводит статус витрины', () => {
    renderWithI18n(<StatusBadge kind="marketplace" value="unpublished" />, { locale: 'ru' })
    expect(screen.getByText('Снят с публикации')).toBeInTheDocument()
  })
})

describe('PriceBreakdown', () => {
  it('показывает три доли и размер комиссии', () => {
    renderWithI18n(
      <PriceBreakdown
        price={{ amount: '49.00', currency: 'USDC' }}
        creator="46.55"
        platform="2.45"
        platformFeeBps={500}
      />,
    )

    expect(screen.getByText('Buyer pays')).toBeInTheDocument()
    expect(screen.getByText('49.00')).toBeInTheDocument()
    expect(screen.getByText('46.55')).toBeInTheDocument()
    expect(screen.getByText('2.45')).toBeInTheDocument()
    expect(screen.getByText(/^5\s*%$/u)).toBeInTheDocument()
  })

  it('предупреждает о неизменности цены только когда попросили', () => {
    const { rerender } = renderWithI18n(
      <PriceBreakdown
        price={{ amount: '49.00', currency: 'USDC' }}
        creator="46.55"
        platform="2.45"
        platformFeeBps={500}
      />,
    )
    expect(screen.queryByText(/cannot be changed/i)).not.toBeInTheDocument()

    rerender(
      <PriceBreakdown
        price={{ amount: '49.00', currency: 'USDC' }}
        creator="46.55"
        platform="2.45"
        platformFeeBps={500}
        showImmutableNotice
      />,
    )
    expect(screen.getByText(/cannot be changed/i)).toBeInTheDocument()
  })
})

describe('LanguageSwitch', () => {
  afterEach(() => {
    globalThis.localStorage.clear()
  })

  it('переключает язык всего поддерева и запоминает выбор', async () => {
    // Соседний потребитель словаря — обычный компонент, а не карточка: карточке
    // нужен роутер, а он к переключению языка отношения не имеет.
    function FileCount() {
      const { t } = useI18n()
      return <p>{t.units.files(4)}</p>
    }

    // Провайдер без заданной локали — иначе переключение было бы обесточено.
    render(
      <I18nProvider>
        <LanguageSwitch />
        <FileCount />
      </I18nProvider>,
    )

    expect(screen.getByText('files')).toBeInTheDocument()

    await userEvent.click(screen.getByRole('button', { name: 'ru' }))

    expect(screen.getByText('файла')).toBeInTheDocument()
    expect(screen.queryByText('files')).not.toBeInTheDocument()
    expect(globalThis.localStorage.getItem('solarch.locale')).toBe('ru')
    expect(document.documentElement.lang).toBe('ru')
  })
})

describe('состояния', () => {
  it('пустой экран приглашает к действию', () => {
    renderWithI18n(<EmptyState title="Nothing is published yet" body="The first archive shows up here." />)
    expect(screen.getByRole('heading', { name: 'Nothing is published yet' })).toBeInTheDocument()
  })

  it('ошибка объявлена как alert и предлагает повтор', async () => {
    const onRetry = vi.fn()
    renderWithI18n(
      <ErrorState title="The catalog did not load" message="Network is unavailable" onRetry={onRetry} />,
    )

    expect(screen.getByRole('alert')).toBeInTheDocument()
    await userEvent.click(screen.getByRole('button', { name: 'Try again' }))
    expect(onRetry).toHaveBeenCalledOnce()
  })
})

describe('адрес кошелька', () => {
  const WALLET = '7xKXtg2CW87d97TXJSDpbD5jBkheTqA83TZRuJosgAsU'

  it('сокращает адрес серединой и держит полный в подсказке', () => {
    renderWithI18n(<WalletAddress address={WALLET} />)

    expect(screen.getByText('7xKX…gAsU')).toHaveAttribute('title', WALLET)
  })

  it('показывает адрес целиком, когда его нужно сверить', () => {
    renderWithI18n(<WalletAddress address={WALLET} full />)

    expect(screen.getByText(WALLET)).toBeInTheDocument()
  })
})
