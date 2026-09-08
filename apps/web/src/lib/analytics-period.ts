import { z } from 'zod'

import { analyticsPeriodSchema, type AnalyticsPeriod } from '@/lib/api'

/**
 * Период аналитики живёт в адресной строке, как сортировка каталога (F7).
 *
 * «Посмотри, что было за неделю» — это ссылка, а не устная инструкция: адрес
 * открывается у другого человека тем же экраном, возвращается кнопкой «назад»
 * и кладётся в закладки.
 */

/**
 * По умолчанию — за всё время.
 *
 * Автор приходит сюда со страницы архива, где только что видел просмотры,
 * скачивания и открытия за всю жизнь архива. Открой мы аналитику на месяце, те же
 * подписи показали бы числа меньше, и первое, что человек прочёл бы, — расхождение
 * с предыдущим экраном. Окно он сузит сам, одним нажатием.
 */
export const DEFAULT_PERIOD: AnalyticsPeriod = 'all'

/**
 * Мусор в параметре даёт период по умолчанию, а не белый экран: адрес правят руками
 * и присылают битым — ровно как адрес каталога.
 */
export const analyticsSearchSchema = z.object({
  period: analyticsPeriodSchema.optional().catch(undefined),
})

export type AnalyticsSearch = z.infer<typeof analyticsSearchSchema>

/** Значение по умолчанию в адресе не хранится: `/analytics` вместо `?period=all`. */
export function analyticsLinkSearch(next: Partial<AnalyticsSearch>): AnalyticsSearch {
  return {
    period: next.period && next.period !== DEFAULT_PERIOD ? next.period : undefined,
  }
}

export function validateAnalyticsSearch(input: Record<string, unknown>): AnalyticsSearch {
  return analyticsLinkSearch(analyticsSearchSchema.parse(input))
}

/** Параметр запроса: здесь умолчание, наоборот, проставлено явно. */
export function resolvePeriod(search: AnalyticsSearch): AnalyticsPeriod {
  return search.period ?? DEFAULT_PERIOD
}
