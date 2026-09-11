/**
 * Токен сессии автора.
 *
 * Backend выдаёт JWT в ответе на `verify` и узнаёт автора только по заголовку
 * `Authorization: Bearer` (ответ на Q1). Cookie-сессии нет, поэтому токен хранит
 * сам клиент.
 *
 * Хранится в localStorage, а не в памяти: иначе каждая перезагрузка страницы
 * выбрасывала бы автора из кабинета и требовала новой подписи кошельком. Цена —
 * токен читает любой скрипт на странице; поэтому чужих скриптов у нас нет, а срок
 * его жизни задаёт backend.
 *
 * Хранилище бывает недоступно (приватное окно, запрет данных сайта). Тогда токен
 * живёт в памяти: вход работает, просто не переживает перезагрузку.
 */

const STORAGE_KEY = 'solarch_auth_token'

let memoryToken: string | null = null

export function readAuthToken(): string | null {
  try {
    return localStorage.getItem(STORAGE_KEY) ?? memoryToken
  } catch {
    return memoryToken
  }
}

export function saveAuthToken(token: string): void {
  memoryToken = token
  try {
    localStorage.setItem(STORAGE_KEY, token)
  } catch {
    // Остаётся в памяти до перезагрузки.
  }
}

export function clearAuthToken(): void {
  memoryToken = null
  try {
    localStorage.removeItem(STORAGE_KEY)
  } catch {
    // Хранилища нет — стирать в нём нечего.
  }
}
