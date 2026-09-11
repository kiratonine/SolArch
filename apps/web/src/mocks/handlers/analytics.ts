import { HttpResponse, http } from 'msw'

import { formatUsdc, parseUsdc, previewEconomics } from '@/lib/money'
import type { AnalyticsPeriod } from '@/lib/api/types'
import { apiError, findOwned, requireSession, route } from './shared'

/**
 * Доля метрик, попадающая в окно периода. Только для правдоподобия мока.
 *
 * У каждой метрики доля своя, и чем уже окно, тем сильнее они расходятся: за неделю
 * успевают набежать просмотры, которые ещё не превратились в покупки. Одна доля на
 * три метрики давала одинаковые конверсии во всех трёх периодах — экран, на котором
 * перепутанный период невозможно заметить ни глазом, ни тестом.
 */
const PERIOD_SHARE: Record<AnalyticsPeriod, { views: number; downloads: number; paid: number }> = {
  '7d': { views: 0.12, downloads: 0.1, paid: 0.07 },
  '30d': { views: 0.38, downloads: 0.34, paid: 0.29 },
  all: { views: 1, downloads: 1, paid: 1 },
}

function ratio(numerator: number, denominator: number): number {
  if (denominator === 0) return 0
  return Number((numerator / denominator).toFixed(4))
}

export const analyticsHandlers = [
  http.get(route('/archives/:archiveId/analytics'), ({ params, request }) => {
    const unauthorized = requireSession(request)
    if (unauthorized) return unauthorized

    // Аналитика — только для владельца (`docs/API.md` §11).
    const archive = findOwned(String(params.archiveId))
    if (!archive) return apiError(404, 'ARCHIVE_NOT_FOUND', 'Архив не найден')

    const url = new URL(request.url)
    const period = (url.searchParams.get('period') ?? 'all') as AnalyticsPeriod
    const share = PERIOD_SHARE[period] ?? PERIOD_SHARE.all

    const views = Math.round(archive.metrics.views * share.views)
    const downloads = Math.round(archive.metrics.downloads * share.downloads)
    const paidUnlocks = Math.round(archive.metrics.paid_unlocks * share.paid)

    // Выручка = цена × число оплаченных разблокировок, дальше тот же split 95/5.
    const grossUnits = parseUsdc(archive.price.amount) * BigInt(paidUnlocks)
    const gross = formatUsdc(grossUnits)
    const split = previewEconomics(gross, archive.economics.platform_fee_bps)

    return HttpResponse.json({
      period,
      views,
      downloads,
      paid_unlocks: paidUnlocks,
      conversions: {
        view_to_download: ratio(downloads, views),
        download_to_purchase: ratio(paidUnlocks, downloads),
      },
      revenue: {
        gross,
        creator: split.creator,
        platform: split.platform,
        currency: 'USDC',
      },
    })
  }),
]
