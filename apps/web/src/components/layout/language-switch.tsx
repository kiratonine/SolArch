import { LOCALES, useI18n } from '@/lib/i18n'
import { cn } from '@/lib/utils'

/**
 * Языков ровно два, поэтому выпадающий список избыточен: оба видны сразу
 * и переключаются одним нажатием.
 */
export function LanguageSwitch({ className }: { className?: string }) {
  const { locale, setLocale, t } = useI18n()

  return (
    <div
      role="group"
      aria-label={t.nav.language}
      className={cn('border-border flex items-center rounded-sm border p-0.5', className)}
    >
      {LOCALES.map((option) => {
        const active = option === locale
        return (
          <button
            key={option}
            type="button"
            aria-pressed={active}
            onClick={() => setLocale(option)}
            className={cn(
              'focus-visible:ring-ring/60 rounded-[2px] px-1.5 py-0.5 text-xs font-medium uppercase transition-colors focus-visible:ring-2 focus-visible:outline-none',
              active
                ? 'bg-foreground text-background'
                : 'text-muted-foreground hover:text-foreground',
            )}
          >
            {option}
          </button>
        )
      })}
    </div>
  )
}
