import { z } from 'zod'

import { marketplaceSortSchema, type MarketplaceSort } from '@/lib/api'

/**
 * Состояние каталога живёт в адресной строке, а не в компоненте.
 *
 * Ссылка на «дороже всего, страница 2, запрос solana» обязана открываться у другого
 * человека такой же — поэтому сортировка, поиск и страница разобраны здесь один раз
 * и типизированы, а не собираются строками по месту.
 *
 * Значения `sort` уходят в backend как есть: popularity фронт не считает
 * (`docs/roles/02_MARKETPLACE_FRONTEND.md` §4).
 */

export const DEFAULT_SORT: MarketplaceSort = 'popular_week'

/**
 * `?q=2026` роутер разберёт как число, а не как строку, поэтому текст приводим сами.
 * Пустой и пробельный запрос — это отсутствие запроса.
 */
const querySchema = z
  .preprocess(
    (value) => (typeof value === 'number' ? String(value) : value),
    z.string().transform((value) => value.trim()).pipe(z.string().min(1)),
  )
  .optional()
  .catch(undefined)

/**
 * Каждое поле падает в `undefined`, а не бросает: адрес каталога публичный, его
 * правят руками и присылают битым. Мусор в параметре обязан давать каталог
 * по умолчанию, а не белый экран.
 */
export const catalogSearchSchema = z.object({
  sort: marketplaceSortSchema.optional().catch(undefined),
  q: querySchema,
  page: z.coerce.number().int().min(1).optional().catch(undefined),
})

export type CatalogSearch = z.infer<typeof catalogSearchSchema>

/**
 * Значения по умолчанию в адресе не хранятся: `/` вместо
 * `/?sort=popular_week&q=&page=1`. Так же собираются все ссылки каталога.
 */
export function catalogLinkSearch(next: Partial<CatalogSearch>): CatalogSearch {
  const query = next.q?.trim()

  return {
    sort: next.sort && next.sort !== DEFAULT_SORT ? next.sort : undefined,
    q: query ? query : undefined,
    page: next.page && next.page > 1 ? next.page : undefined,
  }
}

export function validateCatalogSearch(input: Record<string, unknown>): CatalogSearch {
  return catalogLinkSearch(catalogSearchSchema.parse(input))
}

/** Параметры запроса: здесь умолчания, наоборот, проставлены явно. */
export function resolveCatalogSearch(search: CatalogSearch) {
  return {
    sort: search.sort ?? DEFAULT_SORT,
    q: search.q ?? '',
    page: search.page ?? 1,
  }
}

export function pageCount(total: number, perPage: number): number {
  if (perPage <= 0) return 1
  return Math.max(1, Math.ceil(total / perPage))
}
