import { describe, expect, it } from 'vitest'

import { publicArchivePath, publicArchiveUrl } from './public-url'

describe('публичный адрес архива', () => {
  it('собирается от origin страницы', () => {
    expect(publicArchiveUrl('solana-program-security', 'https://solarch.app')).toBe(
      'https://solarch.app/archives/solana-program-security',
    )
  })

  it('не удваивает косую черту, если origin пришёл с ней', () => {
    expect(publicArchiveUrl('brand-kit', 'https://solarch.app/')).toBe(
      'https://solarch.app/archives/brand-kit',
    )
  })

  it('экранирует slug: адрес отдают людям, и он обязан быть валидным', () => {
    expect(publicArchivePath('a b/c')).toBe('/archives/a%20b%2Fc')
  })
})
