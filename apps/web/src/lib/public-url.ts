/**
 * Публичный адрес архива — тот, который автор даёт другим людям.
 *
 * Собирается от origin страницы, а не от адреса API: каталог живёт на этом же
 * сайте, а backend может стоять на другом домене (открытый вопрос Q7). Путь
 * повторяет маршрут `/archives/$slug` — если маршрут переименуют, ломается
 * ровно здесь, а не в четырёх местах.
 */

export function publicArchivePath(slug: string): string {
  return `/archives/${encodeURIComponent(slug)}`
}

export function publicArchiveUrl(slug: string, origin: string): string {
  return `${origin.replace(/\/+$/, '')}${publicArchivePath(slug)}`
}
