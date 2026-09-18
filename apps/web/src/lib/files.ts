import type { PublicFileEntry } from '@/lib/api'

/**
 * Публичный список файлов приходит плоским, а человек читает его как опись:
 * сначала папка, под ней содержимое. `display_path` — единственное, что несёт
 * структуру, поэтому папку берём из него, а не из отдельного поля.
 *
 * Порядок backend сохраняется: он же решает, чем архив открывается. Сортировать
 * здесь значило бы переставлять содержание книги по алфавиту.
 */

export interface FileGroup {
  /** Папка без завершающего слэша. Пустая строка — файлы в корне архива. */
  folder: string
  files: PublicFileEntry[]
  sizeBytes: number
}

/** Всё до последнего слэша. `security/00-intro.pdf` → `security`. */
export function folderOf(displayPath: string): string {
  const cut = displayPath.lastIndexOf('/')
  return cut === -1 ? '' : displayPath.slice(0, cut)
}

/**
 * Группирует файлы по папке в порядке первого появления.
 *
 * Корень идёт первым, если он есть: файл, лежащий прямо в архиве, старше любой
 * папки, и заголовок «корень» ему не нужен — его отсутствие и есть заголовок.
 */
export function groupFilesByFolder(files: PublicFileEntry[]): FileGroup[] {
  const groups = new Map<string, FileGroup>()

  for (const file of files) {
    const folder = folderOf(file.display_path)
    let group = groups.get(folder)

    if (!group) {
      group = { folder, files: [], sizeBytes: 0 }
      groups.set(folder, group)
    }

    group.files.push(file)
    group.sizeBytes += file.size_bytes
  }

  const ordered = [...groups.values()]
  const rootAt = ordered.findIndex((group) => group.folder === '')
  if (rootAt > 0) ordered.unshift(...ordered.splice(rootAt, 1))

  return ordered
}
