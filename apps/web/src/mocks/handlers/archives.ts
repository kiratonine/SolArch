import { HttpResponse, http } from 'msw'

import { validatePriceInput } from '@/lib/money'
import type { CreateArchiveRequest, UpdateArchiveRequest } from '@/lib/api/types'
import {
  DEFAULT_POLICY,
  MOCK_CREATOR,
  db,
  economicsFor,
  findById,
  nextId,
  type MockArchive,
} from '../db'
import { apiError, requireSession, route } from './shared'

function slugify(title: string): string {
  return (
    title
      .toLowerCase()
      .replace(/[^a-z0-9]+/g, '-')
      .replace(/^-+|-+$/g, '')
      .slice(0, 60) || 'archive'
  )
}

export const archiveHandlers = [
  // ДОПУЩЕНИЕ Q8: списка архивов автора нет в docs/API.md, считаем это GET /v1/archives.
  http.get(route('/archives'), () => {
    const unauthorized = requireSession()
    if (unauthorized) return unauthorized

    // Кабинет показывает свои архивы, а не весь каталог. Мок-поля наружу не уходят.
    const ownerId = db.session?.id

    return HttpResponse.json(
      db.archives
        .filter((archive) => archive.owner_id === ownerId)
        .map(
          ({
            files: _files,
            owner_id: _owner,
            creator_display_name: _creator,
            ...archive
          }) => archive,
        ),
    )
  }),

  http.post(route('/archives'), async ({ request }) => {
    const unauthorized = requireSession()
    if (unauthorized) return unauthorized

    const body = (await request.json()) as CreateArchiveRequest

    if (!body.title?.trim()) {
      return apiError(400, 'TITLE_REQUIRED', 'Укажите название архива')
    }

    const priceError = validatePriceInput(body.price?.amount ?? '')
    if (priceError) return apiError(400, 'INVALID_PRICE', priceError)

    if (body.price.currency !== 'USDC') {
      return apiError(400, 'UNSUPPORTED_CURRENCY', 'Поддерживается только USDC')
    }

    if (!body.creator_payout_wallet || body.creator_payout_wallet.length < 32) {
      return apiError(400, 'INVALID_PAYOUT_WALLET', 'Некорректный payout wallet')
    }

    const archive: MockArchive = {
      archive_id: nextId('arc'),
      slug: null,
      title: body.title,
      short_description: body.short_description ?? '',
      description: body.description ?? '',
      cover_url: null,
      technical_status: 'draft',
      marketplace_status: 'draft',
      price: body.price,
      economics: economicsFor(body.price.amount),
      license_policy: body.license_policy ?? DEFAULT_POLICY,
      creator_payout_wallet: body.creator_payout_wallet,
      // ATA автора готовит backend автоматически (ADR-009).
      payout_account_ready: true,
      file_count: 0,
      size_bytes: 0,
      metrics: { views: 0, downloads: 0, paid_unlocks: 0 },
      created_at: new Date().toISOString(),
      files: [],
      creator_display_name: db.session?.display_name ?? 'Creator',
      owner_id: db.session?.id ?? MOCK_CREATOR.id,
    }

    db.archives.unshift(archive)

    return HttpResponse.json(
      {
        archive_id: archive.archive_id,
        technical_status: archive.technical_status,
        marketplace_status: archive.marketplace_status,
        price: archive.price,
        economics: archive.economics,
      },
      { status: 201 },
    )
  }),

  http.get(route('/archives/:archiveId'), ({ params }) => {
    const unauthorized = requireSession()
    if (unauthorized) return unauthorized

    const archive = findById(String(params.archiveId))
    if (!archive) return apiError(404, 'ARCHIVE_NOT_FOUND', 'Archive not found')

    const { files: _files, ...rest } = archive
    return HttpResponse.json(rest)
  }),

  http.patch(route('/archives/:archiveId'), async ({ params, request }) => {
    const unauthorized = requireSession()
    if (unauthorized) return unauthorized

    const archive = findById(String(params.archiveId))
    if (!archive) return apiError(404, 'ARCHIVE_NOT_FOUND', 'Archive not found')

    const body = (await request.json()) as UpdateArchiveRequest & { price?: unknown }

    // Цена неизменяема после создания (ADR-004). Попытку смены отклоняем явно.
    if (body.price !== undefined) {
      return apiError(
        409,
        'PRICE_IMMUTABLE',
        'Цену архива нельзя изменить после создания. Создайте новый архив.',
      )
    }

    if (body.title !== undefined) archive.title = body.title
    if (body.short_description !== undefined) archive.short_description = body.short_description
    if (body.description !== undefined) archive.description = body.description
    if (body.cover_url !== undefined) archive.cover_url = body.cover_url

    const { files: _files, ...rest } = archive
    return HttpResponse.json(rest)
  }),

  http.post(route('/archives/:archiveId/publish'), ({ params }) => {
    const unauthorized = requireSession()
    if (unauthorized) return unauthorized

    const archive = findById(String(params.archiveId))
    if (!archive) return apiError(404, 'ARCHIVE_NOT_FOUND', 'Archive not found')

    // Требования публикации из docs/API.md §3.
    if (archive.technical_status !== 'ready') {
      return apiError(409, 'ARCHIVE_NOT_READY', 'Архив ещё не собран')
    }

    if (!archive.payout_account_ready) {
      return apiError(409, 'PAYOUT_ACCOUNT_NOT_READY', 'USDC-аккаунт автора ещё не готов')
    }

    archive.marketplace_status = 'published'
    archive.slug ??= slugify(archive.title)

    const { files: _files, ...rest } = archive
    return HttpResponse.json(rest)
  }),

  http.post(route('/archives/:archiveId/unpublish'), ({ params }) => {
    const unauthorized = requireSession()
    if (unauthorized) return unauthorized

    const archive = findById(String(params.archiveId))
    if (!archive) return apiError(404, 'ARCHIVE_NOT_FOUND', 'Archive not found')

    archive.marketplace_status = 'unpublished'

    const { files: _files, ...rest } = archive
    return HttpResponse.json(rest)
  }),

  http.get(route('/archives/:archiveId/download'), ({ params }) => {
    const unauthorized = requireSession()
    if (unauthorized) return unauthorized

    const archive = findById(String(params.archiveId))
    if (!archive) return apiError(404, 'ARCHIVE_NOT_FOUND', 'Archive not found')

    return HttpResponse.text(`SLR mock container for ${archive.archive_id}`, {
      headers: {
        'Content-Type': 'application/octet-stream',
        'Content-Disposition': `attachment; filename="${archive.slug ?? archive.archive_id}.slr"`,
      },
    })
  }),
]
