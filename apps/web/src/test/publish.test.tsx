import { screen, waitFor, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { HttpResponse, http } from 'msw'
import { describe, expect, it } from 'vitest'

import { API_BASE_URL, API_PREFIX } from '@/lib/api/config'
import { MOCK_CREATOR, db } from '@/mocks/db'
import { server } from '@/mocks/node'
import { renderApp } from '@/test/render'

/**
 * Витрина архива: публикация, снятие с публикации и предпросмотр карточки.
 *
 * Требования публикации проверяет backend (`docs/API.md` §3) — фронт только называет
 * препятствие заранее и показывает то, чем backend ответил. Поэтому здесь проверяется
 * не «разрешили ли мы», а что видит и делает автор.
 */

/** Раздел витрины: заголовок раздела задаёт его границы. */
function listing(): HTMLElement {
  const heading = screen.getByRole('heading', { name: 'The catalog' })
  const section = heading.closest('section')
  if (!section) throw new Error('Заголовок витрины не внутри раздела')
  return section
}

describe('витрина архива', () => {
  it('публикует собранный архив и отдаёт публичную ссылку', async () => {
    db.session = MOCK_CREATOR
    const user = userEvent.setup()

    renderApp({ path: '/dashboard/arc_zk_primer' })

    expect(await screen.findByText('Not in the catalog')).toBeInTheDocument()
    expect(within(listing()).queryByText('Public link')).toBeNull()

    await user.click(screen.getByRole('button', { name: 'Publish' }))

    expect(await screen.findByText('In the catalog')).toBeInTheDocument()

    // Slug выдаёт backend в момент публикации — до неё ссылки не существует.
    expect(within(listing()).getByText(/\/archives\/zero-knowledge-proof-primer$/)).toBeInTheDocument()
    expect(within(listing()).getByRole('link', { name: 'Open the public page' })).toBeInTheDocument()

    // Маркетплейсный статус в шапке меняется вместе с витриной.
    expect(screen.getByText('Published')).toBeInTheDocument()
  })

  it('копирует публичную ссылку целиком', async () => {
    db.session = MOCK_CREATOR
    const user = userEvent.setup()

    renderApp({ path: '/dashboard/arc_solana_course' })
    await screen.findByText('In the catalog')

    await user.click(screen.getByRole('button', { name: 'Copy the link' }))

    expect(await navigator.clipboard.readText()).toMatch(
      /^https?:\/\/.+\/archives\/solana-program-security$/,
    )
    expect(await screen.findByRole('button', { name: 'Copied' })).toBeInTheDocument()
  })

  it('не даёт публиковать несобранный архив и называет причину', async () => {
    db.session = MOCK_CREATOR

    renderApp({ path: '/dashboard/arc_draft_notes' })
    await screen.findByText('Not in the catalog')

    expect(screen.getByRole('button', { name: 'Publish' })).toBeDisabled()
    expect(
      screen.getByText('The container has to be built before the archive can go in the catalog.'),
    ).toBeInTheDocument()
  })

  it('не даёт публиковать, пока backend готовит USDC-аккаунт автора', async () => {
    db.session = MOCK_CREATOR

    // Аккаунт готовит backend (ADR-009); фронт только читает флаг.
    const archive = db.archives.find((item) => item.archive_id === 'arc_zk_primer')
    if (archive) archive.payout_account_ready = false

    renderApp({ path: '/dashboard/arc_zk_primer' })
    await screen.findByText('Not in the catalog')

    expect(screen.getByRole('button', { name: 'Publish' })).toBeDisabled()
    expect(screen.getByText(/still preparing the USDC account/)).toBeInTheDocument()
  })

  it('снимает архив с публикации только после подтверждения', async () => {
    db.session = MOCK_CREATOR
    const user = userEvent.setup()

    renderApp({ path: '/dashboard/arc_solana_course' })
    await screen.findByText('In the catalog')

    await user.click(screen.getByRole('button', { name: 'Unpublish' }))

    const dialog = await screen.findByRole('dialog')
    expect(within(dialog).getByText('Take the archive out of the catalog?')).toBeInTheDocument()

    // Отказ ничего не меняет: архив остаётся на витрине.
    await user.click(within(dialog).getByRole('button', { name: 'Keep it' }))
    await waitFor(() => {
      expect(screen.queryByRole('dialog')).toBeNull()
    })
    expect(screen.getByText('In the catalog')).toBeInTheDocument()

    await user.click(screen.getByRole('button', { name: 'Unpublish' }))
    const again = await screen.findByRole('dialog')
    await user.click(within(again).getByRole('button', { name: 'Unpublish' }))

    expect(await screen.findByText('Out of the catalog')).toBeInTheDocument()
    expect(screen.getByText('Unpublished')).toBeInTheDocument()
  })

  it('возвращает снятый архив в каталог', async () => {
    db.session = MOCK_CREATOR
    const user = userEvent.setup()

    renderApp({ path: '/dashboard/arc_retired_guide' })
    await screen.findByText('Out of the catalog')

    await user.click(screen.getByRole('button', { name: 'Publish' }))

    expect(await screen.findByText('In the catalog')).toBeInTheDocument()
  })

  it('заблокированному архиву публикации не предлагает', async () => {
    db.session = MOCK_CREATOR

    renderApp({ path: '/dashboard/arc_blocked_atlas' })

    expect(await screen.findByText('SolArch took this archive down')).toBeInTheDocument()
    expect(screen.queryByRole('button', { name: 'Publish' })).toBeNull()
    expect(screen.queryByRole('button', { name: 'Unpublish' })).toBeNull()
  })

  it('показывает отказ backend теми же словами, какими он его сформулировал', async () => {
    db.session = MOCK_CREATOR
    const user = userEvent.setup()

    server.use(
      http.post(`${API_BASE_URL}${API_PREFIX}/archives/:archiveId/publish`, () =>
        HttpResponse.json(
          { code: 'PAYOUT_ACCOUNT_NOT_READY', message: 'USDC-аккаунт автора ещё не готов' },
          { status: 409 },
        ),
      ),
    )

    renderApp({ path: '/dashboard/arc_zk_primer' })
    await screen.findByText('Not in the catalog')

    await user.click(screen.getByRole('button', { name: 'Publish' }))

    expect(await screen.findByText('USDC-аккаунт автора ещё не готов')).toBeInTheDocument()
    // Отказ не двигает архив: витрина осталась прежней.
    expect(screen.getByText('Not in the catalog')).toBeInTheDocument()
  })
})

describe('предпросмотр карточки каталога', () => {
  it('показывает неопубликованный архив так, как его увидит посетитель', async () => {
    db.session = MOCK_CREATOR

    renderApp({ path: '/dashboard/arc_zk_primer' })
    await screen.findByText('How the catalog will show it')

    const preview = within(listing()).getByRole('article')

    expect(within(preview).getByText('Zero-Knowledge Proof Primer')).toBeInTheDocument()
    expect(within(preview).getByText(/Aurora Labs/)).toBeInTheDocument()
    expect(within(preview).getByText('32.00')).toBeInTheDocument()

    // Публичной страницы у неопубликованного архива нет, вести с карточки некуда.
    expect(within(preview).queryByRole('link')).toBeNull()
  })

  it('опубликованному архиву показывает ссылку вместо предпросмотра', async () => {
    db.session = MOCK_CREATOR

    renderApp({ path: '/dashboard/arc_solana_course' })
    await screen.findByText('In the catalog')

    expect(screen.queryByText('How the catalog will show it')).toBeNull()
    expect(within(listing()).getByText('Public link')).toBeInTheDocument()
  })
})
