/**
 * Дистрибутив SolArch Viewer.
 *
 * Установщик собирает ветка viewer (`tauri.conf.json`: `bundle.targets = ["nsis"]`),
 * но опубликованного релиза пока нет (Q6). Поэтому адрес приходит из окружения:
 * `VITE_VIEWER_DOWNLOAD_URL` — прямая ссылка на `.exe` (GitHub Release, CDN).
 * Пока переменная не задана, /download честно показывает недоступность.
 *
 * Имя файла повторяет то, что даёт NSIS-бандлер Tauri для `productName`
 * и `version` из конфига Viewer — на кнопке человек видит ровно то, что получит.
 */

export const VIEWER_VERSION = '0.1.0'

export const VIEWER_INSTALLER_NAME = `SolArch Viewer_${VIEWER_VERSION}_x64-setup.exe`

/** Only a direct HTTPS installer asset can enable downloading, never a webpage. */
export function parseViewerDownloadUrl(value: string | undefined): string | null {
  if (!value?.trim()) return null
  try {
    const url = new URL(value.trim())
    if (
      url.protocol !== 'https:' || url.username || url.password || url.hash ||
      !url.pathname.toLowerCase().endsWith('.exe')
    ) return null
    return url.href
  } catch {
    return null
  }
}

/** Прямая ссылка на установщик или `null`, пока релиза нет. */
export const VIEWER_DOWNLOAD_URL = parseViewerDownloadUrl(import.meta.env.VITE_VIEWER_DOWNLOAD_URL)
