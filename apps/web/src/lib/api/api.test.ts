import { HttpResponse, http } from 'msw'
import { describe, expect, it } from 'vitest'

import { db } from '@/mocks/db'
import { route } from '@/mocks/handlers/shared'
import { server } from '@/mocks/node'

import { getArchiveAnalytics } from './analytics'
import {
  createArchive,
  getMyArchive,
  listMyArchives,
  publishArchive,
  unpublishArchive,
  updateArchive,
} from './archives'
import { getSession, logout, requestWalletChallenge, verifyWalletSignature } from './auth'
import { ApiError, ContractError } from './errors'
import {
  getMarketplaceArchive,
  getMarketplaceArchiveFiles,
  listMarketplaceArchives,
  marketplaceDownloadUrl,
} from './marketplace'
import type { CreateArchiveRequest } from './types'

const WALLET = '7xKXtg2CW87d97TXJSDpbD5jBkheTqA83TZRuJosgAsU'

async function signIn() {
  const challenge = await requestWalletChallenge(WALLET)
  return verifyWalletSignature({
    challenge_id: challenge.challenge_id,
    wallet: WALLET,
    signature: 'mock-signature',
  })
}

function draftArchive(overrides: Partial<CreateArchiveRequest> = {}): CreateArchiveRequest {
  return {
    title: 'Test Archive',
    short_description: 'short',
    description: 'full description',
    price: { amount: '10.00', currency: 'USDC' },
    creator_payout_wallet: WALLET,
    license_policy: { max_devices: 1, allow_export: false, watermark_enabled: true },
    ...overrides,
  }
}

describe('marketplace API (guest)', () => {
  it('lists only published archives without a session', async () => {
    const page = await listMarketplaceArchives()

    expect(page.items.length).toBeGreaterThan(0)
    expect(page.items.every((item) => item.slug)).toBe(true)
    // Черновик из фикстур в каталог попадать не должен.
    expect(page.items.some((item) => item.title === 'Untitled research notes')).toBe(false)
  })

  it('never leaks creator-only fields into catalog items', async () => {
    const page = await listMarketplaceArchives()
    const [item] = page.items

    expect(item).toBeDefined()
    expect(item).not.toHaveProperty('creator_payout_wallet')
    expect(item).not.toHaveProperty('economics')
    expect(item).not.toHaveProperty('technical_status')
  })

  it('sorts by price ascending and descending', async () => {
    const asc = await listMarketplaceArchives({ sort: 'price_asc' })
    const desc = await listMarketplaceArchives({ sort: 'price_desc' })

    const ascPrices = asc.items.map((item) => Number(item.price.amount))
    const descPrices = desc.items.map((item) => Number(item.price.amount))

    expect(ascPrices).toEqual([...ascPrices].sort((a, b) => a - b))
    expect(descPrices).toEqual([...descPrices].sort((a, b) => b - a))
  })

  it('gives each archive its own author', async () => {
    const page = await listMarketplaceArchives()
    const names = page.items.map((item) => item.creator.display_name)

    expect(names.every((name) => name.length > 0)).toBe(true)
    // Каталог с одним автором на все карточки не даёт увидеть ни длинное имя,
    // ни того, что автор вообще меняется от архива к архиву.
    expect(new Set(names).size).toBeGreaterThan(1)
  })

  it('sorts by downloads', async () => {
    const page = await listMarketplaceArchives({ sort: 'most_downloaded' })
    const downloads = page.items.map((item) => item.metrics.downloads)

    expect(downloads).toEqual([...downloads].sort((a, b) => b - a))
  })

  it('returns archive detail and public file listing', async () => {
    const archive = await getMarketplaceArchive('solana-program-security')
    expect(archive.title).toBe('Solana Program Security')
    expect(archive.price.currency).toBe('USDC')
    expect(archive.download_available).toBe(true)

    const { files } = await getMarketplaceArchiveFiles('solana-program-security')
    expect(files.length).toBeGreaterThan(0)

    // Публичный listing содержит только разрешённые поля (роль §10).
    for (const file of files) {
      expect(Object.keys(file).sort()).toEqual([
        'display_name',
        'display_path',
        'extension',
        'mime_type',
        'size_bytes',
      ])
    }
  })

  it('hides an unpublished archive from guests', async () => {
    await expect(getMarketplaceArchive('nope-does-not-exist')).rejects.toBeInstanceOf(ApiError)

    await expect(getMarketplaceArchive('nope-does-not-exist')).rejects.toMatchObject({
      code: 'ARCHIVE_NOT_FOUND',
      status: 404,
    })
  })

  it('builds a guest download URL under /v1', () => {
    expect(marketplaceDownloadUrl('solana-program-security')).toMatch(
      /\/v1\/marketplace\/archives\/solana-program-security\/download$/,
    )
  })
})

describe('contract validation', () => {
  it('fails loudly when the backend drops a documented field', async () => {
    server.use(
      http.get(route('/marketplace/archives/:slug'), () =>
        HttpResponse.json({
          archive_id: 'arc_1',
          slug: 'broken',
          title: 'Broken',
          // short_description, creator, price, metrics и остальное отсутствуют
        }),
      ),
    )

    await expect(getMarketplaceArchive('broken')).rejects.toBeInstanceOf(ContractError)
  })

  it('rejects a price sent as a number instead of a decimal string', async () => {
    server.use(
      http.get(route('/marketplace/archives/:slug'), () =>
        HttpResponse.json({
          archive_id: 'arc_1',
          slug: 'numeric-price',
          title: 'Numeric price',
          short_description: '',
          description: '',
          cover_url: null,
          creator: { display_name: 'Creator' },
          // Число вместо строки: именно та ошибка, ради которой введён decimal string.
          price: { amount: 10, currency: 'USDC' },
          file_count: 1,
          size_bytes: 1,
          metrics: { views: 0, downloads: 0, paid_unlocks: 0 },
          license_policy: { max_devices: 1, allow_export: false, watermark_enabled: true },
          marketplace_status: 'published',
          download_available: true,
        }),
      ),
    )

    await expect(getMarketplaceArchive('numeric-price')).rejects.toMatchObject({
      name: 'ContractError',
    })
  })

  it('ignores extra fields the backend adds', async () => {
    const archive = await getMarketplaceArchive('solana-program-security')
    expect(archive.title).toBe('Solana Program Security')
  })
})

describe('auth API', () => {
  it('treats a missing session as guest, not as an error', async () => {
    await expect(getSession()).resolves.toBeNull()
  })

  it('signs in through challenge and signature, then signs out', async () => {
    const result = await signIn()
    expect(result.authenticated).toBe(true)
    expect(result.user.wallet).toBe(WALLET)

    await expect(getSession()).resolves.toMatchObject({ wallet: WALLET })

    await logout()
    await expect(getSession()).resolves.toBeNull()
  })

  it('rejects a signature for an unknown challenge', async () => {
    await expect(
      verifyWalletSignature({ challenge_id: 'chl_unknown', wallet: WALLET, signature: 'x' }),
    ).rejects.toMatchObject({ code: 'CHALLENGE_INVALID' })
  })
})

describe('creator archives API', () => {
  it('requires a session', async () => {
    await expect(listMyArchives()).rejects.toMatchObject({ status: 401 })
  })

  it('lists only the signed-in creator’s own archives', async () => {
    await signIn()
    const mine = await listMyArchives()
    const catalog = await listMarketplaceArchives()

    expect(mine.length).toBeGreaterThan(0)
    // Кабинет — не каталог: чужие архивы в него попадать не должны.
    expect(mine.length).toBeLessThan(catalog.total)
    expect(mine.some((archive) => archive.title === 'Nebula Brand Kit')).toBe(false)
    // Свой черновик, наоборот, виден только здесь.
    expect(mine.some((archive) => archive.title === 'Untitled research notes')).toBe(true)
  })

  it('freezes economics at creation with a 95/5 split', async () => {
    await signIn()
    const created = await createArchive(draftArchive())

    expect(created.price).toEqual({ amount: '10.00', currency: 'USDC' })
    expect(created.economics).toEqual({
      platform_fee_bps: 500,
      creator_share: '9.50',
      platform_share: '0.50',
      network_fees_paid_by: 'solarch',
    })
    expect(created.technical_status).toBe('draft')
    expect(created.marketplace_status).toBe('draft')
  })

  it('refuses to change the price after creation', async () => {
    await signIn()
    const created = await createArchive(draftArchive())

    await expect(
      updateArchive(created.archive_id, {
        price: { amount: '1.00', currency: 'USDC' },
      } as never),
    ).rejects.toMatchObject({ code: 'PRICE_IMMUTABLE', status: 409 })

    const unchanged = await getMyArchive(created.archive_id)
    expect(unchanged.price.amount).toBe('10.00')
  })

  it('allows editing metadata that is not the price', async () => {
    await signIn()
    const created = await createArchive(draftArchive())

    const updated = await updateArchive(created.archive_id, { title: 'Renamed' })
    expect(updated.title).toBe('Renamed')
    expect(updated.price.amount).toBe('10.00')
  })

  it('rejects an invalid price and a bad payout wallet', async () => {
    await signIn()

    await expect(
      createArchive(draftArchive({ price: { amount: '0', currency: 'USDC' } })),
    ).rejects.toMatchObject({ code: 'INVALID_PRICE' })

    await expect(
      createArchive(draftArchive({ creator_payout_wallet: 'too-short' })),
    ).rejects.toMatchObject({ code: 'INVALID_PAYOUT_WALLET' })
  })

  it('refuses to publish an archive that is not ready', async () => {
    await signIn()
    const created = await createArchive(draftArchive())

    await expect(publishArchive(created.archive_id)).rejects.toMatchObject({
      code: 'ARCHIVE_NOT_READY',
      status: 409,
    })
  })

  it('publishes a ready archive and makes it visible to guests', async () => {
    await signIn()
    const created = await createArchive(draftArchive({ title: 'Ready For Sale' }))

    // Готовность архива обеспечивает backend; в тесте выставляем её напрямую.
    const stored = db.archives.find((item) => item.archive_id === created.archive_id)
    expect(stored).toBeDefined()
    stored!.technical_status = 'ready'

    const published = await publishArchive(created.archive_id)
    expect(published.marketplace_status).toBe('published')
    expect(published.slug).toBe('ready-for-sale')

    const guestView = await getMarketplaceArchive('ready-for-sale')
    expect(guestView.title).toBe('Ready For Sale')

    await unpublishArchive(created.archive_id)
    await expect(getMarketplaceArchive('ready-for-sale')).rejects.toMatchObject({ status: 404 })
  })
})

describe('analytics API', () => {
  it('returns owner metrics and a consistent revenue split', async () => {
    await signIn()
    const analytics = await getArchiveAnalytics('arc_solana_course', 'all')

    expect(analytics.period).toBe('all')
    expect(analytics.views).toBe(18420)
    expect(analytics.paid_unlocks).toBe(612)
    expect(analytics.revenue.currency).toBe('USDC')

    // gross = creator + platform, без потери base units.
    const gross = Number(analytics.revenue.gross)
    const creator = Number(analytics.revenue.creator)
    const platform = Number(analytics.revenue.platform)
    expect(creator + platform).toBeCloseTo(gross, 6)
  })

  it('scales metrics down for shorter periods', async () => {
    await signIn()
    const all = await getArchiveAnalytics('arc_solana_course', 'all')
    const week = await getArchiveAnalytics('arc_solana_course', '7d')

    expect(week.views).toBeLessThan(all.views)
    expect(week.period).toBe('7d')
  })

  it('requires a session', async () => {
    await expect(getArchiveAnalytics('arc_solana_course', 'all')).rejects.toMatchObject({
      status: 401,
    })
  })
})
