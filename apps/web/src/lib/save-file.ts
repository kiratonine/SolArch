/**
 * Отдаёт браузеру файл, пришедший запросом, так, будто его скачали по ссылке.
 *
 * Нужен там, где ссылка невозможна: эндпоинт закрыт сессией, а ссылка не несёт
 * заголовок `Authorization` (см. `downloadMyArchive`).
 */
export function saveFile(blob: Blob, filename: string): void {
  const url = URL.createObjectURL(blob)

  const link = document.createElement('a')
  link.href = url
  link.download = filename
  document.body.append(link)
  link.click()
  link.remove()

  // Адрес отпускаем не сразу: часть браузеров начинает чтение уже после `click()`.
  setTimeout(() => URL.revokeObjectURL(url), 0)
}
