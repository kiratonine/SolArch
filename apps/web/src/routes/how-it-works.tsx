import { Link, createFileRoute } from '@tanstack/react-router'

import { Container } from '@/components/layout/container'
import { PageHeader } from '@/components/layout/page-header'
import { SectionHeading } from '@/components/layout/section-heading'
import { StepList } from '@/components/product/step-list'
import { useI18n } from '@/lib/i18n'

export const Route = createFileRoute('/how-it-works')({
  component: HowItWorksPage,
})

/**
 * Как это работает.
 *
 * Страница ничего не запрашивает и ничем не управляет — она отвечает на вопрос,
 * который продукт задаёт сам собой: почему файл отдают бесплатно, а деньги берут
 * потом и в другом приложении.
 *
 * Текст сюда не написан заново, а возвращён. Три шага механики стояли на главной
 * и были сняты на S4 (F41), два объяснения стояли в подвале и были сняты на S5
 * (F55) — оба раза потому, что продуктовая проза повторялась на каждом экране.
 * Здесь у неё одно место, и повторять её больше негде.
 *
 * Разделы идут по адресату, а не по порядку событий: на главной третий шаг
 * («автору уходит 95%») говорил не с тем, кто его читал. У покупателя и автора
 * теперь по своему разделу, и текст в них тот же самый.
 *
 * Ссылки на Viewer на странице нет, хотя все три шага на него ссылаются:
 * откуда берётся дистрибутив — открытый вопрос Q6. Она встанет сюда вместе
 * со страницей `/download`, а не заглушкой раньше времени.
 */
function HowItWorksPage() {
  const { t } = useI18n()
  const page = t.howItWorks

  return (
    <Container>
      <PageHeader title={page.title} lead={page.lead} />

      <section>
        <SectionHeading>{page.reader.title}</SectionHeading>
        <StepList steps={page.reader.steps} className="mt-4" />

        {/* Кто платит комиссии сети — вопрос, который встаёт сразу после слова
            «USDC». Строка взята та же, что стоит под ценой при создании архива:
            один факт на сайте сказан одними словами. */}
        <p className="text-muted-foreground mt-4 max-w-[62ch] text-[0.875rem]">
          {t.economics.networkFees}
        </p>
      </section>

      <section className="border-border mt-6 border-t pt-6">
        <SectionHeading>{page.creator.title}</SectionHeading>

        <div className="mt-4 max-w-[62ch] space-y-2.5 text-[0.9375rem]">
          <p>{page.creator.fee}</p>
          <p className="text-muted-foreground">{page.creator.payout}</p>
          {/* Неизменность цены — то же самое предупреждение, что автор читает
              над полем цены. Здесь оно стоит до того, как он завёл кошелёк. */}
          <p className="text-muted-foreground">{t.economics.immutable}</p>
        </div>
      </section>

      <p className="mt-10">
        <Link to="/" className="text-seal-ink text-sm font-medium underline underline-offset-4">
          {page.toCatalog}
        </Link>
      </p>
    </Container>
  )
}
