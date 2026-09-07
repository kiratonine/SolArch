/**
 * Что автору разрешено выбрать для загрузки.
 *
 * Список форматов задан продуктом (`docs/INTEGRATION.md` §8): Viewer в MVP умеет
 * показывать документы и картинки и не умеет ничего больше. ZIP в этом списке
 * особняком — его никто не показывает, backend его распаковывает.
 *
 * Проверка стоит до сети нарочно. Backend всё равно ответит 415 и останется
 * последним словом, но человеку незачем ждать круглый рейс, чтобы услышать то,
 * что видно по имени файла.
 */

/** Форматы, которые Viewer показывает покупателю. */
export const SUPPORTED_EXTENSIONS = ['pdf', 'png', 'jpg', 'jpeg', 'webp', 'docx', 'xlsx'] as const

/** Контейнер с готовой структурой: распаковывает backend, браузер не трогает. */
export const ARCHIVE_EXTENSION = 'zip'

/** Значение атрибута `accept` у поля выбора: диалог ОС отсеивает лишнее сам. */
export const ACCEPT_ATTRIBUTE = [...SUPPORTED_EXTENSIONS, ARCHIVE_EXTENSION]
  .map((extension) => `.${extension}`)
  .join(',')

/**
 * Причина отказа — код, а не фраза: одну и ту же проверку читают обе локали.
 * Тот же приём, что и в проверке цены (F73).
 */
export type UploadFileProblem = 'unsupportedType' | 'empty'

export interface RejectedFile {
  name: string
  problem: UploadFileProblem
}

/** Всё после последней точки. `roll-07.PNG` → `png`. */
export function extensionOf(filename: string): string {
  const cut = filename.lastIndexOf('.')
  return cut <= 0 ? '' : filename.slice(cut + 1).toLowerCase()
}

/**
 * Что не так с файлом, или `undefined`, если всё в порядке.
 *
 * Формат проверяется раньше размера: пустой `.mp4` не станет годным, потолстев,
 * и говорить о его весе значит уводить разговор в сторону.
 */
export function checkUploadFile(file: File): UploadFileProblem | undefined {
  const extension = extensionOf(file.name)
  const known: readonly string[] = SUPPORTED_EXTENSIONS

  if (extension !== ARCHIVE_EXTENSION && !known.includes(extension)) return 'unsupportedType'
  if (file.size === 0) return 'empty'

  return undefined
}

/**
 * Делит выбор на то, что уйдёт на backend, и то, что не уйдёт.
 *
 * Отклонённые не пропадают молча: их возвращают, чтобы страница назвала каждый
 * по имени. Порядок выбора сохраняется — в нём автор и собирал свой архив.
 */
export function splitUploadFiles(files: File[]): {
  accepted: File[]
  rejected: RejectedFile[]
} {
  const accepted: File[] = []
  const rejected: RejectedFile[] = []

  for (const file of files) {
    const problem = checkUploadFile(file)
    if (problem) rejected.push({ name: file.name, problem })
    else accepted.push(file)
  }

  return { accepted, rejected }
}
