import { screen, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { HttpResponse, http } from 'msw'
import { describe, expect, it } from 'vitest'

import { API_BASE_URL, API_PREFIX } from '@/lib/api/config'
import { db } from '@/mocks/db'
import { server } from '@/mocks/node'
import { renderApp } from '@/test/render'
import { signIn } from '@/test/session'

/**
 * Кабинет автора: список собственных архивов.
 *
 * Проверяется настоящий путь — guard пропускает вошедшего, `GET /v1/archives`
 * отвечает из мока, карточки собираются из ответа. Ничего на этой странице
 * не вычисляется: статусы, цена, доля автора и метрики приходят готовыми.
 */

/** Карточка архива по его заголовку. */
function card(title: string): HTMLElement {
  const heading = screen.getByRole('heading', { name: title })
  const article = heading.closest('article')
  if (!article) throw new Error(`Заголовок «${title}» не внутри карточки`)
  return article
}

describe('список своих архивов', () => {
  it('показывает архивы автора и не показывает чужие', async () => {
    signIn()

    renderApp({ path: '/dashboard' })

    expect(
      await screen.findByRole('heading', { name: 'Solana Program Security' }),
    ).toBeInTheDocument()
    expect(screen.getByRole('heading', { name: 'Solana Anchor Cookbook' })).toBeInTheDocument()

    // Каталог полон чужих архивов, кабинет — нет.
    expect(screen.queryByRole('heading', { name: 'Nebula Brand Kit' })).toBeNull()
    expect(screen.queryByRole('heading', { name: 'Quant Trading Journal' })).toBeNull()
  })

  it('ставит новые архивы наверх', async () => {
    signIn()

    renderApp({ path: '/dashboard' })
    await screen.findByRole('heading', { name: 'Rust FFI Field Notes' })

    const titles = screen
      .getAllByRole('article')
      .map((article) => within(article).getByRole('heading').textContent)

    expect(titles).toEqual([
      'Zero-Knowledge Proof Primer',
      'Rust FFI Field Notes',
      'Untitled research notes',
      'Archive Scans 1997',
      'City Atlas 1928',
      'Solana Anchor Cookbook',
      'Solana Program Security',
      'Solana Validator Guide',
    ])
  })

  it('называет оба статуса порознь', async () => {
    signIn()

    renderApp({ path: '/dashboard' })
    await screen.findByRole('heading', { name: 'Solana Program Security' })

    // Готовый и опубликованный.
    const live = within(card('Solana Program Security'))
    expect(live.getByText('Ready')).toBeInTheDocument()
    expect(live.getByText('Published')).toBeInTheDocument()

    // Собран, но снят с витрины: технический статус остался прежним.
    const retired = within(card('Solana Validator Guide'))
    expect(retired.getByText('Ready')).toBeInTheDocument()
    expect(retired.getByText('Unpublished')).toBeInTheDocument()

    // Ещё собирается.
    const building = within(card('Rust FFI Field Notes'))
    expect(building.getByText('Processing')).toBeInTheDocument()
    expect(building.getByText('Draft')).toBeInTheDocument()
  })

  it('не ставит новому архиву одну и ту же подпись дважды', async () => {
    signIn()

    renderApp({ path: '/dashboard' })
    await screen.findByRole('heading', { name: 'Untitled research notes' })

    // У нового архива оба статуса — `draft`, но говорят они о разном:
    // контейнер ещё не собран, и на витрину он ещё не выставлен.
    const fresh = within(card('Untitled research notes'))
    expect(fresh.getByText('Not built')).toBeInTheDocument()
    expect(fresh.getByText('Draft')).toBeInTheDocument()
  })

  it('показывает архив готовым, как только backend закончил сборку', async () => {
    signIn()

    // Так выглядит закончившаяся сборка: backend отдаёт другой technical_status.
    const building = db.archives.find((archive) => archive.archive_id === 'arc_field_notes')
    expect(building?.technical_status).toBe('processing')
    if (building) building.processing_done_at = Date.now() - 1

    renderApp({ path: '/dashboard' })
    await screen.findByRole('heading', { name: 'Rust FFI Field Notes' })

    expect(within(card('Rust FFI Field Notes')).getByText('Ready')).toBeInTheDocument()
  })

  it('показывает цену и долю автора из ответа backend', async () => {
    signIn()

    renderApp({ path: '/dashboard' })
    await screen.findByRole('heading', { name: 'Solana Program Security' })

    const live = within(card('Solana Program Security'))
    expect(live.getByText('49.00')).toBeInTheDocument()
    // 95% от 49.00 — считает мок-backend, страница только выводит.
    expect(live.getByText('46.55')).toBeInTheDocument()
  })

  it('передаёт причину, по которой сборка не удалась', async () => {
    signIn()

    renderApp({ path: '/dashboard' })
    await screen.findByRole('heading', { name: 'Archive Scans 1997' })

    const broken = within(card('Archive Scans 1997'))
    expect(broken.getByText('Failed')).toBeInTheDocument()
    expect(broken.getByText(/scans\/roll-07\.png/)).toBeInTheDocument()
  })

  it('ведёт на публичную страницу только опубликованный архив', async () => {
    signIn()

    renderApp({ path: '/dashboard' })
    await screen.findByRole('heading', { name: 'Solana Program Security' })

    const live = within(card('Solana Program Security'))
    expect(live.getByRole('link', { name: 'Open the public page' })).toHaveAttribute(
      'href',
      '/archives/solana-program-security',
    )

    // У снятого архива публичной страницы нет — backend отвечает на неё 404.
    expect(
      within(card('Solana Validator Guide')).queryByRole('link', { name: 'Open the public page' }),
    ).toBeNull()
    expect(
      within(card('Untitled research notes')).queryByRole('link', {
        name: 'Open the public page',
      }),
    ).toBeNull()
  })

  it('ведёт из карточки в сам архив', async () => {
    signIn()

    renderApp({ path: '/dashboard' })
    await screen.findByRole('heading', { name: 'Untitled research notes' })

    // Ссылкой сделан заголовок: он и отвечает на вопрос «какой это архив».
    expect(
      within(card('Untitled research notes')).getByRole('link', {
        name: 'Untitled research notes',
      }),
    ).toHaveAttribute('href', '/dashboard/arc_draft_notes')
  })

  it('не выдаёт полей, которых нет в контракте', async () => {
    signIn()

    renderApp({ path: '/dashboard' })
    await screen.findByRole('heading', { name: 'Solana Program Security' })

    // owner_id и creator_display_name живут только внутри мока.
    expect(screen.queryByText(/usr_creator_1/)).toBeNull()
  })
})

describe('состояния кабинета', () => {
  it('говорит прямо, когда архивов ещё нет', async () => {
    signIn()
    db.archives = []

    renderApp({ path: '/dashboard' })

    expect(await screen.findByText('No archives yet')).toBeInTheDocument()
  })

  it('называет сбой и даёт повторить', async () => {
    signIn()
    server.use(
      http.get(`${API_BASE_URL}${API_PREFIX}/archives`, () =>
        HttpResponse.json({ code: 'INTERNAL', message: 'boom' }, { status: 500 }),
      ),
    )

    renderApp({ path: '/dashboard' })

    expect(await screen.findByText('Your archives did not load')).toBeInTheDocument()
    expect(screen.getByRole('button', { name: 'Try again' })).toBeInTheDocument()
  })

  it('повтор после сбоя доносит список', async () => {
    const user = userEvent.setup()
    signIn()
    server.use(
      http.get(
        `${API_BASE_URL}${API_PREFIX}/archives`,
        () => HttpResponse.json({ code: 'INTERNAL', message: 'boom' }, { status: 500 }),
        { once: true },
      ),
    )

    renderApp({ path: '/dashboard' })

    await user.click(await screen.findByRole('button', { name: 'Try again' }))

    expect(
      await screen.findByRole('heading', { name: 'Solana Program Security' }),
    ).toBeInTheDocument()
  })

  it('говорит с автором по-русски', async () => {
    signIn()

    renderApp({ path: '/dashboard', locale: 'ru' })

    expect(
      await screen.findByRole('heading', { level: 1, name: 'Ваши архивы' }),
    ).toBeInTheDocument()

    await screen.findByRole('heading', { name: 'Solana Program Security' })
    expect(within(card('Solana Program Security')).getByText('Опубликован')).toBeInTheDocument()
  })
})
