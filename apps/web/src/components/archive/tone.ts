import type { MarketplaceStatus, TechnicalStatus } from '@/lib/api'

/**
 * Статусы говорят цветом, но собственной приглушённой шкалой — янтарь остаётся
 * только за деньгами. Строки классов записаны целиком: Tailwind сканирует исходники
 * и не увидит класс, собранный конкатенацией.
 */
export type StatusTone = 'idle' | 'progress' | 'ok' | 'error'

/** Корешок опубликованного архива — чернильный: «запечатано и лежит на витрине». */
export type SpineTone = StatusTone | 'sealed'

export const TECHNICAL_TONE: Record<TechnicalStatus, StatusTone> = {
  draft: 'idle',
  uploading: 'progress',
  processing: 'progress',
  ready: 'ok',
  failed: 'error',
}

export const MARKETPLACE_TONE: Record<MarketplaceStatus, StatusTone> = {
  draft: 'idle',
  published: 'ok',
  unpublished: 'idle',
  blocked: 'error',
}

export const TONE_CHIP: Record<StatusTone, string> = {
  idle: 'bg-state-idle/12 text-state-idle',
  progress: 'bg-state-progress/12 text-state-progress',
  ok: 'bg-state-ok/12 text-state-ok',
  error: 'bg-state-error/12 text-state-error',
}

export const TONE_SPINE: Record<SpineTone, string> = {
  sealed: 'bg-foreground',
  idle: 'bg-state-idle/45',
  progress: 'bg-state-progress',
  ok: 'bg-state-ok',
  error: 'bg-state-error',
}

/**
 * Цвет корешка для собственного архива.
 *
 * Корешок отвечает на один вопрос — далеко ли архив от полки, — поэтому статусы
 * читаются по порядку срочности: сломанная сборка важнее всего, затем незаконченная,
 * и только у готового архива корешок говорит о витрине. Опубликованный получает
 * чернильный корешок, как в каталоге: он там же, где его видит покупатель.
 */
export function creatorSpineTone(archive: {
  technical_status: TechnicalStatus
  marketplace_status: MarketplaceStatus
}): SpineTone {
  if (archive.technical_status === 'failed') return 'error'
  if (archive.technical_status === 'draft') return 'idle'
  if (archive.technical_status !== 'ready') return 'progress'
  if (archive.marketplace_status === 'blocked') return 'error'
  return archive.marketplace_status === 'published' ? 'sealed' : 'ok'
}
