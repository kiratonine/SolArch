import { HttpResponse, http } from 'msw'

import { formatUsdc, parseUsdc, previewEconomics } from '@/lib/money'
import type { AnalyticsPeriod } from '@/lib/api/types'
import { findById } from '../db'
import { apiError, requireSession, route } from './shared'

/** Доля метрик, попадающая в окно периода. Только для правдоподобия мока. */
const PERIOD_SHARE: Record<AnalyticsPeriod, number> = {
  '7d': 0.12,
  '30d': 0.38,
  all: 1,
}

function ratio(numerator: number, denominator: number): number {
  if (denominator === 0) return 0
  return Number((numerator / denominator).toFixed(4))
}

export const analyticsHandlers = [
  http.get(route('/archives/:archiveId/analytics'), ({ params, request }) => {
    const unauthorized = requireSession()
    if (unauthorized) return unauthorized

    const archive = findById(String(params.archiveId))
    if (!archive) return apiError(404, 'ARCHIVE_NOT_FOUND', 'Archive not found')

    const url = new URL(request.url)
    const period = (url.searchParams.get('period') ?? 'all') as AnalyticsPeriod
    const share = PERIOD_SHARE[period] ?? 1

    const views = Math.round(archive.metrics.views * share)
    const downloads = Math.round(archive.metrics.downloads * share)
    const paidUnlocks = Math.round(archive.metrics.paid_unlocks * share)

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
