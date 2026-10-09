import { describe, expect, it } from 'vitest'

import { en } from './dict.en'
import { ru } from './dict.ru'
import { createFormatters } from './format'
import { detectLocale, isLocale, storeLocale } from './locale'
import { makePlural } from './plural'

/** Пути до всех листьев словаря — строк и функций. */
function keyPaths(value: unknown, prefix = ''): string[] {
  if (typeof value !== 'object' || value === null) return [prefix]

  return Object.entries(value).flatMap(([key, nested]) =>
    keyPaths(nested, prefix ? `${prefix}.${key}` : key),
  )
}

describe('словари', () => {
  it('en и ru совпадают по набору ключей', () => {
    // Тип `Dictionary` уже держит это на tsc; тест ловит случай, когда кто-то
    // ослабит типизацию словаря, чтобы «быстро добавить ключ».
    expect(keyPaths(ru).sort()).toEqual(keyPaths(en).sort())
  })

  it('ни одна строка не осталась пустой', () => {
    for (const dict of [en, ru]) {
      const empty = keyPaths(dict).filter((path) => {
        const value = path
          .split('.')
          .reduce<unknown>((node, key) => (node as Record<string, unknown>)[key], dict)
        return typeof value === 'string' && value.trim() === ''
      })
      expect(empty).toEqual([])
    }
  })
})

describe('плюрализация', () => {
  it('русский различает три формы', () => {
    expect(ru.units.files(1)).toBe('файл')
    expect(ru.units.files(2)).toBe('файла')
    expect(ru.units.files(5)).toBe('файлов')
    expect(ru.units.files(11)).toBe('файлов')
    expect(ru.units.files(21)).toBe('файл')
    expect(ru.units.files(0)).toBe('файлов')
  })

  it('английский различает две', () => {
    expect(en.units.files(1)).toBe('file')
    expect(en.units.files(2)).toBe('files')
    expect(en.units.files(0)).toBe('files')
  })

  it('падает на форму other, если нужная не описана', () => {
    const plural = makePlural('ru')
    expect(plural(2, { other: 'штук' })).toBe('штук')
  })
})

describe('форматирование', () => {
  it('разделяет разряды по правилам локали', () => {
    expect(createFormatters('en').count(18_420)).toBe('18,420')
    // Русский группирует неразрывным пробелом, а не запятой.
    expect(createFormatters('ru').count(18_420)).toMatch(/^18\s420$/u)
  })

  it('переводит байты в единицы локали', () => {
    const en = createFormatters('en')
    const ru = createFormatters('ru')

    expect(en.bytes(820)).toMatch(/^820\s*(byte|B)/u)
    expect(en.bytes(1_500_000)).toMatch(/^1\.5\s*MB$/u)
    expect(en.bytes(124_700_000)).toMatch(/^125\s*MB$/u)
    expect(ru.bytes(1_500_000)).toMatch(/^1,5\s*МБ$/u)
  })

  it('не показывает дробную часть у целых байтов', () => {
    expect(createFormatters('en').bytes(999)).toMatch(/^999\s*(byte|B)/u)
  })

  it('считает комиссию процентом', () => {
    expect(createFormatters('en').percent(500 / 10_000)).toMatch(/^5\s*%$/u)
  })

  it('склоняет месяц в дате', () => {
    expect(createFormatters('ru').date('2026-04-12T09:00:00Z')).toContain('апреля')
    expect(createFormatters('en').date('2026-04-12T09:00:00Z')).toContain('April')
  })
})

describe('выбор локали', () => {
  it('узнаёт поддерживаемые коды', () => {
    expect(isLocale('ru')).toBe(true)
    expect(isLocale('de')).toBe(false)
    expect(isLocale(null)).toBe(false)
  })

  it('сохранённый выбор важнее языка браузера', () => {
    storeLocale('ru')
    expect(detectLocale()).toBe('ru')

    globalThis.localStorage.clear()
    expect(detectLocale()).toBe('en')
  })
})
