/**
 * ZIP без сжатия — ровно столько формата, сколько нужно, чтобы отдать backend один файл.
 *
 * Backend принимает на загрузку один ZIP и распаковывает его сам (ответ на Q2).
 * Автор при этом выбирает то, что у него есть, — несколько PDF и картинок, — и
 * склеивать их руками в архив его никто не просил. Поэтому склеивает страница.
 *
 * Сжатия нет нарочно: PDF, PNG, JPG, WebP, DOCX и XLSX уже сжаты внутри себя, и второй
 * проход занял бы процессор, не выиграв байтов. Без сжатия формат укладывается в два
 * заголовка на файл и запись в конце — без зависимостей.
 *
 * ZIP64 не нужен: backend не берёт больше 512 MiB, а обычный ZIP держит 4 GiB.
 */

const CRC_TABLE = (() => {
  const table = new Uint32Array(256)
  for (let n = 0; n < 256; n += 1) {
    let c = n
    for (let k = 0; k < 8; k += 1) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1
    table[n] = c >>> 0
  }
  return table
})()

/** CRC-32 (IEEE), которым ZIP проверяет целость каждого файла. */
export function crc32(bytes: Uint8Array): number {
  let crc = 0xffffffff
  for (const byte of bytes) crc = CRC_TABLE[(crc ^ byte) & 0xff]! ^ (crc >>> 8)
  return (crc ^ 0xffffffff) >>> 0
}

/** Время в формате MS-DOS: так его хранит ZIP. Раньше 1980 года формат не умеет. */
function dosStamp(date: Date): { time: number; date: number } {
  const year = Math.max(date.getFullYear(), 1980)
  return {
    time: (date.getHours() << 11) | (date.getMinutes() << 5) | Math.floor(date.getSeconds() / 2),
    date: ((year - 1980) << 9) | ((date.getMonth() + 1) << 5) | date.getDate(),
  }
}

function withSuffix(name: string, n: number): string {
  const dot = name.lastIndexOf('.')
  return dot > 0 ? `${name.slice(0, dot)} (${n})${name.slice(dot)}` : `${name} (${n})`
}

/**
 * Два файла с одним именем из разных папок — обычное дело, а в корне ZIP им
 * тесно. Второй получает номер, как это делает любой файловый менеджер, вместо
 * того чтобы молча затереть первый при распаковке.
 */
function uniqueNames(files: File[]): string[] {
  const taken = new Set<string>()

  return files.map((file) => {
    let name = file.name
    for (let n = 2; taken.has(name.toLowerCase()); n += 1) name = withSuffix(file.name, n)
    taken.add(name.toLowerCase())
    return name
  })
}

/** Бит 11 флагов: имена записаны в UTF-8. Без него кириллица распакуется кракозябрами. */
const UTF8_NAMES = 0x0800
const VERSION = 20

export async function createZip(files: File[], name = 'archive.zip'): Promise<File> {
  const encoder = new TextEncoder()
  const stamp = dosStamp(new Date())
  const names = uniqueNames(files)

  const body: BlobPart[] = []
  const directory: BlobPart[] = []
  let offset = 0
  let directorySize = 0

  for (const [index, file] of files.entries()) {
    const nameBytes = encoder.encode(names[index])
    // Файл читается целиком ради контрольной суммы, но в ZIP идёт сам `File`:
    // браузер склеит части без второй копии в памяти.
    const crc = crc32(new Uint8Array(await file.arrayBuffer()))
    const size = file.size

    const local = new DataView(new ArrayBuffer(30))
    local.setUint32(0, 0x04034b50, true)
    local.setUint16(4, VERSION, true)
    local.setUint16(6, UTF8_NAMES, true)
    local.setUint16(8, 0, true) // stored: без сжатия
    local.setUint16(10, stamp.time, true)
    local.setUint16(12, stamp.date, true)
    local.setUint32(14, crc, true)
    local.setUint32(18, size, true)
    local.setUint32(22, size, true)
    local.setUint16(26, nameBytes.length, true)
    body.push(local.buffer, nameBytes, file)

    const entry = new DataView(new ArrayBuffer(46))
    entry.setUint32(0, 0x02014b50, true)
    entry.setUint16(4, VERSION, true)
    entry.setUint16(6, VERSION, true)
    entry.setUint16(8, UTF8_NAMES, true)
    entry.setUint16(10, 0, true)
    entry.setUint16(12, stamp.time, true)
    entry.setUint16(14, stamp.date, true)
    entry.setUint32(16, crc, true)
    entry.setUint32(20, size, true)
    entry.setUint32(24, size, true)
    entry.setUint16(28, nameBytes.length, true)
    entry.setUint32(42, offset, true)
    directory.push(entry.buffer, nameBytes)

    offset += local.byteLength + nameBytes.length + size
    directorySize += entry.byteLength + nameBytes.length
  }

  const end = new DataView(new ArrayBuffer(22))
  end.setUint32(0, 0x06054b50, true)
  end.setUint16(8, files.length, true)
  end.setUint16(10, files.length, true)
  end.setUint32(12, directorySize, true)
  end.setUint32(16, offset, true)

  return new File([...body, ...directory, end.buffer], name, { type: 'application/zip' })
}
