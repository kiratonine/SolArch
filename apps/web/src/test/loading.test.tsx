import { screen, waitFor, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { delay, http } from 'msw'
import { describe, expect, it } from 'vitest'

import { ArchiveCardSkeleton } from '@/components/state/archive-card-skeleton'
import { API_BASE_URL, API_PREFIX } from '@/lib/api/config'
import { server } from '@/mocks/node'
import { renderApp, renderWithI18n } from '@/test/render'
import { signIn } from '@/test/session'

/**
 * Состояния загрузки — единственный слой из `docs/TESTING.md` §5, который рос
 * вместе с экранами, но ни разу не был проверен: скелеты видны только в те
 * миллисекунды, пока идёт запрос, и обычный тест пролетает мимо них к готовым
 * данным.
 *
 * Проверяется здесь не картинка, а два обещания, записанные комментариями в
 * коде и больше ничем не удержанные:
 *
 * 1. пока данных нет — на их месте стоит скелет той же геометрии, поэтому
 *    страница не переставляется, когда данные приходят;
 * 2. пока обновляются уже показанные данные — скелета нет вовсе: прошлая
 *    выдача остаётся на экране приглушённой (`keepPreviousData`).
 *
 * Второе важнее первого: схлопывание готовой страницы в скелет при каждой смене
 * сортировки или периода — это и есть та ошибка, от которой защищались.
 */

/**
 * Задержать ответ, не подменяя его.
 *
 * Резолвер ничего не возвращает, и MSW передаёт запрос дальше — настоящему
 * обработчику мока. Так тест ловит состояние ожидания, не выдумывая данных:
 * придут те же самые, что и без задержки.
 */
function slow(path: string, ms = 200) {
  return http.get(`${API_BASE_URL}${API_PREFIX}${path}`, async () => {
    await delay(ms)
  })
}

describe('пока данных нет', () => {
  it('каталог держит место карточками-скелетами, а не пустотой', async () => {
    server.use(slow('/marketplace/archives'))

    renderApp()

    const loading = await screen.findByLabelText('Loading the catalog')
    expect(loading).toHaveAttribute('aria-busy', 'true')
    // Скелет занимает место ровно тех карточек, которых ещё нет.
    expect(screen.queryAllByRole('article')).toHaveLength(0)

    // Приходят настоящие данные — и место занимают они.
    expect(
      await screen.findByRole('heading', { name: 'Solana Program Security' }),
    ).toBeInTheDocument()
    expect(screen.queryByLabelText('Loading the catalog')).toBeNull()
  })

  it('страница архива ждёт скелетом, а не пустым разворотом', async () => {
    server.use(slow('/marketplace/archives/:slug'))

    renderApp({ path: '/archives/solana-program-security' })

    expect(await screen.findByLabelText('Loading the archive')).toHaveAttribute(
      'aria-busy',
      'true',
    )
    expect(screen.queryByRole('heading', { level: 1 })).toBeNull()

    expect(
      await screen.findByRole('heading', { level: 1, name: 'Solana Program Security' }),
    ).toBeInTheDocument()
    expect(screen.queryByLabelText('Loading the archive')).toBeNull()
  })

  it('опись файлов грузится отдельно и не задерживает цену с кнопкой', async () => {
    server.use(slow('/marketplace/archives/:slug/files'))

    renderApp({ path: '/archives/solana-program-security' })

    // Архив уже на экране целиком: описание, цена, кнопка. Ждёт только опись —
    // это два разных запроса и две разные судьбы.
    expect(await screen.findByRole('heading', { level: 1 })).toBeInTheDocument()
    expect(screen.getByRole('link', { name: 'Download .slr' })).toBeInTheDocument()
    expect(screen.getByLabelText('Loading the file list')).toHaveAttribute('aria-busy', 'true')

    expect(await screen.findByText('read-me-first.pdf')).toBeInTheDocument()
    expect(screen.queryByLabelText('Loading the file list')).toBeNull()
  })

  it('кабинет ждёт скелетами, а не приглашением создать первый архив', async () => {
    signIn()
    server.use(slow('/archives'))

    renderApp({ path: '/dashboard' })

    expect(await screen.findByLabelText('Loading your archives')).toHaveAttribute(
      'aria-busy',
      'true',
    )
    // Пустой экран здесь был бы ложью: архивы есть, они ещё не доехали.
    expect(screen.queryByText('You have no archives yet')).toBeNull()

    expect(
      await screen.findByRole('heading', { name: 'Solana Program Security' }),
    ).toBeInTheDocument()
    expect(screen.queryByLabelText('Loading your archives')).toBeNull()
  })

  it('аналитика ждёт скелетом вместо трёх нулей', async () => {
    signIn()
    server.use(slow('/archives/:archiveId/analytics'))

    renderApp({ path: '/dashboard/arc_solana_course/analytics' })

    // Заголовок и переключатель периодов уже стоят: они не зависят от ответа.
    expect(await screen.findByRole('heading', { name: 'Analytics' })).toBeInTheDocument()
    // А вот цифр нет: ни настоящих, ни нулей вместо них.
    expect(screen.queryByText('18,420')).toBeNull()
    expect(screen.queryByText('From a view to an unlock')).toBeNull()

    expect(await screen.findByText('18,420')).toBeInTheDocument()
  })

  it('скелет карточки не читается вслух: он про место, а не про содержание', () => {
    const { container } = renderWithI18n(<ArchiveCardSkeleton />)

    expect(container.firstElementChild).toHaveAttribute('aria-hidden', 'true')
  })
})

/**
 * Второе обещание: у страницы, которая уже что-то показывает, скелета быть не
 * должно. Смена сортировки, страницы или периода не сбрасывает высоту экрана —
 * прошлые данные ждут новых на своём месте.
 */
describe('пока данные обновляются', () => {
  it('каталог не схлопывается в скелет при смене сортировки', async () => {
    renderApp()
    await screen.findAllByRole('article')

    server.use(slow('/marketplace/archives'))
    await userEvent.click(screen.getByRole('link', { name: 'Lowest price' }))

    // Прошлая выдача на месте, скелета нет.
    expect(screen.queryByLabelText('Loading the catalog')).toBeNull()
    expect(screen.getAllByRole('article').length).toBeGreaterThan(0)

    // Дождавшись новой выдачи, проверяем, что она действительно новая.
    await waitFor(() => {
      const [first] = screen.getAllByRole('article')
      if (!first) throw new Error('Каталог остался без карточек')
      expect(within(first).getByRole('heading', { level: 3 })).toHaveTextContent(
        'Analog Film Pack',
      )
    })
  })

  it('каталог не схлопывается в скелет при переходе на вторую страницу', async () => {
    renderApp()
    await screen.findAllByRole('article')

    server.use(slow('/marketplace/archives'))
    await userEvent.click(screen.getByRole('link', { name: 'Next' }))

    expect(screen.queryByLabelText('Loading the catalog')).toBeNull()
    expect(screen.getAllByRole('article').length).toBeGreaterThan(0)

    await waitFor(() => {
      expect(screen.getByText('Page 2 of 2')).toBeInTheDocument()
    })
  })

  it('аналитика не роняет цифры в скелет при смене периода', async () => {
    signIn()

    renderApp({ path: '/dashboard/arc_solana_course/analytics' })
    expect(await screen.findByText('18,420')).toBeInTheDocument()

    server.use(slow('/archives/:archiveId/analytics'))
    await userEvent.click(screen.getByRole('link', { name: 'Last 7 days' }))

    // Прошлые цифры остаются на экране, пока считается новое окно.
    expect(screen.getByText('18,420')).toBeInTheDocument()

    await waitFor(() => {
      expect(screen.queryByText('18,420')).toBeNull()
    })
  })
})
