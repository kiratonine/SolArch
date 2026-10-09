import { TILE_FRAME } from '@/components/archive/tile'
import { Skeleton } from '@/components/ui/skeleton'
import { cn } from '@/lib/utils'

/**
 * Скелет повторяет геометрию плитки — тот же кадр обложки, те же отступы,
 * та же линия манифеста, — поэтому при загрузке страница не переставляется.
 * Им пользуются и каталог, и кабинет автора: каркас плиток у них общий.
 */
export function ArchiveCardSkeleton({ className }: { className?: string }) {
  return (
    <div aria-hidden="true" className={cn(TILE_FRAME, className)}>
      <div className="border-border bg-secondary aspect-[1200/630] border-b" />

      <div className="flex flex-1 flex-col p-4">
        <Skeleton className="h-[1.0625rem] w-3/4" />
        <Skeleton className="mt-2 h-3 w-24" />

        <div className="mt-4 mb-4 space-y-2">
          <Skeleton className="h-3 w-full" />
          <Skeleton className="h-3 w-2/3" />
        </div>

        <div className="border-border mt-auto flex gap-6 border-t pt-3">
          <Skeleton className="h-8 w-10" />
          <Skeleton className="h-8 w-14" />
          <Skeleton className="h-8 w-12" />
        </div>

        <Skeleton className="mt-3 h-[1.0625rem] w-24" />
      </div>
    </div>
  )
}
