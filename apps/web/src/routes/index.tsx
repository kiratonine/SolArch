import { useQuery } from '@tanstack/react-query'
import { createFileRoute } from '@tanstack/react-router'

import { marketplaceListQuery, toUserMessage } from '@/lib/api'

export const Route = createFileRoute('/')({
  component: CatalogPage,
})

/**
 * Временный каталог: проверяет сквозную работу API-слоя и моков.
 * Полноценная страница с сортировками и дизайном придёт на S3.
 */
function CatalogPage() {
  const { data, isPending, isError, error } = useQuery(marketplaceListQuery({ sort: 'popular_week' }))

  return (
    <section className="space-y-6">
      <div className="space-y-2">
        <h1 className="font-heading text-3xl font-semibold tracking-tight">Marketplace</h1>
        <p className="text-muted-foreground max-w-prose">
          Защищённые архивы <code>.slr</code>. Скачать может любой без регистрации, открыть — только
          после оплаты в USDC внутри SolArch Viewer.
        </p>
      </div>

      {isPending && <p className="text-muted-foreground text-sm">Загрузка каталога…</p>}

      {isError && (
        <p className="text-destructive text-sm" role="alert">
          {toUserMessage(error)}
        </p>
      )}

      {data && data.items.length === 0 && (
        <p className="text-muted-foreground text-sm">Пока не опубликовано ни одного архива.</p>
      )}

      {data && data.items.length > 0 && (
        <ul className="grid gap-3 sm:grid-cols-2">
          {data.items.map((archive) => (
            <li key={archive.archive_id} className="rounded-lg border p-4">
              <h2 className="font-medium">{archive.title}</h2>
              <p className="text-muted-foreground mt-1 line-clamp-2 text-sm">
                {archive.short_description}
              </p>
              <div className="text-muted-foreground mt-3 flex items-center gap-4 text-xs">
                <span className="text-foreground font-medium">
                  {archive.price.amount} {archive.price.currency}
                </span>
                <span>{archive.file_count} файлов</span>
                <span>{archive.metrics.paid_unlocks} покупок</span>
              </div>
            </li>
          ))}
        </ul>
      )}
    </section>
  )
}
