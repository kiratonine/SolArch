import { screen, waitFor, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { HttpResponse, delay, http } from 'msw'
import { describe, expect, it, vi } from 'vitest'

import { API_BASE_URL, API_PREFIX } from '@/lib/api/config'
import { saveFile } from '@/lib/save-file'
import { createZip } from '@/lib/zip'
import { db } from '@/mocks/db'
import { server } from '@/mocks/node'
import { renderApp } from '@/test/render'
import { signIn } from '@/test/session'

// Положить файл на диск — дело браузера, а в jsdom нет ни `createObjectURL`, ни диска.
// Проверяется то, за что отвечает страница: файл пришёл, и отдан он под верным именем.
vi.mock('@/lib/save-file', () => ({ saveFile: vi.fn() }))

/**
 * Страница архива в кабинете: загрузка файлов и состояния сборки.
 *
 * Проверяется путь целиком — выбор файлов, `init` → передача ZIP → `complete`,
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

/** Файл честного размера: упаковщик читает байты, и размер обязан с ними совпадать. */
function upload(name: string, sizeKb: number): File {
  return new File([new Uint8Array(sizeKb * 1024)], name)
}

/** Что лежит в архиве по мнению backend — мок и есть backend. */
function storedPaths(archiveId: string): string[] | undefined {
  return db.archives
    .find((item) => item.archive_id === archiveId)
    ?.files.map((file) => file.display_path)
}

const REPLACES = 'A new upload replaces everything the archive holds now.'

describe('страница архива автора', () => {
  it('показывает архив, оба статуса и опись файлов', async () => {
    signIn()

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

  it('скачивает собранный .slr запросом с сессией и отдаёт его под именем архива', async () => {
    signIn()

    renderApp({ path: '/dashboard/arc_solana_course' })

    // Кнопка, а не ссылка: ссылка не донесла бы заголовок Authorization.
    await userEvent.click(await screen.findByRole('button', { name: 'Download the .slr' }))

    await waitFor(() => {
      expect(saveFile).toHaveBeenCalledWith(expect.anything(), 'solana-program-security.slr')
    })
  })

  it('говорит, что .slr не скачался, и оставляет кнопку', async () => {
    signIn()
    server.use(
      http.get(`${API_BASE_URL}${API_PREFIX}/archives/:archiveId/download`, () =>
        HttpResponse.json({ code: 'NOT_FOUND', message: 'gone' }, { status: 404 }),
      ),
    )

    renderApp({ path: '/dashboard/arc_solana_course' })

    await userEvent.click(await screen.findByRole('button', { name: 'Download the .slr' }))

    expect(await screen.findByText('The .slr did not download. Try again.')).toBeInTheDocument()
    expect(screen.getByRole('button', { name: 'Download the .slr' })).toBeEnabled()
  })

  it('называет причину, по которой сборка не удалась', async () => {
    signIn()

    renderApp({ path: '/dashboard/arc_broken_scans' })

    expect(await screen.findByText('The container was not built')).toBeInTheDocument()
    expect(screen.getByText(/scans\/roll-07\.png/)).toBeInTheDocument()

    // Сломанную сборку чинят новой загрузкой, поэтому выбор остаётся на месте.
    expect(screen.getByRole('button', { name: 'Choose files' })).toBeInTheDocument()
  })

  it('не предлагает добавлять файлы, пока backend собирает контейнер', async () => {
    signIn()

    renderApp({ path: '/dashboard/arc_field_notes' })

    expect(await screen.findByText('SolArch is building the container')).toBeInTheDocument()
    expect(screen.queryByRole('button', { name: 'Choose files' })).toBeNull()
  })

  it('говорит прямо, когда архива нет или он чужой', async () => {
    signIn()

    renderApp({ path: '/dashboard/arc_missing' })

    expect(await screen.findByText('No such archive')).toBeInTheDocument()
  })

  it('403 на чужой архив читает так же, как 404', async () => {
    signIn()
    // Так отвечает настоящий backend: чужой архив для него «запрещён», а не «не найден».
    server.use(
      http.get(`${API_BASE_URL}${API_PREFIX}/archives/:archiveId`, () =>
        HttpResponse.json(
          { code: 'FORBIDDEN', message: 'You do not own this archive' },
          { status: 403 },
        ),
      ),
    )

    renderApp({ path: '/dashboard/arc_brand_kit' })

    expect(await screen.findByText('No such archive')).toBeInTheDocument()
  })

  it('называет сбой и даёт повторить', async () => {
    signIn()
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
    signIn()

    renderApp({ path: '/dashboard/arc_draft_notes' })

    expect(await screen.findByText('Nothing sealed yet')).toBeInTheDocument()
    expect(screen.getByText('The archive holds no files yet.')).toBeInTheDocument()
    // Пустому архиву заменять нечего, и пугать заменой незачем.
    expect(screen.queryByText(REPLACES)).toBeNull()

    await userEvent.upload(fileInput(), upload('lecture-01.pdf', 64))

    // Файл ушёл на backend: он подтвердил `complete` и завёл его в архиве.
    await waitFor(() => {
      expect(within(manifest()).getByText('lecture-01.pdf')).toBeInTheDocument()
    })

    // Загрузка кончается не на полосе прогресса, а на статусе от backend.
    expect(await screen.findByText('SolArch is building the container')).toBeInTheDocument()
  })

  it('склеивает несколько файлов в один ZIP и отправляет одной загрузкой', async () => {
    signIn()

    renderApp({ path: '/dashboard/arc_draft_notes' })
    await screen.findByText('Nothing sealed yet')

    await userEvent.upload(fileInput(), [
      upload('one.pdf', 1),
      upload('two.pdf', 1),
      upload('three.pdf', 1),
    ])

    // Все три внутри, в том порядке, в котором их выбрали.
    await waitFor(() => {
      expect(storedPaths('arc_draft_notes')).toEqual(['one.pdf', 'two.pdf', 'three.pdf'])
    })

    // И дошли одной загрузкой: backend принимает за раз один ZIP.
    expect(db.uploads).toHaveLength(1)
  })

  it('готовый ZIP уходит как есть, и опись показывает его содержимое, а не его', async () => {
    signIn()

    renderApp({ path: '/dashboard/arc_draft_notes' })
    await screen.findByText('Nothing sealed yet')

    const course = await createZip(
      [upload('document-01.pdf', 2), upload('document-02.pdf', 1)],
      'course.zip',
    )
    await userEvent.upload(fileInput(), course)

    await waitFor(() => {
      expect(within(manifest()).getByText('document-01.pdf')).toBeInTheDocument()
    })
    expect(within(manifest()).queryByText('course.zip')).toBeNull()

    // Не завёрнут во второй ZIP: backend получил тот самый файл.
    expect(db.uploads.map((item) => item.filename)).toEqual(['course.zip'])
  })

  it('берёт отдельные файлы, а ZIP из того же выбора возвращает с объяснением', async () => {
    signIn()

    renderApp({ path: '/dashboard/arc_draft_notes' })
    await screen.findByText('Nothing sealed yet')

    const bundle = await createZip([upload('inner.pdf', 1)], 'bundle.zip')
    await userEvent.upload(fileInput(), [bundle, upload('loose.pdf', 1)])

    const refused = await screen.findByRole('alert')
    expect(within(refused).getByText('bundle.zip')).toBeInTheDocument()
    expect(within(refused).getByText(/a ZIP goes on its own/)).toBeInTheDocument()

    await waitFor(() => {
      expect(storedPaths('arc_draft_notes')).toEqual(['loose.pdf'])
    })
  })

  it('предупреждает до выбора, что загрузка заменит содержимое, — и заменяет', async () => {
    signIn()

    renderApp({ path: '/dashboard/arc_broken_scans' })

    expect(await screen.findByText(REPLACES)).toBeInTheDocument()

    await userEvent.upload(fileInput(), upload('roll-07.png', 2))

    // Не дописал к двум прежним, а собрал архив заново из того, что пришло.
    await waitFor(() => {
      expect(storedPaths('arc_broken_scans')).toEqual(['roll-07.png'])
    })
  })

  it('убирает дошедшие строки, когда передавать больше нечего', async () => {
    signIn()

    renderApp({ path: '/dashboard/arc_draft_notes' })
    await screen.findByText('Nothing sealed yet')

    await userEvent.upload(fileInput(), upload('lecture-01.pdf', 64))

    await waitFor(() => {
      expect(within(manifest()).getByText('lecture-01.pdf')).toBeInTheDocument()
    })

    // Опись говорит то же самое и говорит с backend: два одинаковых списка подряд —
    // это один список и один повтор.
    await waitFor(() => {
      expect(screen.queryByRole('region', { name: 'Files being sent' })).toBeNull()
    })
  })

  it('не даёт начать вторую загрузку, пока идёт первая', async () => {
    signIn()
    // Пустой резолвер только задерживает запрос и отдаёт его настоящему обработчику (F114).
    server.use(
      http.post(`${API_BASE_URL}${API_PREFIX}/uploads/:uploadId/data`, async () => {
        await delay(400)
      }),
    )

    renderApp({ path: '/dashboard/arc_draft_notes' })
    await screen.findByText('Nothing sealed yet')

    await userEvent.upload(fileInput(), upload('lecture-01.pdf', 1))

    // Вторая загрузка заменила бы первую: выбор гаснет, пока идёт передача.
    await waitFor(() => {
      expect(screen.getByRole('button', { name: 'Choose files' })).toBeDisabled()
    })
  })

  it('битый ZIP отвергает backend, и в очереди стоят его слова', async () => {
    signIn()

    renderApp({ path: '/dashboard/arc_draft_notes' })
    await screen.findByText('Nothing sealed yet')

    // Расширение верное, содержимое — нет: до сети этого не узнать.
    await userEvent.upload(fileInput(), upload('broken.zip', 1))

    expect(await screen.findByText('Failed to read ZIP archive')).toBeInTheDocument()
    expect(screen.getByText('Not sent')).toBeInTheDocument()
  })

  it('отклоняет неподдерживаемый формат, не спрашивая backend', async () => {
    signIn()

    renderApp({ path: '/dashboard/arc_draft_notes' })
    await screen.findByText('Nothing sealed yet')

    // `accept` в диалоге ОС — подсказка, а не запрет: человек волен выбрать
    // «все файлы», и файл дойдёт до страницы. Фильтр userEvent поэтому выключен:
    // проверяется своя проверка, а не чужая.
    await userEvent.upload(fileInput(), upload('lecture.mp4', 1), {
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
    signIn()

    renderApp({ path: '/dashboard/arc_draft_notes' })
    await screen.findByText('Nothing sealed yet')

    await userEvent.upload(fileInput(), [upload('good.pdf', 2), new File([], 'empty.pdf')])

    await waitFor(() => {
      expect(within(manifest()).getByText('good.pdf')).toBeInTheDocument()
    })

    const refused = await screen.findByRole('alert')
    expect(within(refused).getByText('empty.pdf')).toBeInTheDocument()
    expect(within(refused).getByText(/the file is empty/)).toBeInTheDocument()
  })

  it('оставляет упавшую загрузку в очереди и даёт передать её заново', async () => {
    signIn()
    server.use(
      http.post(`${API_BASE_URL}${API_PREFIX}/uploads/init`, () =>
        HttpResponse.json({ code: 'STORAGE_UNAVAILABLE', message: 'Хранилище недоступно' }, { status: 503 }),
      ),
    )

    renderApp({ path: '/dashboard/arc_draft_notes' })
    await screen.findByText('Nothing sealed yet')

    await userEvent.upload(fileInput(), upload('lecture-01.pdf', 64))

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
