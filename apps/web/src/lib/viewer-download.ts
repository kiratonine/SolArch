/**
 * Дистрибутив SolArch Viewer.
 *
 * Установщик собирает ветка viewer (`tauri.conf.json`: `bundle.targets = ["nsis"]`),
 * но опубликованного релиза пока нет (Q6). Поэтому адрес приходит из окружения:
 * `VITE_VIEWER_DOWNLOAD_URL` — прямая ссылка на `.exe` (GitHub Release, CDN).
 * Пока переменная не задана, кнопка остаётся заглушкой: она видна и нажимается,
 * но ничего не скачивает и честно говорит, что сборка ещё не выложена.
 *
 * Имя файла повторяет то, что даёт NSIS-бандлер Tauri для `productName`
 * и `version` из конфига Viewer — на кнопке человек видит ровно то, что получит.
 */

export const VIEWER_VERSION = '0.1.0'

export const VIEWER_INSTALLER_NAME = `SolArch Viewer_${VIEWER_VERSION}_x64-setup.exe`

const rawUrl: string | undefined = import.meta.env.VITE_VIEWER_DOWNLOAD_URL

/** Прямая ссылка на установщик или `null`, пока релиза нет. */
export const VIEWER_DOWNLOAD_URL: string | null = rawUrl?.trim() ? rawUrl.trim() : null
