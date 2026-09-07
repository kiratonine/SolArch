import { SealMark } from '@/components/brand/seal-mark'
import { Wordmark } from '@/components/brand/wordmark'
import { Container } from '@/components/layout/container'
import { useI18n } from '@/lib/i18n'

export function SiteFooter() {
  const { t } = useI18n()

  return (
    <footer className="border-border mt-20 border-t">
      <Container className="flex flex-col gap-5 py-8 sm:flex-row sm:gap-12">
        <div className="flex items-center gap-2">
          <SealMark className="size-4" />
          <Wordmark className="text-[0.8125rem]" />
        </div>

        <div className="text-muted-foreground max-w-[58ch] space-y-1.5 text-[0.8125rem]">
          <p>{t.footer.mechanic}</p>
          <p>{t.footer.fee}</p>
        </div>
      </Container>
    </footer>
  )
}
