import { afterEach, describe, expect, it } from 'vitest'

import { applyTheme, detectTheme, isTheme, storeTheme } from './theme'

afterEach(() => {
  globalThis.localStorage.clear()
  document.documentElement.classList.remove('dark')
})

describe('тема', () => {
  it('узнаёт допустимые значения', () => {
    expect(isTheme('dark')).toBe(true)
    expect(isTheme('system')).toBe(false)
  })

  it('сохранённый выбор важнее системной настройки', () => {
    storeTheme('dark')
    expect(detectTheme()).toBe('dark')
  })

  it('без выбора идёт за системой', () => {
    // jsdom отвечает на prefers-color-scheme отрицательно, значит светлая.
    expect(detectTheme()).toBe('light')
  })

  it('переключает класс на корне документа', () => {
    applyTheme('dark')
    expect(document.documentElement).toHaveClass('dark')

    applyTheme('light')
    expect(document.documentElement).not.toHaveClass('dark')
  })
})
