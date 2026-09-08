import { screen, waitFor, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { HttpResponse, http } from 'msw'
import { describe, expect, it } from 'vitest'

import { API_BASE_URL, API_PREFIX } from '@/lib/api/config'
import { MOCK_CREATOR, db } from '@/mocks/db'
import { server } from '@/mocks/node'
import { renderApp } from '@/test/render'

/**
 * Аналитика архива.
 *
 * Ни одно число здесь фронт не считает: просмотры, скачивания, открытия, обе
 * конверсии и вся выручка приходят посчитанными. Поэтому проверяется не арифметика,
 * а то, что автор видит ответ backend целиком и в правильном окне наблюдения.
 *
 * Числа взяты из фикстуры `arc_solana_course`: 18 420 просмотров, 4 210 скачиваний,
 * 612 открытий по цене 49.00 USDC.
 */

const ANALYTICS_URL = `${API_BASE_URL}${API_PREFIX}/archives/:archiveId/analytics`

function report(): HTMLElement {
  const heading = screen.getByRole('heading', { name: 'From a view to an unlock' })
  const section = heading.closest('section')
  if (!section) throw new Error('Заголовок воронки не внутри раздела')
  return section
}

describe('аналитика архива', () => {
  it('показывает воронку и обе конверсии за всё время', async () => {
    db.session = MOCK_CREATOR

    renderApp({ path: '/dashboard/arc_solana_course/analytics' })

    expect(await screen.findByRole('heading', { name: 'Analytics' })).toBeInTheDocument()
    // Страница называет архив, о котором говорит: цифры без него — просто цифры.
    expect(await screen.findByText('Solana Program Security')).toBeInTheDocument()

    const funnel = within(report())
    expect(await funnel.findByText('18,420')).toBeInTheDocument()
    expect(funnel.getByText('4,210')).toBeInTheDocument()
    expect(funnel.getByText('612')).toBeInTheDocument()

    // Конверсии посчитал backend; фронт ставит каждую между её шагами.
    expect(funnel.getByText('22.9%')).toBeInTheDocument()
    expect(funnel.getByText('of views ended in a download')).toBeInTheDocument()
    expect(funnel.getByText('14.5%')).toBeInTheDocument()
    expect(funnel.getByText('of downloads ended in a paid unlock')).toBeInTheDocument()
  })

  it('показывает выручку тем же расщеплением 95 / 5, что и цена', async () => {
    db.session = MOCK_CREATOR

    renderApp({ path: '/dashboard/arc_solana_course/analytics' })

    // 49.00 × 612 открытий, дальше комиссия 5 % и остаток автору — считает backend.
    expect(await screen.findByText('29988.00')).toBeInTheDocument()
    expect(screen.getByText('28488.60')).toBeInTheDocument()
    expect(screen.getByText('1499.40')).toBeInTheDocument()

    expect(screen.getByText('Your payout')).toBeInTheDocument()
    // Ставку комиссии называет архив: в ответе аналитики есть суммы, но не bps.
    expect(screen.getByText('5%')).toBeInTheDocument()
  })

  it('открывается на периоде по умолчанию — за всё время', async () => {
    db.session = MOCK_CREATOR

    renderApp({ path: '/dashboard/arc_solana_course/analytics' })

    const nav = await screen.findByRole('navigation', { name: 'Period' })
    expect(within(nav).getByRole('link', { name: 'All time' })).toHaveAttribute(
      'aria-current',
      'page',
    )
  })

  it('сужает окно наблюдения и кладёт период в адрес', async () => {
    db.session = MOCK_CREATOR
    const user = userEvent.setup()

    const { router } = renderApp({ path: '/dashboard/arc_solana_course/analytics' })
    await screen.findByText('18,420')

    await user.click(screen.getByRole('link', { name: 'Last 7 days' }))

    // Ссылку можно переслать: период живёт в адресе, а не в состоянии компонента.
    await waitFor(() => {
      expect(router.state.location.searchStr).toContain('period=7d')
    })

    expect(await screen.findByText('2,210')).toBeInTheDocument()
    expect(screen.queryByText('18,420')).toBeNull()

    // Конверсии тоже принадлежат окну, а не архиву целиком: в узком окне часть
    // просмотров ещё не успела превратиться в покупку.
    expect(screen.getByText('10.2%')).toBeInTheDocument()
    expect(screen.queryByText('14.5%')).toBeNull()
  })

  it('открывает период из адреса, а не из умолчания', async () => {
    db.session = MOCK_CREATOR

    renderApp({ path: '/dashboard/arc_solana_course/analytics?period=30d' })

    const nav = await screen.findByRole('navigation', { name: 'Period' })
    expect(within(nav).getByRole('link', { name: 'Last 30 days' })).toHaveAttribute(
      'aria-current',
      'page',
    )
    // 38 % от 18 420 — доля периода в моке; число целиком приходит с backend.
    expect(await screen.findByText('7,000')).toBeInTheDocument()
  })

  it('битый период в адресе даёт аналитику за всё время, а не белый экран', async () => {
    db.session = MOCK_CREATOR

    renderApp({ path: '/dashboard/arc_solana_course/analytics?period=yesterday' })

    expect(await screen.findByText('18,420')).toBeInTheDocument()
  })

  it('вместо трёх нулей говорит, что считать пока нечего', async () => {
    db.session = MOCK_CREATOR

    // Собранный, но ни разу не опубликованный архив: событий у него не было.
    renderApp({ path: '/dashboard/arc_zk_primer/analytics' })

    expect(await screen.findByText('Nothing counted yet')).toBeInTheDocument()
    expect(screen.queryByRole('heading', { name: 'From a view to an unlock' })).toBeNull()
    expect(screen.queryByRole('heading', { name: 'What the archive earned' })).toBeNull()
  })

  it('чужой архив для автора не существует', async () => {
    db.session = MOCK_CREATOR

    renderApp({ path: '/dashboard/arc_brand_kit/analytics' })

    expect(await screen.findByText('No such archive')).toBeInTheDocument()
  })

  it('гостя на аналитику не пускает', async () => {
    renderApp({ path: '/dashboard/arc_solana_course/analytics' })

    expect(
      await screen.findByRole('heading', { name: 'Sign in with your wallet' }),
    ).toBeInTheDocument()
  })

  it('сбой аналитики не уносит страницу и даёт повторить', async () => {
    db.session = MOCK_CREATOR
    const user = userEvent.setup()

    let attempts = 0
    server.use(
      http.get(ANALYTICS_URL, () => {
        attempts += 1
        if (attempts === 1) {
          return HttpResponse.json(
            { code: 'INTERNAL', message: 'Аналитика временно недоступна', request_id: 'req_1' },
            { status: 500 },
          )
        }
        return undefined
      }),
    )

    renderApp({ path: '/dashboard/arc_solana_course/analytics' })

    expect(await screen.findByText('The analytics did not load')).toBeInTheDocument()
    // Название архива — отдельный запрос и отдельная судьба: оно осталось на месте.
    expect(screen.getByText('Solana Program Security')).toBeInTheDocument()

    await user.click(screen.getByRole('button', { name: 'Try again' }))

    expect(await screen.findByText('18,420')).toBeInTheDocument()
  })

  it('открывается со страницы архива, прямо с манифеста', async () => {
    db.session = MOCK_CREATOR
    const user = userEvent.setup()

    const { router } = renderApp({ path: '/dashboard/arc_solana_course' })
    await screen.findByRole('heading', { name: 'Solana Program Security', level: 1 })

    await user.click(screen.getByRole('link', { name: 'Analytics' }))

    await waitFor(() => {
      expect(router.state.location.pathname).toBe('/dashboard/arc_solana_course/analytics')
    })
    expect(
      await screen.findByRole('heading', { name: 'From a view to an unlock' }),
    ).toBeInTheDocument()
  })
})
