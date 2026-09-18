import { useState } from 'react'

import { useMutation, useQueryClient } from '@tanstack/react-query'
import { Link, createFileRoute, useNavigate } from '@tanstack/react-router'

import { PriceBreakdown } from '@/components/archive/price-breakdown'
import { CheckboxField } from '@/components/form/checkbox-field'
import { Field } from '@/components/form/field'
import { Container } from '@/components/layout/container'
import { PageHeader } from '@/components/layout/page-header'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Textarea } from '@/components/ui/textarea'
import { createArchive, isApiError, queryKeys, toUserMessage } from '@/lib/api'
import {
  DESCRIPTION_MAX,
  SHORT_DESCRIPTION_MAX,
  TITLE_MAX,
  emptyCreateArchiveValues,
  toCreateArchiveRequest,
  validateCreateArchive,
  type CreateArchiveField,
  type CreateArchiveProblems,
  type CreateArchiveValues,
} from '@/lib/create-archive-form'
import { useI18n } from '@/lib/i18n'
import { PLATFORM_FEE_BPS, previewEconomics, validatePriceInput } from '@/lib/money'

export const Route = createFileRoute('/dashboard/new')({
  component: NewArchivePage,
})

/**
 * Порядок обхода полей: на нём стоит перевод фокуса к первой ошибке.
 * Он же порядок чтения страницы, поэтому фокус не прыгает назад.
 */
const FIELD_ORDER: CreateArchiveField[] = [
  'title',
  'shortDescription',
  'description',
  'price',
  'payoutWallet',
]

/**
 * Отказы backend, у которых есть свой адрес на форме. Всё остальное — общая строка
 * над кнопкой: показать чужое сообщение целиком честнее, чем приписать его наугад
 * какому-нибудь полю.
 */
const SERVER_FIELDS: Record<string, CreateArchiveField> = {
  TITLE_REQUIRED: 'title',
  INVALID_PRICE: 'price',
  UNSUPPORTED_CURRENCY: 'price',
  INVALID_PAYOUT_WALLET: 'payoutWallet',
}

/**
 * Создание архива.
 *
 * Здесь принимается единственное необратимое решение — цена. После
 * `POST /v1/archives` её не меняет ни автор, ни поддержка (ADR-004): другая цена
 * значит другой архив. Поэтому разбивка 95/5 стоит вплотную к полю цены и
 * пересчитывается на каждый ввод — автор видит свою долю до нажатия кнопки, а не после.
 *
 * Файлы сюда не загружаются. Архив сначала возникает как запись и только потом
 * получает содержимое — так у загрузки есть, к чему прикрепляться. Поэтому кнопка
 * ведёт не обратно в список, а на страницу созданного архива, где эти файлы и ждут.
 */
function NewArchivePage() {
  const { t } = useI18n()
  const navigate = useNavigate()
  const queryClient = useQueryClient()

  /**
   * Сессия берётся из контекста роутера, а не из кеша запросов: её вернул guard
   * кабинета в `beforeLoad`, то есть на первом же рендере она уже есть. Кеш этого
   * не обещает — запись из него может быть вычищена, и тогда адрес выплат
   * подставился бы в поле уже после того, как автор начал печатать.
   */
  const { session } = Route.useRouteContext()

  const [values, setValues] = useState<CreateArchiveValues>(() => ({
    ...emptyCreateArchiveValues(),
    // Кошелёк входа почти всегда он же и кошелёк выплат. Поле остаётся
    // редактируемым: выплаты non-custodial, и адрес выбирает автор, а не мы.
    payoutWallet: session?.wallet ?? '',
  }))

  /**
   * Ошибки показываются только после первой попытки отправки. Красить поле,
   * к которому человек ещё не притронулся, — значит ругаться на него авансом.
   */
  const [problems, setProblems] = useState<CreateArchiveProblems>({})
  const [checked, setChecked] = useState(false)

  const [serverProblem, setServerProblem] = useState<{
    field?: CreateArchiveField
    message: string
  } | null>(null)

  const mutation = useMutation({
    mutationFn: createArchive,
    onSuccess: async (created) => {
      // Список кабинета устарел: в нём нет нового черновика.
      await queryClient.invalidateQueries({ queryKey: queryKeys.archives.list() })
      // Пустой архив бесполезен, и следующий шаг у него ровно один — файлы.
      // Автор попадает прямо туда, где их загружают, а не обратно в список.
      await navigate({ to: '/dashboard/$archiveId', params: { archiveId: created.archive_id } })
    },
    onError: (error: unknown) => {
      setServerProblem({
        field: isApiError(error) ? SERVER_FIELDS[error.code] : undefined,
        message: toUserMessage(error),
      })
    },
  })

  function update<K extends CreateArchiveField>(field: K, value: CreateArchiveValues[K]) {
    const next = { ...values, [field]: value }
    setValues(next)
    setServerProblem(null)
    // После первой проверки форма пересчитывается на каждый ввод: ошибка обязана
    // исчезнуть в тот момент, когда её исправили, а не после следующей отправки.
    if (checked) setProblems(validateCreateArchive(next))
  }

  function submit(event: React.FormEvent) {
    event.preventDefault()
    setChecked(true)
    setServerProblem(null)

    const found = validateCreateArchive(values)
    setProblems(found)

    const firstBad = FIELD_ORDER.find((field) => found[field])
    if (firstBad) {
      document.getElementById(firstBad)?.focus()
      return
    }

    mutation.mutate(toCreateArchiveRequest(values))
  }

  /** Текст ошибки поля: своя проверка, а если её нет — отказ backend по этому полю. */
  function errorOf(field: CreateArchiveField): string | undefined {
    const problem = problems[field]
    if (problem) return t.create.errors[problem]
    return serverProblem?.field === field ? serverProblem.message : undefined
  }

  /** Счётчик появляется на подходе к пределу: раньше он только шумит. */
  function counterOf(value: string, max: number): string | undefined {
    return value.length > max * 0.8 ? t.create.counter(value.length, max) : undefined
  }

  // Разбивка живёт, пока цена разобрана. Числа предварительные: после создания
  // источником истины становится `economics` из ответа backend.
  const preview = validatePriceInput(values.price) ? null : previewEconomics(values.price)

  const payoutIsOwn = session ? values.payoutWallet.trim() === session.wallet : false
  const payoutHint = payoutIsOwn
    ? `${t.create.fields.payoutWallet.hint} ${t.create.fields.payoutWallet.own}`
    : t.create.fields.payoutWallet.hint

  return (
    <Container>
      <PageHeader title={t.create.title} lead={t.create.lead} />

      <form onSubmit={submit} noValidate className="max-w-136 space-y-7">
        <Field
          id="title"
          label={t.create.fields.title.label}
          hint={t.create.fields.title.hint}
          counter={counterOf(values.title, TITLE_MAX)}
          error={errorOf('title')}
        >
          {(control) => (
            <Input
              {...control}
              value={values.title}
              onChange={(event) => update('title', event.currentTarget.value)}
              className="h-10"
            />
          )}
        </Field>

        <Field
          id="shortDescription"
          label={t.create.fields.shortDescription.label}
          hint={t.create.fields.shortDescription.hint}
          counter={counterOf(values.shortDescription, SHORT_DESCRIPTION_MAX)}
          error={errorOf('shortDescription')}
        >
          {(control) => (
            <Input
              {...control}
              value={values.shortDescription}
              onChange={(event) => update('shortDescription', event.currentTarget.value)}
              className="h-10"
            />
          )}
        </Field>

        <Field
          id="description"
          label={t.create.fields.description.label}
          hint={t.create.fields.description.hint}
          counter={counterOf(values.description, DESCRIPTION_MAX)}
          error={errorOf('description')}
        >
          {(control) => (
            <Textarea
              {...control}
              value={values.description}
              onChange={(event) => update('description', event.currentTarget.value)}
              rows={6}
            />
          )}
        </Field>

        <div className="space-y-4">
          <Field
            id="price"
            label={t.create.fields.price.label}
            hint={t.create.fields.price.hint}
            error={errorOf('price')}
          >
            {(control) => (
              <div className="flex items-center gap-2">
                <Input
                  {...control}
                  value={values.price}
                  onChange={(event) => update('price', event.currentTarget.value)}
                  inputMode="decimal"
                  placeholder="10.00"
                  className="numeric h-10 max-w-40"
                />
                <span className="text-muted-foreground font-mono text-sm">USDC</span>
              </div>
            )}
          </Field>

          {/* Разбивка стоит вплотную к цене: она и есть последствие введённого числа.
              Пока цена не разобрана, блок держит место прочерками — иначе страница
              прыгала бы на каждом нажатии клавиши. */}
          <PriceBreakdown
            price={{ currency: 'USDC', amount: preview?.price ?? '—' }}
            creator={preview?.creator ?? '—'}
            platform={preview?.platform ?? '—'}
            platformFeeBps={PLATFORM_FEE_BPS}
            showImmutableNotice
          />
        </div>

        <Field
          id="payoutWallet"
          label={t.create.fields.payoutWallet.label}
          hint={payoutHint}
          error={errorOf('payoutWallet')}
        >
          {(control) => (
            <Input
              {...control}
              value={values.payoutWallet}
              onChange={(event) => update('payoutWallet', event.currentTarget.value)}
              spellCheck={false}
              autoComplete="off"
              className="h-10 font-mono text-[0.8125rem]"
            />
          )}
        </Field>

        <fieldset className="space-y-4">
          <legend className="font-sans text-[1.0625rem] leading-snug font-semibold tracking-[-0.01em]">
            {t.create.policy.title}
          </legend>

          {/* Одно устройство на лицензию — продуктовая константа, а не выбор автора.
              Стоит здесь потому, что покупатель получает это наравне с остальным. */}
          <div className="border-border space-y-1 border-l-2 pl-4">
            <p className="text-[0.9375rem] font-medium">{t.create.policy.devices}</p>
            <p className="text-muted-foreground max-w-[62ch] text-[0.8125rem]">
              {t.create.policy.devicesBody}
            </p>
          </div>

          <CheckboxField
            id="allowExport"
            label={t.create.policy.export.label}
            body={t.create.policy.export.body}
            checked={values.allowExport}
            onChange={(next) => update('allowExport', next)}
          />

          <CheckboxField
            id="watermarkEnabled"
            label={t.create.policy.watermark.label}
            body={t.create.policy.watermark.body}
            checked={values.watermarkEnabled}
            onChange={(next) => update('watermarkEnabled', next)}
          />
        </fieldset>

        {serverProblem && !serverProblem.field && (
          <p className="text-state-error text-[0.8125rem]" role="alert">
            {t.create.failed} {serverProblem.message}
          </p>
        )}

        <div className="border-border flex items-center gap-4 border-t pt-6">
          <Button type="submit" size="lg" disabled={mutation.isPending}>
            {mutation.isPending ? t.create.submitting : t.create.submit}
          </Button>
          <Link
            to="/dashboard"
            className="text-muted-foreground hover:text-foreground text-sm underline-offset-4 hover:underline"
          >
            {t.create.cancel}
          </Link>
        </div>
      </form>
    </Container>
  )
}
