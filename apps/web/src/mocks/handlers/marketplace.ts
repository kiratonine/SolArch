import { HttpResponse, http } from 'msw'

import { parseUsdc } from '@/lib/money'
import type { MarketplaceSort } from '@/lib/api/types'
import { db, findBySlug, type MockArchive } from '../db'
import { apiError, route, toDetail, toListItem } from './shared'

/**
 * Размер страницы задаёт backend. В моке он намеренно маленький: иначе на девяти
 * фикстурах вторая страница не появилась бы и постраничность осталась бы непроверенной.
 */
const PER_PAGE = 6

/**
 * Порядок выдачи каталога.
 *
 * Повторяет формулу из `docs/SPEC.md` §9: popularity считается по подтверждённым
 * покупкам, скачивания — вторичный ключ. Настоящую формулу с фильтром по периоду
 * реализует backend; мок нужен, чтобы UI сортировок был проверяем.
 */
function sortArchives(archives: MockArchive[], sort: MarketplaceSort): MockArchive[] {
  const sorted = [...archives]

  switch (sort) {
    case 'price_asc':
      return sorted.sort((a, b) => Number(parseUsdc(a.price.amount) - parseUsdc(b.price.amount)))
    case 'price_desc':
      return sorted.sort((a, b) => Number(parseUsdc(b.price.amount) - parseUsdc(a.price.amount)))
    case 'most_downloaded':
      return sorted.sort((a, b) => b.metrics.downloads - a.metrics.downloads)
    case 'popular_week':
    case 'popular_month':
    default:
      return sorted.sort(
        (a, b) =>
          b.metrics.paid_unlocks - a.metrics.paid_unlocks ||
          b.metrics.downloads - a.metrics.downloads,
      )
  }
}

export const marketplaceHandlers = [
  http.get(route('/marketplace/archives'), ({ request }) => {
    const url = new URL(request.url)
    const sort = (url.searchParams.get('sort') ?? 'popular_week') as MarketplaceSort
    const search = url.searchParams.get('search')?.trim().toLowerCase() ?? ''
    const page = Number(url.searchParams.get('page') ?? '1')

    // Каталог показывает только опубликованное (AC-01).
    let visible = db.archives.filter((archive) => archive.marketplace_status === 'published')

    if (search) {
      // ДОПУЩЕНИЕ (открытый вопрос Q11): по каким полям ищет backend, `docs/API.md`
      // не говорит. Имя автора включено намеренно: человек часто помнит автора,
      // а не название, и поиск, который на «Studio Kirn» отвечает «ничего нет»,
      // выглядит сломанным.
      visible = visible.filter((archive) =>
        [archive.title, archive.short_description, archive.creator_display_name].some((field) =>
          field.toLowerCase().includes(search),
        ),
      )
    }

    const ordered = sortArchives(visible, sort)
    const start = (page - 1) * PER_PAGE

    return HttpResponse.json({
      items: ordered.slice(start, start + PER_PAGE).map(toListItem),
      page,
      per_page: PER_PAGE,
      total: ordered.length,
      has_more: start + PER_PAGE < ordered.length,
    })
  }),

  http.get(route('/marketplace/archives/:slug'), ({ params }) => {
    const archive = findBySlug(String(params.slug))

    // Неопубликованный архив для гостя не существует (роль §12: unpublished / 404).
    if (!archive || archive.marketplace_status !== 'published') {
      return apiError(404, 'ARCHIVE_NOT_FOUND', 'Archive not found')
    }

    archive.metrics.views += 1
    return HttpResponse.json(toDetail(archive))
  }),

  http.get(route('/marketplace/archives/:slug/files'), ({ params }) => {
    const archive = findBySlug(String(params.slug))

    if (!archive || archive.marketplace_status !== 'published') {
      return apiError(404, 'ARCHIVE_NOT_FOUND', 'Archive not found')
    }

    return HttpResponse.json({ files: archive.files })
  }),

  http.get(route('/marketplace/archives/:slug/download'), ({ params }) => {
    const archive = findBySlug(String(params.slug))

    if (!archive || archive.marketplace_status !== 'published') {
      return apiError(404, 'ARCHIVE_NOT_FOUND', 'Archive not found')
    }

    archive.metrics.downloads += 1

    // Отдаём заглушку .slr: гостю никогда не возвращается исходный ZIP (AC-04).
    return HttpResponse.text(`SLR mock container for ${archive.slug}`, {
      headers: {
        'Content-Type': 'application/octet-stream',
        'Content-Disposition': `attachment; filename="${archive.slug}.slr"`,
      },
    })
  }),
]
