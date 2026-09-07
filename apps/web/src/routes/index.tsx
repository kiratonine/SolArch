import { createFileRoute } from '@tanstack/react-router'

export const Route = createFileRoute('/')({
  component: CatalogPage,
})

/**
 * Заглушка каталога. Настоящая страница появится на этапе S3
 * (сортировки, состояния loading/empty/error, карточки архивов).
 */
function CatalogPage() {
  return (
    <section className="space-y-4">
      <h1 className="font-heading text-3xl font-semibold tracking-tight">Marketplace</h1>
      <p className="text-muted-foreground max-w-prose">
        Защищённые архивы <code>.slr</code>. Скачать может любой без регистрации, открыть — только
        после оплаты в USDC внутри SolArch Viewer.
      </p>
      <div className="bg-muted/40 rounded-lg border border-dashed p-8 text-center">
        <p className="text-muted-foreground text-sm">Каталог появится на этапе S3.</p>
      </div>
    </section>
  )
}
