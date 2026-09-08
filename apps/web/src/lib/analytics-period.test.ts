import { describe, expect, it } from 'vitest'

import {
  DEFAULT_PERIOD,
  analyticsLinkSearch,
  resolvePeriod,
  validateAnalyticsSearch,
} from './analytics-period'

describe('период аналитики в адресе', () => {
  it('не пишет период по умолчанию в адрес', () => {
    expect(analyticsLinkSearch({ period: DEFAULT_PERIOD })).toEqual({ period: undefined })
    expect(analyticsLinkSearch({})).toEqual({ period: undefined })
  })

  it('пишет в адрес всё, что не по умолчанию', () => {
    expect(analyticsLinkSearch({ period: '7d' })).toEqual({ period: '7d' })
    expect(analyticsLinkSearch({ period: '30d' })).toEqual({ period: '30d' })
  })

  it('на мусор в параметре отвечает периодом по умолчанию, а не ошибкой', () => {
    expect(resolvePeriod(validateAnalyticsSearch({ period: 'yesterday' }))).toBe(DEFAULT_PERIOD)
    expect(resolvePeriod(validateAnalyticsSearch({ period: 7 }))).toBe(DEFAULT_PERIOD)
    expect(resolvePeriod(validateAnalyticsSearch({}))).toBe(DEFAULT_PERIOD)
  })

  it('принимает все три периода контракта', () => {
    expect(resolvePeriod(validateAnalyticsSearch({ period: '7d' }))).toBe('7d')
    expect(resolvePeriod(validateAnalyticsSearch({ period: '30d' }))).toBe('30d')
    expect(resolvePeriod(validateAnalyticsSearch({ period: 'all' }))).toBe('all')
  })
})
