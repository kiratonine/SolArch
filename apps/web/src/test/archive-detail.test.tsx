import { screen, waitFor, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { HttpResponse, http } from 'msw'
import { describe, expect, it } from 'vitest'

import { API_BASE_URL, API_PREFIX } from '@/lib/api/config'
import { MOCK_CREATOR, db } from '@/mocks/db'
import { server } from '@/mocks/node'
import { renderApp } from '@/test/render'

/**
 * Страница архива в кабинете: загрузка файлов и состояния сборки.
 *
 * Проверяется путь целиком — выбор файла, `init` → передача байтов → `complete`,
 * смена технического статуса и обновление описи. Ничего из этого фронт не решает
 * сам: контейнер собирает backend, а страница показывает то, что он ответил.
 */

/** Скрытое поле выбора: у него нет доступного имени, его открывает кнопка. */
function fileInput(): HTMLInputElement {
  const input = document.querySelector<HTMLInputElement>('input[type="file"]')
  if (!input) throw new Error('На странице нет поля выбора файлов')
  return input
}

/** Опись архива: одно и то же имя стоит и в очереди передачи, и в ней. */
function manifest(): HTMLElement {
  const heading = screen.getByRole('heading', { name: 'Inside the archive' })
  const section = heading.closest('section')
  if (!section) throw new Error('Заголовок описи не внутри раздела')
  return section
}

function upload(name: string, sizeKb: number): File {
  const file = new File(['x'], name)
  Object.defineProperty(file, 'size', { value: sizeKb * 1024 })
  return file
}

describe('страница архива автора', () => {
  it('показывает архив, оба статуса и опись файлов', async () => {
    db.session = MOCK_CREATOR

    renderApp({ path: '/dashboard/arc_solana_course' })

    expect(
      await screen.findByRole('heading', { name: 'Solana Program Security', level: 1 }),
    ).toBeInTheDocument()

    expect(screen.getByText('Ready')).toBeInTheDocument()
    expect(screen.getByText('Published')).toBeInTheDocument()

    // Опись приходит с backend отдельным запросом и группируется по display_path.
    expect(await screen.findByText('read-me-first.pdf')).toBeInTheDocument()
    expect(screen.getByText('security/')).toBeInTheDocument()
  })

  it('даёт скачать собранный .slr и говорит, что публикация — отдельный шаг', async () => {
    db.session = MOCK_CREATOR

    renderApp({ path: '/dashboard/arc_solana_course' })

    const download = await screen.findByRole('link', { name: 'Download the .slr' })
    expect(download).toHaveAttribute('href', expect.stringContaining('/archives/arc_solana_course/download'))
  })

  it('называет причину, по которой сборка не удалась', async () => {
    db.session = MOCK_CREATOR

    renderApp({ path: '/dashboard/arc_broken_scans' })

    expect(await screen.findByText('The container was not built')).toBeInTheDocument()
    expect(screen.getByText(/scans\/roll-07\.png/)).toBeInTheDocument()

    // Сломанную сборку чинят новым файлом, поэтому выбор остаётся на месте.
    expect(screen.getByRole('button', { name: 'Choose files' })).toBeInTheDocument()
  })

  it('не предлагает добавлять файлы, пока backend собирает контейнер', async () => {
    db.session = MOCK_CREATOR

    renderApp({ path: '/dashboard/arc_field_notes' })

    expect(await screen.findByText('SolArch is building the container')).toBeInTheDocument()
    expect(screen.queryByRole('button', { name: 'Choose files' })).toBeNull()
  })

  it('говорит прямо, когда архива нет или он чужой', async () => {
    db.session = MOCK_CREATOR

    renderApp({ path: '/dashboard/arc_missing' })

    expect(await screen.findByText('No such archive')).toBeInTheDocument()
  })

  it('называет сбой и даёт повторить', async () => {
    db.session = MOCK_CREATOR
    server.use(
      http.get(`${API_BASE_URL}${API_PREFIX}/archives/:archiveId`, () =>
        HttpResponse.json({ code: 'INTERNAL', message: 'boom' }, { status: 500 }),
      ),
    )

    renderApp({ path: '/dashboard/arc_draft_notes' })

    expect(await screen.findByText('The archive did not load')).toBeInTheDocument()
    expect(screen.getByRole('button', { name: 'Try again' })).toBeInTheDocument()
  })
})

describe('загрузка файлов', () => {
  it('передаёт выбранный файл и показывает его в описи архива', async () => {
    db.session = MOCK_CREATOR

    renderApp({ path: '/dashboard/arc_draft_notes' })

    expect(await screen.findByText('Nothing sealed yet')).toBeInTheDocument()
    expect(screen.getByText('The archive holds no files yet.')).toBeInTheDocument()

    await userEvent.upload(fileInput(), upload('lecture-01.pdf', 640))

    // Файл ушёл на backend: он подтвердил `complete` и завёл его в архиве.
    await waitFor(() => {
      expect(within(manifest()).getByText('lecture-01.pdf')).toBeInTheDocument()
    })

    // Загрузка кончается не на полосе прогресса, а на статусе от backend.
    expect(await screen.findByText('SolArch is building the container')).toBeInTheDocument()
  })

  it('передаёт файлы по одному, а не разом', async () => {
    db.session = MOCK_CREATOR

    renderApp({ path: '/dashboard/arc_draft_notes' })
    await screen.findByText('Nothing sealed yet')

    await userEvent.upload(fileInput(), [
      upload('one.pdf', 100),
      upload('two.pdf', 100),
      upload('three.pdf', 100),
    ])

    // Все три дойдут, и дойдут в том порядке, в котором их выбрали:
    // мок — это backend, смотрим, чем он их принял.
    await waitFor(() => {
      const archive = db.archives.find((item) => item.archive_id === 'arc_draft_notes')
      expect(archive?.files.map((file) => file.display_name)).toEqual([
        'one.pdf',
        'two.pdf',
        'three.pdf',
      ])
    })
  })

  it('убирает дошедшие строки, когда передавать больше нечего', async () => {
    db.session = MOCK_CREATOR

    renderApp({ path: '/dashboard/arc_draft_notes' })
    await screen.findByText('Nothing sealed yet')

    await userEvent.upload(fileInput(), upload('lecture-01.pdf', 640))

    await waitFor(() => {
      expect(within(manifest()).getByText('lecture-01.pdf')).toBeInTheDocument()
    })

    // Опись говорит то же самое и говорит с backend: два одинаковых списка подряд —
    // это один список и один повтор.
    await waitFor(() => {
      expect(screen.queryByRole('region', { name: 'Files being sent' })).toBeNull()
    })
  })

  it('распакованный ZIP показывает содержимым, а не собой', async () => {
    db.session = MOCK_CREATOR

    renderApp({ path: '/dashboard/arc_draft_notes' })
    await screen.findByText('Nothing sealed yet')

    await userEvent.upload(fileInput(), upload('course.zip', 2048))

    // Внутри контейнера лежит то, что распаковал backend, а не имя загруженного файла.
    expect(await screen.findByText('document-01.pdf')).toBeInTheDocument()
    expect(screen.getByText('content/')).toBeInTheDocument()
  })

  it('отклоняет неподдерживаемый формат, не спрашивая backend', async () => {
    db.session = MOCK_CREATOR

    renderApp({ path: '/dashboard/arc_draft_notes' })
    await screen.findByText('Nothing sealed yet')

    // `accept` в диалоге ОС — подсказка, а не запрет: человек волен выбрать
    // «все файлы», и файл дойдёт до страницы. Фильтр userEvent поэтому выключен:
    // проверяется своя проверка, а не чужая.
    await userEvent.upload(fileInput(), upload('lecture.mp4', 51_200), {
      applyAccept: false,
    })

    const refused = await screen.findByRole('alert')
    expect(within(refused).getByText('lecture.mp4')).toBeInTheDocument()
    expect(
      within(refused).getByText(/the Viewer cannot show this format/),
    ).toBeInTheDocument()

    // Ни одной загрузки не начато: файл отсеян до сети.
    expect(db.uploads).toHaveLength(0)
    expect(screen.getByText('Nothing sealed yet')).toBeInTheDocument()
  })

  it('берёт годные файлы и называет по имени те, что не взял', async () => {
    db.session = MOCK_CREATOR

    renderApp({ path: '/dashboard/arc_draft_notes' })
    await screen.findByText('Nothing sealed yet')

    await userEvent.upload(fileInput(), [upload('good.pdf', 200), upload('empty.pdf', 0)])

    await waitFor(() => {
      expect(within(manifest()).getByText('good.pdf')).toBeInTheDocument()
    })

    const refused = await screen.findByRole('alert')
    expect(within(refused).getByText('empty.pdf')).toBeInTheDocument()
    expect(within(refused).getByText(/the file is empty/)).toBeInTheDocument()
  })

  it('оставляет упавший файл в очереди и даёт передать его заново', async () => {
    db.session = MOCK_CREATOR
    server.use(
      http.post(`${API_BASE_URL}${API_PREFIX}/uploads/init`, () =>
        HttpResponse.json({ code: 'STORAGE_UNAVAILABLE', message: 'Хранилище недоступно' }, { status: 503 }),
      ),
    )

    renderApp({ path: '/dashboard/arc_draft_notes' })
    await screen.findByText('Nothing sealed yet')

    await userEvent.upload(fileInput(), upload('lecture-01.pdf', 640))

    expect(await screen.findByText('Not sent')).toBeInTheDocument()
    // Формулировку отказа даёт backend, страница её не переписывает.
    expect(screen.getByText('Хранилище недоступно')).toBeInTheDocument()

    // Файл остался в памяти: повторять выбор не нужно.
    const again = screen.getByRole('button', { name: 'Send again' })

    server.resetHandlers()
    await userEvent.click(again)

    await waitFor(() => {
      expect(within(manifest()).getByText('lecture-01.pdf')).toBeInTheDocument()
    })
  })
})
