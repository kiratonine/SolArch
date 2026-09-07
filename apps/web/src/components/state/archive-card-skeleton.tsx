import { Skeleton } from '@/components/ui/skeleton'
import { cn } from '@/lib/utils'

/**
 * Скелет повторяет геометрию `ArchiveCard` — тот же корешок, те же отступы,
 * та же линия манифеста, — поэтому при загрузке страница не переставляется.
 */
export function ArchiveCardSkeleton({ className }: { className?: string }) {
  return (
    <div
      aria-hidden="true"
      className={cn('bg-card border-border relative overflow-hidden rounded-lg border', className)}
    >
      <span className="bg-border absolute inset-y-0 left-0 w-[3px]" />

      <div className="py-5 pr-5 pl-6 sm:pl-7">
        <div className="flex items-start justify-between gap-6">
          <div className="min-w-0 flex-1 space-y-2">
            <Skeleton className="h-[1.0625rem] w-[min(60%,15rem)]" />
            <Skeleton className="h-3 w-24" />
          </div>
          <Skeleton className="h-[1.0625rem] w-24" />
        </div>

        <div className="mt-4 space-y-2">
          <Skeleton className="h-3 w-full max-w-[38rem]" />
          <Skeleton className="h-3 w-2/3 max-w-[26rem]" />
        </div>

        <div className="border-border mt-5 flex gap-8 border-t pt-4">
          <Skeleton className="h-8 w-14" />
          <Skeleton className="h-8 w-16" />
          <Skeleton className="h-8 w-20" />
        </div>
      </div>
    </div>
  )
}
