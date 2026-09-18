import { render, screen } from '@testing-library/react'
import { describe, expect, it } from 'vitest'

import { Button } from '@/components/ui/button'

/**
 * Проверяет сам тестовый стенд: TSX, алиас `@/`, Testing Library,
 * матчеры jest-dom и запуск MSW-сервера из setup.ts.
 */
describe('test harness', () => {
  it('renders a shadcn button built on Base UI', () => {
    render(<Button>Download .slr</Button>)

    const button = screen.getByRole('button', { name: 'Download .slr' })
    expect(button).toBeInTheDocument()
    expect(button).toBeEnabled()
  })
})
