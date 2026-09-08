import { screen, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { describe, expect, it } from 'vitest'

import { renderApp } from '@/test/render'

/**
 * Страница «как это работает» — единственное место, где продукт объяснён целиком.
 *
 * Тесты держат две вещи: что вернувшийся текст стоит именно здесь (его уже дважды
 * снимали с других мест — F41 и F55, и третий переезд должен быть заметен), и что
 * до страницы можно дойти на любой ширине, а не только там, где видна шапка.
 */

/** Заголовки шагов в порядке выдачи. */
function stepTitles(): string[] {
  const steps = within(screen.getByRole('list')).getAllByRole('listitem')
  return steps.map((step) => within(step).getByRole('heading', { level: 3 }).textContent ?? '')
}

describe('как это работает', () => {
  it('объясняет механику одной фразой в лиде', async () => {
    renderApp({ path: '/how-it-works' })

    // Та же фраза, что стояла в подвале до F55, слово в слово.
    expect(
      await screen.findByText(
        /An \.slr file downloads for free and travels like any other file\. Paying in USDC inside the SolArch Viewer is what opens it\./,
      ),
    ).toBeInTheDocument()
  })

  it('возвращает три шага механики в прежнем порядке', async () => {
    renderApp({ path: '/how-it-works' })
    await screen.findByRole('heading', { level: 1, name: 'How it works' })

    expect(stepTitles()).toEqual(['Take the file', 'Open it in the Viewer', 'Pay once in USDC'])
    expect(screen.getByText(/without an account/)).toBeInTheDocument()
    expect(screen.getByText(/stays sealed until the desktop SolArch Viewer/)).toBeInTheDocument()
  })

  it('говорит автору про 95% и про неизменную цену', async () => {
    renderApp({ path: '/how-it-works' })

    const heading = await screen.findByRole('heading', { name: 'If you want to sell something' })
    const section = heading.closest('section')
    expect(section).not.toBeNull()

    expect(within(section!).getByText('Creators keep 95% of every sale.')).toBeInTheDocument()
    expect(within(section!).getByText(/cannot be changed later/)).toBeInTheDocument()
    // Кошелёк автора non-custodial — это обещание, а не деталь вёрстки.
    expect(within(section!).getByText(/never holds it and never asks for your keys/)).toBeInTheDocument()
  })

  it('не обещает Viewer, которого ещё негде взять', async () => {
    renderApp({ path: '/how-it-works' })
    await screen.findByRole('heading', { level: 1, name: 'How it works' })

    // Q6 открыт: ссылки на дистрибутив на сайте нет ни одной, и страница
    // не должна изображать её раньше времени.
    expect(screen.queryByRole('link', { name: 'Get the Viewer' })).not.toBeInTheDocument()
  })

  it('открывается из подвала, а не только из шапки', async () => {
    renderApp()
    await screen.findAllByRole('article')

    const map = screen.getByRole('navigation', { name: 'Site pages' })
    await userEvent.click(within(map).getByRole('link', { name: 'How it works' }))

    expect(
      await screen.findByRole('heading', { level: 1, name: 'How it works' }),
    ).toBeInTheDocument()
  })

  it('ведёт обратно в каталог', async () => {
    renderApp({ path: '/how-it-works' })

    await userEvent.click(await screen.findByRole('link', { name: 'Browse the catalog' }))

    expect((await screen.findAllByRole('article')).length).toBeGreaterThan(0)
  })

  it('переведена целиком', async () => {
    renderApp({ path: '/how-it-works', locale: 'ru' })

    await screen.findByRole('heading', { level: 1, name: 'Как это работает' })
    expect(stepTitles()).toEqual([
      'Заберите файл',
      'Откройте его в Viewer',
      'Заплатите один раз в USDC',
    ])
    expect(screen.getByText('Автор получает 95% с каждой продажи.')).toBeInTheDocument()
  })
})
