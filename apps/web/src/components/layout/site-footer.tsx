import { Logo } from '@/components/brand/logo'
import { Container } from '@/components/layout/container'
import { useI18n } from '@/lib/i18n'

/**
 * Подвал: имя продукта и год, больше ничего.
 *
 * Объяснения механики здесь были — и уехали отсюда сознательно. Продуктовый текст,
 * растащенный по подвалам и подзаголовкам, читается шумом на каждой странице;
 * его место — отдельная страница «как это работает», которую делаем позже.
 * Пока о механике говорит подзаголовок каталога, а условия открытия — страница архива.
 */
export function SiteFooter() {
  const { t } = useI18n()

  return (
    <footer className="border-border mt-20 border-t">
      <Container className="flex items-center justify-between gap-6 py-7">
        <Logo markClassName="size-4" wordClassName="text-[0.8125rem]" />
        <span className="text-muted-foreground font-mono text-xs">
          {t.footer.rights(new Date().getFullYear())}
        </span>
      </Container>
    </footer>
  )
}
