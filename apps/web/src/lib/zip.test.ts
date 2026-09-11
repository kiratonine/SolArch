import { describe, expect, it } from 'vitest'

import { readZipEntries } from '@/mocks/zip-entries'

import { crc32, createZip } from './zip'

describe('crc32', () => {
  it('даёт стандартное контрольное значение', () => {
    // Строка «123456789» — общепринятая проверка CRC-32 (IEEE).
    expect(crc32(new TextEncoder().encode('123456789'))).toBe(0xcbf43926)
  })
})

describe('createZip', () => {
  it('упаковывает файлы так, что чтение ZIP возвращает их с размерами', async () => {
    const zip = await createZip([new File(['hello'], 'a.pdf'), new File(['world!!'], 'b.png')])

    expect(zip.type).toBe('application/zip')
    expect(readZipEntries(await zip.arrayBuffer())).toEqual([
      { path: 'a.pdf', size: 5 },
      { path: 'b.png', size: 7 },
    ])
  })

  it('кладёт байты файла сразу за его заголовком, с верной суммой', async () => {
    const zip = await createZip([new File(['hello'], 'a.pdf')])
    const bytes = new Uint8Array(await zip.arrayBuffer())
    const view = new DataView(bytes.buffer)

    expect(view.getUint32(0, true)).toBe(0x04034b50)
    expect(view.getUint32(14, true)).toBe(crc32(new TextEncoder().encode('hello')))
    // 30 байт заголовка, 5 байт имени — и сразу данные, без сжатия.
    expect(new TextDecoder().decode(bytes.slice(35, 40))).toBe('hello')
  })

  it('не теряет файл с повторяющимся именем, а даёт ему номер', async () => {
    const zip = await createZip([new File(['1'], 'notes.pdf'), new File(['2'], 'Notes.pdf')])

    expect(readZipEntries(await zip.arrayBuffer())?.map((entry) => entry.path)).toEqual([
      'notes.pdf',
      'Notes (2).pdf',
    ])
  })

  it('пишет имена в UTF-8, чтобы кириллица пережила распаковку', async () => {
    const zip = await createZip([new File(['x'], 'отчёт.pdf')])

    expect(readZipEntries(await zip.arrayBuffer())?.[0]?.path).toBe('отчёт.pdf')
  })
})
