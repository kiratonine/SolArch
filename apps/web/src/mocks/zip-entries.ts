/**
 * Опись ZIP по его центральному каталогу — то, что backend делает через `adm-zip`.
 *
 * Мок читает только имена и размеры: распаковывать ему незачем. Возвращает `null`,
 * если байты — не ZIP; backend в этом случае отвечает «Failed to read ZIP archive».
 */
export function readZipEntries(buffer: ArrayBuffer): { path: string; size: number }[] | null {
  const view = new DataView(buffer)
  const decoder = new TextDecoder()

  // Запись о конце каталога ищется с хвоста: за ней может стоять комментарий архива.
  let end = -1
  for (let at = buffer.byteLength - 22; at >= Math.max(0, buffer.byteLength - 22 - 0xffff); at -= 1) {
    if (view.getUint32(at, true) === 0x06054b50) {
      end = at
      break
    }
  }
  if (end < 0) return null

  const count = view.getUint16(end + 10, true)
  let offset = view.getUint32(end + 16, true)
  const entries: { path: string; size: number }[] = []

  for (let n = 0; n < count; n += 1) {
    if (offset + 46 > buffer.byteLength || view.getUint32(offset, true) !== 0x02014b50) return null

    const size = view.getUint32(offset + 24, true)
    const nameLength = view.getUint16(offset + 28, true)
    const extraLength = view.getUint16(offset + 30, true)
    const commentLength = view.getUint16(offset + 32, true)

    entries.push({ path: decoder.decode(new Uint8Array(buffer, offset + 46, nameLength)), size })
    offset += 46 + nameLength + extraLength + commentLength
  }

  return entries
}
