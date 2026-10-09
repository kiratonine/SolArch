import { MARKETPLACE_TONE, TECHNICAL_TONE, TONE_CHIP } from '@/components/archive/tone'
import { Badge } from '@/components/ui/badge'
import type { MarketplaceStatus, TechnicalStatus } from '@/lib/api'
import { useI18n } from '@/lib/i18n'
import { cn } from '@/lib/utils'

/**
 * Два независимых статуса архива никогда не смешиваются в один бейдж:
 * `technical` описывает файл, `marketplace` — витрину, и падать они могут порознь
 * (готовый архив снят с публикации; опубликованный — с ошибкой обработки).
 */
export type StatusBadgeProps = { className?: string } & (
  | { kind: 'technical'; value: TechnicalStatus }
  | { kind: 'marketplace'; value: MarketplaceStatus }
)

export function StatusBadge({ className, ...status }: StatusBadgeProps) {
  const { t } = useI18n()

  const label =
    status.kind === 'technical'
      ? t.status.technical[status.value]
      : t.status.marketplace[status.value]

  const tone =
    status.kind === 'technical'
      ? TECHNICAL_TONE[status.value]
      : MARKETPLACE_TONE[status.value]

  return (
    <Badge className={cn('gap-1.5 rounded-sm border-transparent', TONE_CHIP[tone], className)}>
      <span aria-hidden="true" className="size-1.5 shrink-0 rounded-full bg-current" />
      {label}
    </Badge>
  )
}
