import { describe, expect, it } from 'vitest'

import { folderOf, groupFilesByFolder } from '@/lib/files'
import type { PublicFileEntry } from '@/lib/api'

function entry(path: string, sizeBytes = 1024): PublicFileEntry {
  return {
    display_path: path,
    display_name: path.split('/').at(-1) ?? path,
    extension: 'pdf',
    mime_type: 'application/pdf',
    size_bytes: sizeBytes,
  }
}

describe('folderOf', () => {
  it('берёт всё до последнего слэша', () => {
    expect(folderOf('security/checklists/audit.pdf')).toBe('security/checklists')
  })

  it('отдаёт пустую строку для файла в корне', () => {
    expect(folderOf('read-me.pdf')).toBe('')
  })
})

describe('groupFilesByFolder', () => {
  it('складывает файлы одной папки вместе и суммирует вес', () => {
    const groups = groupFilesByFolder([
      entry('security/a.pdf', 100),
      entry('security/b.pdf', 200),
    ])

    expect(groups).toHaveLength(1)
    expect(groups[0]?.folder).toBe('security')
    expect(groups[0]?.files).toHaveLength(2)
    expect(groups[0]?.sizeBytes).toBe(300)
  })

  it('поднимает корень наверх, где бы он ни встретился', () => {
    const groups = groupFilesByFolder([
      entry('security/a.pdf'),
      entry('read-me.pdf'),
      entry('brand/b.pdf'),
    ])

    expect(groups.map((group) => group.folder)).toEqual(['', 'security', 'brand'])
  })

  it('сохраняет порядок backend, а не сортирует по алфавиту', () => {
    const groups = groupFilesByFolder([
      entry('z/02-second.pdf'),
      entry('z/01-first.pdf'),
      entry('a/03-third.pdf'),
    ])

    expect(groups.map((group) => group.folder)).toEqual(['z', 'a'])
    expect(groups[0]?.files.map((file) => file.display_name)).toEqual([
      '02-second.pdf',
      '01-first.pdf',
    ])
  })

  it('не разваливает вложенные папки на уровни', () => {
    const groups = groupFilesByFolder([entry('security/checklists/audit.pdf')])

    expect(groups[0]?.folder).toBe('security/checklists')
  })

  it('на пустом списке отдаёт пустой результат', () => {
    expect(groupFilesByFolder([])).toEqual([])
  })
})
