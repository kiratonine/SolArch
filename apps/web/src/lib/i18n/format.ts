import type { Locale } from './locale'

/**
 * Форматирование чисел, размеров и дат под текущую локаль.
 *
 * Всё считает платформа через `Intl`: разделители разрядов («18,420» против «18 420»),
 * названия единиц («MB» против «МБ») и падежи месяцев мы не пишем руками.
 *
 * Денег здесь намеренно нет. Суммы приходят с backend строкой («49.00») и выводятся
 * ровно так, как пришли: любой пересчёт — это float, а он запрещён `docs/PAYMENTS.md` §5.
 */

/** Единицы CLDR идут десятичными шагами, поэтому делим на 1000, а не на 1024. */
const BYTE_UNITS = ['byte', 'kilobyte', 'megabyte', 'gigabyte', 'terabyte'] as const

export interface Formatters {
  /** 18420 → «18,420» / «18 420» */
  count(value: number): string
  /** 4915200 → «4.9 MB» / «4,9 МБ» */
  bytes(value: number): string
  /** ISO-строка → «12 April 2026» / «12 апреля 2026 г.» */
  date(iso: string): string
  /** 0.234 → «23.4%» */
  percent(ratio: number): string
}

export function createFormatters(locale: Locale): Formatters {
  const number = new Intl.NumberFormat(locale)
  const percent = new Intl.NumberFormat(locale, { style: 'percent', maximumFractionDigits: 1 })
  const date = new Intl.DateTimeFormat(locale, { day: 'numeric', month: 'long', year: 'numeric' })
  const byteFormatters = new Map<string, Intl.NumberFormat>()

  function byteFormatter(
    unit: string,
    maximumFractionDigits: number,
    unitDisplay: 'short' | 'long',
  ): Intl.NumberFormat {
    const key = `${unit}:${maximumFractionDigits}:${unitDisplay}`
    let formatter = byteFormatters.get(key)
    if (!formatter) {
      formatter = new Intl.NumberFormat(locale, {
        style: 'unit',
        unit,
        unitDisplay,
        maximumFractionDigits,
      })
      byteFormatters.set(key, formatter)
    }
    return formatter
  }

  return {
    count: (value) => number.format(value),

    bytes(value) {
      let scaled = Math.max(0, value)
      let step = 0
      while (scaled >= 1000 && step < BYTE_UNITS.length - 1) {
        scaled /= 1000
        step += 1
      }
      // Байты — всегда целые; дальше один знак нужен только пока число меньше десяти,
      // иначе «124.7 MB» шумит там, где достаточно «125 MB».
      const fractionDigits = step === 0 ? 0 : scaled < 10 ? 1 : 0
      // Сокращения CLDR для байта совпадают со словом и не склоняются: «0 byte»
      // читается опечаткой, хотя это и есть короткая форма. Байтам поэтому даём
      // длинную («0 bytes», «0 байт»); у kB и MB сокращение настоящее — им short.
      const display = step === 0 ? 'long' : 'short'
      // Индекс всегда в границах — цикл сам его и удерживает; `?? 'byte'` стоит
      // только затем, чтобы это увидел компилятор.
      return byteFormatter(BYTE_UNITS[step] ?? 'byte', fractionDigits, display).format(scaled)
    },

    date: (iso) => date.format(new Date(iso)),

    percent: (ratio) => percent.format(ratio),
  }
}
