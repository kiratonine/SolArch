import { waitFor } from '@testing-library/react'
import { afterEach, describe, expect, it } from 'vitest'

import { server } from '@/mocks/node'
import { renderApp } from '@/test/render'

/**
 * Просмотр засчитывает backend — на каждый запрос карточки архива (ответ на Q10).
 *
 * Наведение на карточку каталога прогревает страницу заранее, и прогрев не имеет
 * права стать просмотром: иначе автору накручивает мышь, а не посетители.
 */

afterEach(() => {
  server.events.removeAllListeners()
})

describe('просмотры', () => {
  it('прогрев страницы архива не запрашивает карточку — только опись', async () => {
    const asked: string[] = []
    server.events.on('request:start', ({ request }) => {
      asked.push(new URL(request.url).pathname)
    })

    const { router } = renderApp({ path: '/' })
    await router.preloadRoute({
      to: '/archives/$slug',
      params: { slug: 'solana-program-security' },
    })

    // Опись греется и по наведению: её чтение ничего не считает.
    await waitFor(() => {
      expect(asked).toContain('/v1/marketplace/archives/solana-program-security/files')
    })
    expect(asked).not.toContain('/v1/marketplace/archives/solana-program-security')
  })
})
