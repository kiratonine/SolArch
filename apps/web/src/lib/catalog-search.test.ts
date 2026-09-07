import { describe, expect, it } from 'vitest'

import {
  DEFAULT_SORT,
  catalogLinkSearch,
  pageCount,
  resolveCatalogSearch,
  validateCatalogSearch,
} from './catalog-search'

/**
 * Адрес каталога публичный: его правят руками, обрезают при пересылке и открывают
 * из старых ссылок. Разбор обязан выдерживать любой мусор и давать каталог
 * по умолчанию, а не пустой экран.
 */
describe('разбор параметров каталога', () => {
  it('пропускает известную сортировку', () => {
    expect(validateCatalogSearch({ sort: 'price_desc' })).toEqual({
      sort: 'price_desc',
      q: undefined,
      page: undefined,
    })
  })

  it('гасит неизвестную сортировку до значения по умолчанию', () => {
    expect(validateCatalogSearch({ sort: 'по-настроению' }).sort).toBeUndefined()
  })

  it('не хранит в адресе значения по умолчанию', () => {
    expect(validateCatalogSearch({ sort: DEFAULT_SORT, page: 1, q: '   ' })).toEqual({
      sort: undefined,
      q: undefined,
      page: undefined,
    })
  })

  it('обрезает пробелы вокруг запроса', () => {
    expect(validateCatalogSearch({ q: '  solana  ' }).q).toBe('solana')
  })

  it('принимает числовой запрос строкой', () => {
    // Роутер разбирает `?q=2026` как число — до схемы поиска доходит не строка.
    expect(validateCatalogSearch({ q: 2026 }).q).toBe('2026')
  })

  it('отбрасывает нецелую и отрицательную страницу', () => {
    expect(validateCatalogSearch({ page: 0 }).page).toBeUndefined()
    expect(validateCatalogSearch({ page: -3 }).page).toBeUndefined()
    expect(validateCatalogSearch({ page: 2.5 }).page).toBeUndefined()
    expect(validateCatalogSearch({ page: 'вторая' }).page).toBeUndefined()
  })

  it('оставляет вторую и дальше страницы', () => {
    expect(validateCatalogSearch({ page: 3 }).page).toBe(3)
  })
})

describe('умолчания и ссылки', () => {
  it('проставляет умолчания для запроса к API', () => {
    expect(resolveCatalogSearch({ sort: undefined, q: undefined, page: undefined })).toEqual({
      sort: DEFAULT_SORT,
      q: '',
      page: 1,
    })
  })

  it('сбрасывает страницу, когда её просят сбросить', () => {
    expect(catalogLinkSearch({ sort: 'price_asc', page: 1, q: 'kit' })).toEqual({
      sort: 'price_asc',
      q: 'kit',
      page: undefined,
    })
  })
})

describe('число страниц', () => {
  it('считает по общему количеству и размеру страницы', () => {
    expect(pageCount(9, 6)).toBe(2)
    expect(pageCount(12, 6)).toBe(2)
    expect(pageCount(13, 6)).toBe(3)
  })

  it('никогда не даёт меньше одной страницы', () => {
    expect(pageCount(0, 6)).toBe(1)
    expect(pageCount(5, 0)).toBe(1)
  })
})
