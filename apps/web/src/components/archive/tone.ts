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
