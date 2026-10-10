import { Link, createFileRoute } from '@tanstack/react-router'

import { Container } from '@/components/layout/container'
import { PageHeader } from '@/components/layout/page-header'
import { SectionHeading } from '@/components/layout/section-heading'
import { StepList } from '@/components/product/step-list'
import { ViewerDownloadButton } from '@/components/product/viewer-download'
import { useI18n } from '@/lib/i18n'
import { VIEWER_VERSION } from '@/lib/viewer-download'

export const Route = createFileRoute('/download')({ component: DownloadPage })

function DownloadPage() {
  const { t } = useI18n()
  const page = t.download
  return (
    <Container>
      <PageHeader title={page.title} lead={page.lead} />
      <section className="border-border bg-card rounded-lg border p-5 sm:p-8" aria-label={page.title}>
        <div className="flex flex-wrap items-baseline gap-x-6 gap-y-2 text-sm">
          <p className="font-medium">{page.requirements}</p>
          <p className="text-muted-foreground">{page.version} <span className="font-mono">{VIEWER_VERSION}</span></p>
        </div>
        <ViewerDownloadButton installer className="mt-6" />
        <p className="text-muted-foreground mt-5 max-w-prose text-sm">{page.preview}</p>
      </section>
      <section className="mt-10">
        <SectionHeading>{page.installTitle}</SectionHeading>
        <StepList steps={page.steps} className="mt-4" />
      </section>
      <section className="border-border mt-8 border-t pt-6">
        <SectionHeading>{page.securityTitle}</SectionHeading>
        <p className="text-muted-foreground mt-3 max-w-prose text-sm leading-relaxed">{page.security}</p>
      </section>
      <nav aria-label={t.nav.pages} className="mt-8 flex flex-wrap gap-6 text-sm">
        <Link to="/catalog" className="text-seal-ink underline underline-offset-4">{page.toCatalog}</Link>
        <Link to="/how-it-works" className="text-seal-ink underline underline-offset-4">{page.howItWorks}</Link>
      </nav>
    </Container>
  )
}
