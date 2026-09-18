import { describe, expect, it } from 'vitest'

import { safeRedirect } from './redirect'

/**
 * Адрес возврата приходит из адресной строки, то есть от кого угодно.
 * Ссылку вида `/login?redirect=https://evil.example` присылают в письме именно
 * затем, чтобы вход на настоящем сайте закончился на поддельном.
 */
describe('адрес возврата после входа', () => {
  it('пропускает путь внутри приложения', () => {
    expect(safeRedirect('/dashboard/arc_1/analytics')).toBe('/dashboard/arc_1/analytics')
  })

  it('отбрасывает чужой сайт', () => {
    expect(safeRedirect('https://evil.example/dashboard')).toBe('/dashboard')
    expect(safeRedirect('//evil.example')).toBe('/dashboard')
    expect(safeRedirect('javascript:alert(1)')).toBe('/dashboard')
    // Обратный слэш браузер выпрямляет сам, и `/\host` уводит на чужой хост.
    expect(safeRedirect('/\\evil.example')).toBe('/dashboard')
  })

  it('без параметра ведёт в кабинет', () => {
    expect(safeRedirect(undefined)).toBe('/dashboard')
  })
})
