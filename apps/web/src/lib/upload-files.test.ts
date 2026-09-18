import { describe, expect, it } from 'vitest'

import { ACCEPT_ATTRIBUTE, checkUploadFile, splitUploadFiles } from '@/lib/upload-files'

/** Размер задаётся явно: длина содержимого к делу не относится. */
function file(name: string, size: number): File {
  const value = new File(['x'], name)
  Object.defineProperty(value, 'size', { value: size })
  return value
}

describe('проверка файла до загрузки', () => {
  it('пропускает форматы, которые Viewer умеет показывать', () => {
    for (const name of ['a.pdf', 'b.PNG', 'c.jpg', 'd.jpeg', 'e.webp', 'f.docx', 'g.xlsx']) {
      expect(checkUploadFile(file(name, 1024))).toBeUndefined()
    }
  })

  it('пропускает ZIP: его распаковывает backend', () => {
    expect(checkUploadFile(file('course.zip', 4096))).toBeUndefined()
  })

  it('отклоняет формат, которого нет в MVP', () => {
    expect(checkUploadFile(file('lecture.mp4', 4096))).toBe('unsupportedType')
    expect(checkUploadFile(file('notes.txt', 10))).toBe('unsupportedType')
  })

  it('отклоняет файл без расширения', () => {
    expect(checkUploadFile(file('README', 10))).toBe('unsupportedType')
  })

  it('отклоняет пустой файл: собирать из него нечего', () => {
    expect(checkUploadFile(file('empty.pdf', 0))).toBe('empty')
  })

  it('называет формат раньше размера: пустой mp4 не станет годным, потолстев', () => {
    expect(checkUploadFile(file('broken.mp4', 0))).toBe('unsupportedType')
  })
})

describe('разбор выбранного', () => {
  it('делит выбор на принятое и отклонённое, сохраняя порядок выбора', () => {
    const chosen = [
      file('read-me.pdf', 64),
      file('lecture.mp4', 900),
      file('cover.png', 128),
      file('empty.pdf', 0),
    ]

    const { accepted, rejected } = splitUploadFiles(chosen)

    expect(accepted.map((item) => item.name)).toEqual(['read-me.pdf', 'cover.png'])
    expect(rejected).toEqual([
      { name: 'lecture.mp4', problem: 'unsupportedType' },
      { name: 'empty.pdf', problem: 'empty' },
    ])
  })

  it('на пустом выборе не выдумывает ни принятых, ни отклонённых', () => {
    expect(splitUploadFiles([])).toEqual({ accepted: [], rejected: [] })
  })

  it('перечисляет в accept все допустимые расширения и только их', () => {
    expect(ACCEPT_ATTRIBUTE).toContain('.pdf')
    expect(ACCEPT_ATTRIBUTE).toContain('.zip')
    expect(ACCEPT_ATTRIBUTE).not.toContain('.mp4')
  })
})
