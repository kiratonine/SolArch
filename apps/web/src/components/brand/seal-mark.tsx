import { cn } from '@/lib/utils'

/**
 * Знак SolArch: короб с загнутым углом.
 *
 * Корпус — чернильный, загнутый угол — янтарный: контейнер виден целиком,
 * но запечатан. Тот же жест, что и корешок карточки архива.
 */
export function SealMark({ className }: { className?: string }) {
  return (
    <svg
      viewBox="0 0 16 16"
      aria-hidden="true"
      focusable="false"
      className={cn('size-4 shrink-0', className)}
    >
      {/* Загиб занимает почти половину ширины: на 16–18px меньшая печать
          сливается с корпусом и знак читается сплошным пятном. */}
      <path
        d="M3.5 1.75h5L13.5 6.75v6.5a1 1 0 0 1-1 1h-9a1 1 0 0 1-1-1V2.75a1 1 0 0 1 1-1Z"
        fill="currentColor"
      />
      <path d="M8.5 1.75 13.5 6.75H9.25a.75.75 0 0 1-.75-.75V1.75Z" fill="var(--seal)" />
    </svg>
  )
}
