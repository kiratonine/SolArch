import { Link, createFileRoute } from '@tanstack/react-router'
import { LockIcon } from 'lucide-react'

import { Container } from '@/components/layout/container'
import { SectionHeading } from '@/components/layout/section-heading'
import { StepList } from '@/components/product/step-list'
import { ViewerDownloadButton } from '@/components/product/viewer-download'
import { buttonVariants } from '@/components/ui/button'
import { useI18n } from '@/lib/i18n'
import { cn } from '@/lib/utils'

export const Route = createFileRoute('/')({
  component: LandingPage,
})

/**
 * Лендинг.
 *
 * Главная говорит с тем, кто видит SolArch впервые: что это, как устроено
 * и где взять Viewer. Каталог переехал на `/catalog` и отсюда в одном нажатии.
 *
 * Главный образ — образец контейнера: «запечатано на виду» буквально. Опись
 * файлов видна целиком, содержимое закрыто, цена стоит у печати. Механику
 * лендинг заново не пишет: шаги берёт с `/how-it-works`, условия денег —
 * из `economics`, чтобы один факт на сайте звучал одними словами.
 */
function LandingPage() {
  const { t } = useI18n()
  const page = t.landing

  return (
    <>
      <Container wide>
        <section className="grid items-center gap-12 pt-4 pb-6 lg:grid-cols-[minmax(0,1.1fr)_minmax(0,1fr)] lg:gap-16 lg:pt-10">
          <div>
            <h1 className="font-display max-w-[18ch] text-[clamp(2rem,1.2rem+3.4vw,3.5rem)] leading-[1.04] font-bold tracking-[-0.045em]">
              {page.title}
            </h1>
            <p className="text-muted-foreground mt-6 max-w-[56ch] text-[1.0625rem] leading-relaxed">
              {page.lead}
            </p>

            <div className="mt-9 flex flex-wrap items-start gap-x-6 gap-y-4">
              <ViewerDownloadButton />
              <Link
                to="/catalog"
                className={cn(buttonVariants({ variant: 'outline', size: 'lg' }), 'mt-4 px-4')}
              >
                {page.toCatalog}
              </Link>
            </div>
          </div>

          <SealedSample />
        </section>
      </Container>

      {/* Разделы ниже — колонка для чтения, но у левой кромки рамки, а не по центру:
          так они стоят на одной вертикали с заголовком и кнопкой героя. */}
      <Container wide>
        <div className="max-w-216">
          <section className="border-border mt-16 border-t pt-10">
            <SectionHeading>{page.reader.title}</SectionHeading>
            <p className="text-muted-foreground mt-2 max-w-[62ch]">{page.reader.lead}</p>
            <StepList steps={t.howItWorks.reader.steps} className="mt-5" />
            <p className="text-muted-foreground mt-4 max-w-[62ch] text-[0.875rem]">
              {t.economics.networkFees}
            </p>
          </section>
  
          <section className="border-border mt-12 border-t pt-10">
            <SectionHeading>{page.creator.title}</SectionHeading>
            <p className="mt-2 max-w-[62ch]">{page.creator.lead}</p>
  
            <FeeSplit className="mt-6" />
  
            <div className="text-muted-foreground mt-5 max-w-[62ch] space-y-2 text-[0.9375rem]">
              <p>{t.howItWorks.creator.payout}</p>
              <p>{t.economics.immutable}</p>
            </div>
  
            <Link to="/login" className={cn(buttonVariants({ size: 'lg' }), 'mt-6 px-4')}>
              {page.creator.start}
            </Link>
          </section>
  
          <section className="border-border mt-12 border-t pt-10">
            <SectionHeading>{page.formats.title}</SectionHeading>
            <ul className="mt-4 flex flex-wrap gap-2">
              {page.formats.list.map((format) => (
                <li
                  key={format}
                  className="border-border bg-card rounded-sm border px-2.5 py-1 font-mono text-[0.8125rem]"
                >
                  {format}
                </li>
              ))}
            </ul>
          </section>
  
          {/* Якорь `#download`: сюда ведёт кнопка в шапке, пока у установщика нет адреса. */}
          <section
            id="download"
            className="border-border bg-card mt-14 scroll-mt-[calc(var(--header-height)+1.5rem)] rounded-lg border px-5 py-8 sm:px-10 sm:py-10"
          >
            <h2 className="font-sans text-[1.375rem] leading-snug font-semibold tracking-[-0.02em]">
              {page.get.title}
            </h2>
            <p className="text-muted-foreground mt-2 max-w-[56ch]">{page.get.lead}</p>
            <ViewerDownloadButton className="mt-6" />
          </section>
        </div>
      </Container>
    </>
  )
}

/**
 * Образец контейнера: опись открыта, содержимое запечатано.
 *
 * Пути — те же поля, что отдаёт публичная опись (`display_path`, размер), и тем же
 * моноширинным, что на странице архива. Запечатанная часть заштрихована волосяными
 * линиями цвета границы — без теней и градиентов. Цена — деньги, поэтому бронза.
 */
function SealedSample() {
  const { t } = useI18n()
  const sample = t.landing.sample

  return (
    <figure className="border-border bg-card relative overflow-hidden rounded-lg border">
      <figcaption className="text-muted-foreground border-border border-b px-5 py-3 text-[0.8125rem]">
        {sample.label}
      </figcaption>

      <div className="px-5 pt-4 pb-5">
        <p className="font-mono text-[0.9375rem] font-medium">{sample.file}</p>

        <ul className="border-border mt-3 border-t">
          {sample.files.map((file) => (
            <li
              key={file.path}
              className="border-border flex items-baseline justify-between gap-4 border-b py-2 font-mono text-[0.8125rem]"
            >
              <span className="truncate">{file.path}</span>
              <span className="text-muted-foreground numeric shrink-0">{file.size}</span>
            </li>
          ))}
        </ul>

        <div
          className="border-border mt-4 flex flex-col items-center gap-2 rounded-md border px-4 py-7 text-center"
          style={{
            backgroundImage:
              'repeating-linear-gradient(135deg, var(--border) 0 1px, transparent 1px 9px)',
          }}
        >
          <span className="bg-primary text-primary-foreground grid size-9 place-items-center rounded-sm">
            <LockIcon aria-hidden="true" className="size-4" />
          </span>
          <p className="bg-card rounded-sm px-2 text-[0.875rem] font-medium">{sample.sealed}</p>
          <p className="text-seal-ink bg-card numeric rounded-sm px-2 font-mono text-[0.9375rem] font-medium">
            {sample.price}
          </p>
        </div>
      </div>

      {/* Угол печати — как у знака: латунь лежит на чернилах, не на бумаге. */}
      <span
        aria-hidden="true"
        className="bg-primary absolute top-0 right-0 size-10 [clip-path:polygon(0_0,100%_0,100%_100%)]"
      >
        <span className="bg-seal absolute top-0 right-0 size-6 [clip-path:polygon(0_0,100%_0,100%_100%)]" />
      </span>
    </figure>
  )
}

/**
 * Доля автора и комиссия — одна полоса, 95 к 5. Это деньги, поэтому доля автора
 * набрана бронзой; комиссия — нейтральным цветом границы.
 */
function FeeSplit({ className }: { className?: string }) {
  const { t } = useI18n()

  return (
    <figure className={cn('max-w-[40rem]', className)}>
      <figcaption className="text-muted-foreground text-[0.8125rem]">
        {t.landing.creator.split}
      </figcaption>
      <div className="mt-2 flex h-3 overflow-hidden rounded-sm" aria-hidden="true">
        <div className="bg-seal-ink" style={{ width: '95%' }} />
        <div className="bg-input" style={{ width: '5%' }} />
      </div>
      <div className="mt-2 flex justify-between text-[0.875rem]">
        <span>
          {t.economics.creator} <span className="text-seal-ink numeric font-semibold">95%</span>
        </span>
        <span className="text-muted-foreground">
          {t.economics.platform} <span className="numeric font-semibold">5%</span>
        </span>
      </div>
    </figure>
  )
}
