import { describe, expect, it } from 'vitest'

import {
  MoneyFormatError,
  PLATFORM_FEE_BPS,
  formatUsdc,
  parseUsdc,
  previewEconomics,
  validatePriceInput,
} from './money'

describe('parseUsdc', () => {
  it('converts a decimal string to base units', () => {
    expect(parseUsdc('10.00')).toBe(10_000_000n)
    expect(parseUsdc('10')).toBe(10_000_000n)
    expect(parseUsdc('0.000001')).toBe(1n)
    expect(parseUsdc('1234.567891')).toBe(1_234_567_891n)
  })

  it('rejects values a float would silently mangle', () => {
    expect(() => parseUsdc('0.0000001')).toThrow(MoneyFormatError)
    expect(() => parseUsdc('-1.00')).toThrow(MoneyFormatError)
    expect(() => parseUsdc('1e3')).toThrow(MoneyFormatError)
    expect(() => parseUsdc('abc')).toThrow(MoneyFormatError)
    expect(() => parseUsdc('')).toThrow(MoneyFormatError)
  })
})

describe('formatUsdc', () => {
  it('renders base units as money', () => {
    expect(formatUsdc(10_000_000n)).toBe('10.00')
    expect(formatUsdc(9_500_000n)).toBe('9.50')
    expect(formatUsdc(500_000n)).toBe('0.50')
    expect(formatUsdc(0n)).toBe('0.00')
  })

  it('keeps significant precision beyond two decimals', () => {
    expect(formatUsdc(1n)).toBe('0.000001')
    expect(formatUsdc(1_234_567_891n)).toBe('1234.567891')
  })

  it('round-trips with parseUsdc', () => {
    for (const value of ['0.01', '10.00', '99.999999', '1000000.00']) {
      expect(formatUsdc(parseUsdc(value))).toBe(formatUsdc(parseUsdc(value)))
      expect(parseUsdc(formatUsdc(parseUsdc(value)))).toBe(parseUsdc(value))
    }
  })
})

describe('previewEconomics', () => {
  it('splits the documented example exactly', () => {
    // docs/SPEC.md §3
    expect(previewEconomics('10.00')).toEqual({
      price: '10.00',
      creator: '9.50',
      platform: '0.50',
      feeBps: PLATFORM_FEE_BPS,
    })
  })

  it('never loses or invents base units when the fee is not exact', () => {
    // 5% от 1 base unit = 0.05 → комиссия отсекается вниз до нуля.
    const tiny = previewEconomics('0.000001')
    expect(tiny.platform).toBe('0.00')
    expect(tiny.creator).toBe('0.000001')

    // 5% от 0.000019 = 0.00000095 → 0 после отсечения, автор получает всё.
    const odd = previewEconomics('0.000019')
    expect(parseUsdc(odd.creator) + parseUsdc(odd.platform)).toBe(parseUsdc(odd.price))
  })

  it('keeps creator + platform === price for a wide range of prices', () => {
    const prices = ['0.01', '0.33', '1.00', '7.77', '10.00', '19.99', '123.456789', '999999.99']

    for (const price of prices) {
      const { creator, platform } = previewEconomics(price)
      expect(parseUsdc(creator) + parseUsdc(platform)).toBe(parseUsdc(price))
    }
  })

  it('gives the creator the remainder, never less than 95%', () => {
    const { creator, platform } = previewEconomics('19.99')
    expect(parseUsdc(platform)).toBe(999_500n)
    expect(parseUsdc(creator)).toBe(18_990_500n)
  })
})

describe('validatePriceInput', () => {
  it('accepts valid prices', () => {
    expect(validatePriceInput('10.00')).toBeNull()
    expect(validatePriceInput('0.01')).toBeNull()
    expect(validatePriceInput(' 5 ')).toBeNull()
  })

  it('rejects empty, non-numeric, zero and over-precise input', () => {
    expect(validatePriceInput('')).toBe('Укажите цену архива')
    expect(validatePriceInput('abc')).toContain('числом')
    expect(validatePriceInput('0')).toContain('больше нуля')
    expect(validatePriceInput('0.00')).toContain('больше нуля')
    expect(validatePriceInput('1.1234567')).toContain('знаков после запятой')
  })
})
