import { screen, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { describe, expect, it, vi } from 'vitest'

import { UploadQueue } from '@/components/upload/upload-queue'
import type { UploadItem } from '@/lib/use-archive-upload'
import { renderWithI18n } from '@/test/render'

/**
 * Очередь передачи как экран, а не как поведение.
 *
 * Сама передача проверена на `archive-detail.test.tsx`: выбор уходит одним ZIP,
 * упавший остаётся в очереди, формат отсеивается до сети. Чего там проверить
 * нельзя — это ход передачи: `XMLHttpRequest.upload.onprogress` в jsdom
 * срабатывает как придётся, и промежуточные доли до экрана не доезжают.
 * Поэтому доля подаётся сюда напрямую, а проверяется то, что видит автор:
 * полоса, процент и то, какие кнопки при каком статусе вообще предлагают.
 */

const BASE: UploadItem = {
  id: 'up_1',
  name: 'security/00-intro.pdf',
  fileCount: 1,
  sizeBytes: 820 * 1024,
  status: 'queued',
  ratio: 0,
}

/** Строка очереди по имени файла. */
function row(name: string): HTMLElement {
  const item = screen.getByText(name).closest('li')
  if (!item) throw new Error(`Файл «${name}» не в строке очереди`)
  return item
}

function renderQueue(items: UploadItem[]) {
  const onCancel = vi.fn()
  const onRetry = vi.fn()
  const result = renderWithI18n(
    <UploadQueue items={items} onCancel={onCancel} onRetry={onRetry} />,
  )
  return { ...result, onCancel, onRetry }
}

describe('ход передачи', () => {
  it('объявляет долю числом, а не одной лишь полосой', () => {
    renderQueue([{ ...BASE, status: 'uploading', ratio: 0.42 }])

    const bar = screen.getByRole('progressbar', { name: 'Sending security/00-intro.pdf' })
    // Полоса — картинка; доля обязана быть и в дереве доступности.
    expect(bar).toHaveAttribute('aria-valuenow', '42')
    expect(bar).toHaveAttribute('aria-valuemin', '0')
    expect(bar).toHaveAttribute('aria-valuemax', '100')

    // Рядом тот же процент словами локали — округлённый так же, как полоса.
    expect(within(row(BASE.name)).getByText('42%')).toBeInTheDocument()
  })

  it('процент вытесняет слово статуса, пока файл идёт', () => {
    renderQueue([{ ...BASE, status: 'uploading', ratio: 0.07 }])

    const line = row(BASE.name)
    expect(within(line).getByText('7%')).toBeInTheDocument()
    // Два ответа на один вопрос рядом только спорят между собой.
    expect(within(line).queryByText('Waiting')).toBeNull()
    expect(within(line).queryByText('Sent')).toBeNull()
  })

  it('доля за пределами шкалы не ломает полосу', () => {
    renderQueue([
      { ...BASE, id: 'up_low', name: 'below.pdf', status: 'uploading', ratio: -0.5 },
      { ...BASE, id: 'up_high', name: 'above.pdf', status: 'uploading', ratio: 4 },
    ])

    // Ни отрицательной, ни четырёхсотпроцентной полосы: backend может прислать
    // total = 0, и деление на него не должно доезжать до экрана.
    expect(screen.getByRole('progressbar', { name: 'Sending below.pdf' })).toHaveAttribute(
      'aria-valuenow',
      '0',
    )
    expect(screen.getByRole('progressbar', { name: 'Sending above.pdf' })).toHaveAttribute(
      'aria-valuenow',
      '100',
    )
  })

  it('пакет из нескольких файлов называет их числом, а не первым именем', () => {
    renderQueue([{ ...BASE, name: 'one.pdf', fileCount: 3, status: 'uploading', ratio: 0.2 }])

    expect(screen.getByText('3 files in one ZIP')).toBeInTheDocument()
    expect(
      screen.getByRole('progressbar', { name: 'Sending 3 files in one ZIP' }),
    ).toBeInTheDocument()
    expect(screen.queryByText('one.pdf')).toBeNull()
  })

  it('полосу рисует только идущему файлу', () => {
    renderQueue([
      { ...BASE, id: 'up_q', name: 'queued.pdf', status: 'queued' },
      { ...BASE, id: 'up_u', name: 'running.pdf', status: 'uploading', ratio: 0.5 },
      { ...BASE, id: 'up_d', name: 'done.pdf', status: 'done', ratio: 1 },
      { ...BASE, id: 'up_f', name: 'failed.pdf', status: 'failed' },
    ])

    // Дошедший файл — не полоса на сто процентов, а слово «Sent».
    expect(screen.getAllByRole('progressbar')).toHaveLength(1)
    expect(within(row('done.pdf')).getByText('Sent')).toBeInTheDocument()
    expect(within(row('queued.pdf')).getByText('Waiting')).toBeInTheDocument()
    expect(within(row('failed.pdf')).getByText('Not sent')).toBeInTheDocument()
  })
})

describe('что предлагает очередь при каком статусе', () => {
  it('отменить можно идущий и ждущий файл', async () => {
    const user = userEvent.setup()
    const { onCancel } = renderQueue([
      { ...BASE, id: 'up_q', name: 'queued.pdf', status: 'queued' },
      { ...BASE, id: 'up_u', name: 'running.pdf', status: 'uploading', ratio: 0.5 },
    ])

    await user.click(within(row('running.pdf')).getByRole('button', { name: 'Cancel' }))
    expect(onCancel).toHaveBeenCalledWith('up_u')

    await user.click(within(row('queued.pdf')).getByRole('button', { name: 'Cancel' }))
    expect(onCancel).toHaveBeenCalledWith('up_q')
  })

  it('повторить предлагает только упавшему, а не отменённому', async () => {
    const user = userEvent.setup()
    const { onRetry } = renderQueue([
      { ...BASE, id: 'up_f', name: 'failed.pdf', status: 'failed', error: 'Storage refused' },
      { ...BASE, id: 'up_c', name: 'canceled.pdf', status: 'canceled' },
    ])

    // Отменённый файл автор убрал сам — возвращать его без спроса не за что.
    expect(within(row('canceled.pdf')).queryByRole('button')).toBeNull()

    await user.click(within(row('failed.pdf')).getByRole('button', { name: 'Send again' }))
    expect(onRetry).toHaveBeenCalledWith('up_f')
  })

  it('дошедшему и отменённому не предлагает ничего', () => {
    renderQueue([
      { ...BASE, id: 'up_d', name: 'done.pdf', status: 'done', ratio: 1 },
      { ...BASE, id: 'up_c', name: 'canceled.pdf', status: 'canceled' },
    ])

    expect(screen.queryByRole('button')).toBeNull()
  })

  it('причину отказа передаёт словами backend, не своими', () => {
    renderQueue([
      {
        ...BASE,
        status: 'failed',
        error: 'Storage refused the file: checksum mismatch',
      },
    ])

    expect(screen.getByText('Storage refused the file: checksum mismatch')).toBeInTheDocument()
  })
})

describe('пустая очередь', () => {
  it('не рисует ни рамки, ни заголовка, когда передавать нечего', () => {
    const { container } = renderQueue([])

    // Пустая очередь — это не пустое состояние, а отсутствие раздела:
    // рамка без строк выглядела бы сломанной загрузкой.
    expect(container).toBeEmptyDOMElement()
    expect(screen.queryByRole('region', { name: 'Files being sent' })).toBeNull()
  })

  it('под своим именем очередь находится целиком', () => {
    renderQueue([{ ...BASE, status: 'uploading', ratio: 0.5 }])

    const queue = screen.getByRole('region', { name: 'Files being sent' })
    expect(within(queue).getByText('security/00-intro.pdf')).toBeInTheDocument()
  })
})
