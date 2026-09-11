import { screen, waitFor, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { HttpResponse, http } from 'msw'
import { describe, expect, it } from 'vitest'

import { API_BASE_URL, API_PREFIX } from '@/lib/api/config'
import { db } from '@/mocks/db'
import { server } from '@/mocks/node'
import { renderApp } from '@/test/render'

/**
 * Каталог целиком: настоящее дерево маршрутов, настоящий API-клиент, MSW вместо сети.
 *
 * Проверяется то, чем пользуется человек: сортировка, поиск и страница живут
 * в адресе, а не во внутреннем состоянии, поэтому любую выдачу можно переслать
 * ссылкой и вернуть кнопкой «назад».
 */

/** Заголовки карточек в порядке выдачи. */
async function cardTitles(): Promise<string[]> {
  const cards = await screen.findAllByRole('article')
  return cards.map((card) => within(card).getByRole('heading', { level: 3 }).textContent ?? '')
}

/**
 * Ждёт именно эту выдачу.
 *
 * Пока идёт запрос, на экране намеренно остаётся прошлый список (`keepPreviousData`),
 * поэтому одиночная проверка после перехода поймала бы старые карточки.
 */
async function expectTitles(expected: string[]): Promise<void> {
  await waitFor(async () => {
    expect(await cardTitles()).toEqual(expected)
  })
}

describe('каталог', () => {
  it('показывает опубликованные архивы и скрывает черновик', async () => {
    renderApp()

    const titles = await cardTitles()

    expect(titles).toContain('Solana Program Security')
    expect(titles).not.toContain('Untitled research notes')
  })

  it('говорит, что архив забирают до оплаты, а платят в Viewer', async () => {
    renderApp()
    await cardTitles()

    // Единственное место, где это сказано на главной: подзаголовок каталога.
    // Блок трёх шагов убран на S4, объяснения из подвала — на S5; развёрнутый
    // рассказ уедет на отдельную страницу «как это работает».
    expect(
      screen.getByText(/Take any archive without an account\. Payment happens later/),
    ).toBeInTheDocument()
  })

  it('применяет сортировку из адреса', async () => {
    renderApp({ path: '/?sort=price_asc' })

    const titles = await cardTitles()
    expect(titles[0]).toBe('Analog Film Pack')

    const sorts = within(screen.getByRole('navigation', { name: 'Sort' })).getAllByRole('link')
    const current = sorts.filter((link) => link.getAttribute('aria-current') === 'page')

    expect(current).toHaveLength(1)
    expect(current[0]).toHaveAccessibleName('Lowest price')
  })

  it('переживает выдуманную сортировку в адресе', async () => {
    renderApp({ path: '/?sort=по-настроению' })

    // Мусор гасится до значения по умолчанию, каталог всё равно рисуется.
    expect((await cardTitles()).length).toBeGreaterThan(0)
    expect(screen.getByRole('link', { name: 'This week' })).toHaveAttribute('aria-current', 'page')
  })

  it('меняет сортировку кликом и записывает её в адрес', async () => {
    const user = userEvent.setup()
    const { router } = renderApp()
    await cardTitles()

    await user.click(screen.getByRole('link', { name: 'Highest price' }))

    await waitFor(() => {
      expect(router.state.location.search).toMatchObject({ sort: 'price_desc' })
    })
    await waitFor(async () => {
      expect((await cardTitles())[0]).toBe('Web3 Legal Templates')
    })
  })

  it('фильтрует каталог запросом из адреса', async () => {
    renderApp({ path: '/?q=solana' })

    const titles = await cardTitles()
    expect(titles).toEqual(['Solana Program Security', 'Solana Anchor Cookbook'])
  })

  it('переносит набранный запрос в адрес', async () => {
    const user = userEvent.setup()
    const { router } = renderApp()
    await cardTitles()

    await user.type(screen.getByRole('searchbox', { name: 'Search the catalog' }), 'nebula')

    await waitFor(
      () => {
        expect(router.state.location.search).toMatchObject({ q: 'nebula' })
      },
      { timeout: 2000 },
    )
    await expectTitles(['Nebula Brand Kit'])
  })

  it('ищет и по полному описанию, а не только по названию', async () => {
    // Как backend (ответ на Q11): название и оба описания. Слово стоит только
    // в полном описании архива.
    renderApp({ path: `/?q=${encodeURIComponent('токенсейл')}` })

    await expectTitles(['Web3 Legal Templates'])
  })

  it('по имени автора не ищет — как и backend', async () => {
    // У backend имя автора — сокращённый адрес кошелька, и в поиске оно не участвует.
    renderApp({ path: '/?q=Studio%20Kirn' })

    expect(
      await screen.findByRole('heading', { name: 'Nothing matches “Studio Kirn”' }),
    ).toBeInTheDocument()
  })

  it('называет пустую выдачу поиска запросом, а не общей пустотой', async () => {
    renderApp({ path: '/?q=нетнетнет' })

    expect(
      await screen.findByRole('heading', { name: 'Nothing matches “нетнетнет”' }),
    ).toBeInTheDocument()
    // Общая пустота каталога — другое состояние, здесь его быть не должно.
    expect(screen.queryByText('Nothing is published yet')).not.toBeInTheDocument()
  })

  it('очищает поиск ссылкой из пустого состояния', async () => {
    const user = userEvent.setup()
    const { router } = renderApp({ path: '/?q=нетнетнет' })

    await user.click(await screen.findByRole('link', { name: 'Clear the search' }))

    await waitFor(() => {
      expect(router.state.location.search).toEqual({})
    })
    expect((await cardTitles()).length).toBeGreaterThan(0)
  })

  it('разбивает выдачу на страницы и переходит на вторую', async () => {
    const user = userEvent.setup()
    const { router } = renderApp()

    expect((await cardTitles()).length).toBe(6)
    expect(screen.getByText('Page 1 of 2')).toBeInTheDocument()

    await user.click(screen.getByRole('link', { name: 'Next' }))

    await waitFor(() => {
      expect(router.state.location.search).toMatchObject({ page: 2 })
    })
    await waitFor(() => {
      expect(screen.getByText('Page 2 of 2')).toBeInTheDocument()
    })
    await waitFor(async () => {
      expect((await cardTitles()).length).toBe(3)
    })
  })

  it('открывает страницу архива по карточке', async () => {
    const user = userEvent.setup()
    const { router } = renderApp()
    await cardTitles()

    await user.click(screen.getByRole('link', { name: 'Solana Program Security' }))

    await waitFor(() => {
      expect(router.state.location.pathname).toBe('/archives/solana-program-security')
    })
  })

  it('переводит управление каталогом на русский', async () => {
    renderApp({ locale: 'ru' })
    await cardTitles()

    expect(screen.getByRole('link', { name: 'Сначала дешевле' })).toBeInTheDocument()
    expect(screen.getByText('Страница 1 из 2')).toBeInTheDocument()
  })
})

/**
 * Каталог рисует одну из четырёх взаимоисключающих веток: выдача, сбой, пустой
 * поиск и пустой каталог. Первые две проверены выше, здесь — оставшиеся две.
 *
 * Отличать их важно словами, а не только фактом пустоты: «ничего не нашлось по
 * запросу» и «пока ничего не опубликовано» ведут человека в разные стороны, и
 * перепутать их — значит сказать гостю, что маркетплейс пуст, когда он просто
 * ошибся в запросе.
 */
describe('состояния каталога', () => {
  it('называет сбой каталога и даёт повторить', async () => {
    server.use(
      http.get(`${API_BASE_URL}${API_PREFIX}/marketplace/archives`, () =>
        HttpResponse.json({ code: 'INTERNAL', message: 'boom' }, { status: 500 }),
      ),
    )

    renderApp()

    const alert = await screen.findByRole('alert')
    expect(within(alert).getByText('The catalog did not load')).toBeInTheDocument()
    expect(within(alert).getByRole('button', { name: 'Try again' })).toBeInTheDocument()

    // Сбой — не пустота: приглашений и предложений очистить поиск здесь нет.
    expect(screen.queryByText('Nothing is published yet')).toBeNull()
    expect(screen.queryByRole('article')).toBeNull()
  })

  it('повтор после сбоя доносит каталог', async () => {
    const user = userEvent.setup()
    server.use(
      http.get(
        `${API_BASE_URL}${API_PREFIX}/marketplace/archives`,
        () => HttpResponse.json({ code: 'INTERNAL', message: 'boom' }, { status: 500 }),
        { once: true },
      ),
    )

    renderApp()

    await user.click(await screen.findByRole('button', { name: 'Try again' }))

    expect(await cardTitles()).toContain('Solana Program Security')
    expect(screen.queryByRole('alert')).toBeNull()
  })

  it('пустой каталог приглашает первого автора, а не сообщает об отсутствии данных', async () => {
    db.archives = []

    renderApp()

    expect(await screen.findByRole('heading', { name: 'Nothing is published yet' })).toBeInTheDocument()
    // Именно общая пустота, а не пустая выдача поиска: запроса не было.
    expect(screen.queryByText(/Nothing matches/)).toBeNull()
    expect(screen.queryByRole('link', { name: 'Clear the search' })).toBeNull()
    // Пагинация под пустым каталогом — это одна страница из ниоткуда.
    expect(screen.queryByText('Page 1 of 1')).toBeNull()
  })

  it('пустой каталог по-русски остаётся приглашением', async () => {
    db.archives = []

    renderApp({ locale: 'ru' })

    expect(await screen.findByRole('heading', { name: 'Пока ничего не опубликовано' })).toBeInTheDocument()
  })
})
