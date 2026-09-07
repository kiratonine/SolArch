import { z } from 'zod'

import { formatUsdc, parseUsdc, validatePriceInput, type PriceProblem } from './money'
import { isSolanaAddress } from './solana-address'
import type { CreateArchiveRequest } from './api'

/**
 * Форма создания архива: значения, проверка и сборка тела запроса.
 *
 * Здесь нет ни одного слова интерфейса. Проверка возвращает КОДЫ причин, а текст
 * к ним подбирает словарь — иначе половина сообщений жила бы в компоненте и
 * существовала бы на одном языке.
 *
 * Тело запроса собирается тоже здесь: поля формы (camelCase, как в React) и поля
 * контракта (snake_case, как на проводе) сходятся в одном месте, а не расползаются
 * по разметке.
 */

/** Значения полей. Всё, что человек трогает руками. */
export interface CreateArchiveValues {
  title: string
  shortDescription: string
  description: string
  /** Цена как строка: decimal string на проводе, float запрещён (`docs/PAYMENTS.md` §5). */
  price: string
  payoutWallet: string
  allowExport: boolean
  watermarkEnabled: boolean
}

export type CreateArchiveField = keyof CreateArchiveValues

/**
 * Причины отказа. Каждая — ключ словаря: `t.create.errors[problem]`.
 * Забытый перевод падает на `tsc` в месте обращения, а не пустотой на экране.
 */
export type CreateArchiveProblem =
  | 'titleRequired'
  | 'titleTooLong'
  | 'shortDescriptionRequired'
  | 'shortDescriptionTooLong'
  | 'descriptionTooLong'
  | 'priceRequired'
  | 'priceFormat'
  | 'pricePrecision'
  | 'priceNotPositive'
  | 'payoutWalletRequired'
  | 'payoutWalletInvalid'

export type CreateArchiveProblems = Partial<Record<CreateArchiveField, CreateArchiveProblem>>

/**
 * Пределы длины.
 *
 * Заголовок и короткое описание попадают в карточку каталога, где на них отведено
 * место; описание читают на странице архива, где места больше. Пределы существуют,
 * чтобы автор узнал о них здесь, а не из отказа backend после отправки.
 */
export const TITLE_MAX = 120
export const SHORT_DESCRIPTION_MAX = 200
export const DESCRIPTION_MAX = 4000

/** Причины отказа по цене приходят из `lib/money.ts` — здесь у них имена формы. */
const PRICE_PROBLEMS: Record<PriceProblem, CreateArchiveProblem> = {
  required: 'priceRequired',
  format: 'priceFormat',
  precision: 'pricePrecision',
  notPositive: 'priceNotPositive',
}

const schema = z.object({
  title: z.string().trim().min(1, 'titleRequired').max(TITLE_MAX, 'titleTooLong'),
  shortDescription: z
    .string()
    .trim()
    .min(1, 'shortDescriptionRequired')
    .max(SHORT_DESCRIPTION_MAX, 'shortDescriptionTooLong'),
  description: z.string().trim().max(DESCRIPTION_MAX, 'descriptionTooLong'),
  price: z.string().superRefine((value, ctx) => {
    const problem = validatePriceInput(value)
    if (problem) ctx.addIssue({ code: 'custom', message: PRICE_PROBLEMS[problem] })
  }),
  payoutWallet: z
    .string()
    .trim()
    .min(1, 'payoutWalletRequired')
    .refine(isSolanaAddress, 'payoutWalletInvalid'),
  allowExport: z.boolean(),
  watermarkEnabled: z.boolean(),
})

/** Пустая форма. Адрес выплат подставляет страница — кошельком, которым автор вошёл. */
export function emptyCreateArchiveValues(): CreateArchiveValues {
  return {
    title: '',
    shortDescription: '',
    description: '',
    price: '',
    payoutWallet: '',
    allowExport: false,
    // Водяной знак включён по умолчанию: архив защищают, а не раздают.
    watermarkEnabled: true,
  }
}

/**
 * Проверяет форму целиком. На поле остаётся первая причина: человеку нужно знать,
 * что исправить, а не полный перечень того, чем строка не угодила.
 */
export function validateCreateArchive(values: CreateArchiveValues): CreateArchiveProblems {
  const result = schema.safeParse(values)
  if (result.success) return {}

  const problems: CreateArchiveProblems = {}

  for (const issue of result.error.issues) {
    const field = issue.path[0] as CreateArchiveField | undefined
    if (field && !problems[field]) {
      problems[field] = issue.message as CreateArchiveProblem
    }
  }

  return problems
}

/**
 * Приводит цену к тому виду, в котором её увидел автор.
 *
 * Разбивка 95/5 показывает сумму через `formatUsdc`, поэтому «12.5» на экране уже
 * стало «12.50». Отправлять при этом исходную строку значит записать в архив не то
 * число, которое человек утвердил, — а цена неизменяема, и переписать её потом
 * нельзя. Значащая точность не теряется: «1.234567» так и уходит.
 *
 * Строка сюда попадает уже проверенной, но если она вдруг не разбирается,
 * отправляем её как есть: последнее слово о цене всё равно за backend.
 */
function normalizePrice(value: string): string {
  const trimmed = value.trim()

  try {
    return formatUsdc(parseUsdc(trimmed))
  } catch {
    return trimmed
  }
}

/**
 * Собирает тело `POST /v1/archives` (`docs/API.md` §3).
 *
 * `max_devices` не поле формы, а продуктовая константа: одно устройство на лицензию.
 * Валюта тоже не выбирается — маркетплейс работает только в USDC.
 */
export function toCreateArchiveRequest(values: CreateArchiveValues): CreateArchiveRequest {
  return {
    title: values.title.trim(),
    short_description: values.shortDescription.trim(),
    description: values.description.trim(),
    price: { currency: 'USDC', amount: normalizePrice(values.price) },
    creator_payout_wallet: values.payoutWallet.trim(),
    license_policy: {
      max_devices: 1,
      allow_export: values.allowExport,
      watermark_enabled: values.watermarkEnabled,
    },
  }
}
