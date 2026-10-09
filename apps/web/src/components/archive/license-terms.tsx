import type { LicensePolicy } from '@/lib/api'
import { useI18n } from '@/lib/i18n'
import { cn } from '@/lib/utils'

/**
 * Условия открытия архива.
 *
 * Гость платит уже после того, как файл у него, — значит, что именно даёт оплата,
 * он обязан узнать до скачивания, а не в Viewer постфактум. Политику присылает
 * backend в `license_policy`; здесь она только переводится с машинного на людской.
 *
 * Каждое условие — короткое имя слева и одно предложение справа: договор, а не
 * сетка карточек. Отключённый водяной знак строки не даёт вовсе — говорить
 * «водяного знака нет» не о чем.
 */
export function LicenseTerms({
  policy,
  className,
}: {
  policy: LicensePolicy
  className?: string
}) {
  const { t } = useI18n()
  const terms = t.archive.terms

  const rows = [
    {
      term: terms.devices.term(policy.max_devices),
      body: terms.devices.body(policy.max_devices),
    },
    policy.allow_export ? terms.exportAllowed : terms.export,
    ...(policy.watermark_enabled ? [terms.watermark] : []),
  ]

  return (
    <dl className={cn('mt-4', className)}>
      {rows.map((row) => (
        <div
          key={row.term}
          className="border-border grid gap-x-6 gap-y-0.5 border-b py-3 first:border-t sm:grid-cols-[11rem_1fr]"
        >
          <dt className="text-foreground text-[0.9375rem] font-medium">{row.term}</dt>
          <dd className="text-muted-foreground max-w-[62ch] text-[0.875rem]">{row.body}</dd>
        </div>
      ))}
    </dl>
  )
}
