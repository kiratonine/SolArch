/**
 * Анонимный идентификатор посетителя для заголовка `X-Session-Id`.
 *
 * Backend засчитывает просмотр на каждый запрос карточки архива, а повтор от того же
 * посетителя в пределах 15 минут отбрасывает — но только если запрос назвал себя
 * этим заголовком (ответ на Q10). Без него каждая перезагрузка страницы добавляла бы
 * автору просмотр, которого не было.
 *
 * Это случайная строка, а не отпечаток браузера: о человеке она не говорит ничего
 * и живёт, пока её не сотрут вместе с данными сайта.
 */

const STORAGE_KEY = 'solarch_visitor_id'

let memoryId: string | null = null

/** `getRandomValues`, а не `randomUUID`: второй есть только в защищённом контексте. */
function generate(): string {
  const bytes = crypto.getRandomValues(new Uint8Array(16))
  return `vis_${Array.from(bytes, (byte) => byte.toString(16).padStart(2, '0')).join('')}`
}

export function visitorId(): string {
  try {
    const stored = localStorage.getItem(STORAGE_KEY)
    if (stored) return stored

    const fresh = generate()
    localStorage.setItem(STORAGE_KEY, fresh)
    return fresh
  } catch {
    memoryId ??= generate()
    return memoryId
  }
}
