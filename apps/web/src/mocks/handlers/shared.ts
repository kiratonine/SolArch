import { HttpResponse } from 'msw'

import { API_BASE_URL, API_PREFIX } from '@/lib/api/config'
import type {
  MarketplaceArchiveDetail,
  MarketplaceArchiveListItem,
} from '@/lib/api/types'
import { db, findById, type MockArchive } from '../db'

/** Абсолютный путь эндпоинта для MSW. */
export function route(path: string): string {
  return `${API_BASE_URL}${API_PREFIX}${path}`
}

/** Ответ в формате ошибки из `docs/API.md` §1.3. */
export function apiError(status: number, code: string, message: string) {
  return HttpResponse.json({ code, message, request_id: 'req_mock_0001' }, { status })
}

/**
 * Сессия предъявляется заголовком `Authorization: Bearer`, как у backend (ответ на Q1).
 * Проверяются обе стороны: мок помнит, кого впустил, а запрос обязан принести тот самый токен.
 */
export function requireSession(request: Request) {
  const presented = request.headers.get('Authorization')
  const valid = db.session !== null && db.token !== null && presented === `Bearer ${db.token}`
  return valid ? null : apiError(401, 'UNAUTHORIZED', 'Требуется вход автора')
}

/**
 * Собственный архив автора.
 *
 * Всё под `/archives/*` — owner-only (`docs/API.md` §3). Чужой архив отдаётся
 * как 404, а не 403: сам по себе 403 подтвердил бы, что такой архив существует,
 * а вместе с ним — что кто-то другой его завёл.
 */
export function findOwned(archiveId: string): MockArchive | undefined {
  const archive = findById(archiveId)
  return archive && archive.owner_id === db.session?.id ? archive : undefined
}

/**
 * Приводит архив к публичной карточке.
 *
 * Наружу уходит только то, что разрешено (`docs/roles/02_MARKETPLACE_FRONTEND.md` §10):
 * никаких payout wallet, economics и внутренних статусов сборки.
 */
export function toListItem(archive: MockArchive): MarketplaceArchiveListItem {
  // Slug появляется при публикации, а в публичный ответ попадают только
  // опубликованные архивы. Если инвариант нарушен — это ошибка мока, не данных.
  if (!archive.slug) {
    throw new Error(`Mock invariant: published archive ${archive.archive_id} has no slug`)
  }

  return {
    archive_id: archive.archive_id,
    slug: archive.slug,
    title: archive.title,
    short_description: archive.short_description,
    cover_url: archive.cover_url,
    creator: { display_name: archive.creator_display_name },
    price: archive.price,
    file_count: archive.file_count,
    size_bytes: archive.size_bytes,
    metrics: archive.metrics,
  }
}

export function toDetail(archive: MockArchive): MarketplaceArchiveDetail {
  return {
    ...toListItem(archive),
    description: archive.description,
    license_policy: archive.license_policy,
    marketplace_status: archive.marketplace_status,
    download_available: archive.marketplace_status === 'published',
  }
}
