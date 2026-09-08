import { z } from 'zod'

/**
 * DTO Marketplace Backend.
 *
 * Схемы zod — единственный источник и типов, и рантайм-проверки. Типы выводятся через
 * `z.infer`, поэтому расходиться им негде.
 *
 * Поля намеренно повторяют wire-формат из `docs/API.md` в snake_case, без переименования
 * в camelCase: так файл сверяется с документом построчно, и рассинхрон с backend
 * обнаруживается сразу, а не превращается в тихую ошибку маппинга.
 *
 * Значения статусов зафиксированы в `docs/INTEGRATION.md` §9 — свои строки не выдумывать.
 */

// ---------------------------------------------------------------- общие типы

export const currencySchema = z.literal('USDC')
export type Currency = z.infer<typeof currencySchema>

/** Суммы приходят строкой, а не числом (`docs/API.md` §1.2). */
export const moneySchema = z.object({
  amount: z.string(),
  currency: currencySchema,
})
export type Money = z.infer<typeof moneySchema>

export const technicalStatusSchema = z.enum([
  'draft',
  'uploading',
  'processing',
  'ready',
  'failed',
])
export type TechnicalStatus = z.infer<typeof technicalStatusSchema>

export const marketplaceStatusSchema = z.enum(['draft', 'published', 'unpublished', 'blocked'])
export type MarketplaceStatus = z.infer<typeof marketplaceStatusSchema>

export const paymentStatusSchema = z.enum([
  'created',
  'pending',
  'confirmed',
  'expired',
  'failed',
])
export type PaymentStatus = z.infer<typeof paymentStatusSchema>

export const licenseStatusSchema = z.enum(['active', 'expired', 'revoked'])
export type LicenseStatus = z.infer<typeof licenseStatusSchema>

export const marketplaceSortSchema = z.enum([
  'popular_week',
  'popular_month',
  'most_downloaded',
  'price_asc',
  'price_desc',
])
export type MarketplaceSort = z.infer<typeof marketplaceSortSchema>

export const MARKETPLACE_SORTS = marketplaceSortSchema.options

export const analyticsPeriodSchema = z.enum(['7d', '30d', 'all'])
export type AnalyticsPeriod = z.infer<typeof analyticsPeriodSchema>

export const ANALYTICS_PERIODS = analyticsPeriodSchema.options

/** Метрики, которые видит любой посетитель (`docs/DECISIONS.md` ADR-015). */
export const publicMetricsSchema = z.object({
  views: z.number(),
  downloads: z.number(),
  paid_unlocks: z.number(),
})
export type PublicMetrics = z.infer<typeof publicMetricsSchema>

export const licensePolicySchema = z.object({
  max_devices: z.number(),
  allow_export: z.boolean(),
  watermark_enabled: z.boolean(),
})
export type LicensePolicy = z.infer<typeof licensePolicySchema>

/** Экономика архива. Заморожена в момент создания и после этого не меняется. */
export const economicsSchema = z.object({
  platform_fee_bps: z.number(),
  creator_share: z.string(),
  platform_share: z.string(),
  network_fees_paid_by: z.string(),
})
export type Economics = z.infer<typeof economicsSchema>

export const creatorSummarySchema = z.object({
  display_name: z.string(),
})
export type CreatorSummary = z.infer<typeof creatorSummarySchema>

/**
 * ДОПУЩЕНИЕ (открытый вопрос Q4): форма постраничного ответа каталога.
 * Если backend выберет курсорную пагинацию, правится только это место и `marketplace.ts`.
 */
export function paginatedSchema<T extends z.ZodTypeAny>(item: T) {
  return z.object({
    items: z.array(item),
    page: z.number(),
    per_page: z.number(),
    total: z.number(),
    has_more: z.boolean(),
  })
}

export interface Paginated<T> {
  items: T[]
  page: number
  per_page: number
  total: number
  has_more: boolean
}

// ------------------------------------------------------------------ auth API

export const walletChallengeResponseSchema = z.object({
  challenge_id: z.string(),
  message: z.string(),
})
export type WalletChallengeResponse = z.infer<typeof walletChallengeResponseSchema>

export interface WalletChallengeRequest {
  wallet: string
}

export interface WalletVerifyRequest {
  challenge_id: string
  wallet: string
  signature: string
}

export const sessionUserSchema = z.object({
  id: z.string(),
  wallet: z.string(),
  display_name: z.string().optional(),
})
export type SessionUser = z.infer<typeof sessionUserSchema>

export const walletVerifyResponseSchema = z.object({
  authenticated: z.boolean(),
  user: sessionUserSchema,
})
export type WalletVerifyResponse = z.infer<typeof walletVerifyResponseSchema>

// ----------------------------------------------------------- marketplace API

/** Карточка архива в каталоге (`docs/API.md` §5). */
export const marketplaceArchiveListItemSchema = z.object({
  archive_id: z.string(),
  slug: z.string(),
  title: z.string(),
  short_description: z.string(),
  cover_url: z.string().nullable(),
  creator: creatorSummarySchema,
  price: moneySchema,
  file_count: z.number(),
  size_bytes: z.number(),
  metrics: publicMetricsSchema,
})
export type MarketplaceArchiveListItem = z.infer<typeof marketplaceArchiveListItemSchema>

export const marketplaceArchiveListSchema = paginatedSchema(marketplaceArchiveListItemSchema)

/** Публичная страница архива. */
export const marketplaceArchiveDetailSchema = marketplaceArchiveListItemSchema.extend({
  description: z.string(),
  license_policy: licensePolicySchema,
  marketplace_status: marketplaceStatusSchema,
  download_available: z.boolean(),
})
export type MarketplaceArchiveDetail = z.infer<typeof marketplaceArchiveDetailSchema>

/**
 * Публичный список файлов. Только эти поля
 * (`docs/roles/02_MARKETPLACE_FRONTEND.md` §10) — никаких хешей, storage keys
 * и encryption metadata.
 */
export const publicFileEntrySchema = z.object({
  display_path: z.string(),
  display_name: z.string(),
  extension: z.string(),
  mime_type: z.string(),
  size_bytes: z.number(),
})
export type PublicFileEntry = z.infer<typeof publicFileEntrySchema>

export const publicFileListResponseSchema = z.object({
  files: z.array(publicFileEntrySchema),
})
export type PublicFileListResponse = z.infer<typeof publicFileListResponseSchema>

export interface MarketplaceListParams {
  sort?: MarketplaceSort
  search?: string
  category?: string
  page?: number
}

// -------------------------------------------------------- creator archives API

export interface CreateArchiveRequest {
  title: string
  short_description: string
  description: string
  price: Money
  creator_payout_wallet: string
  license_policy: LicensePolicy
}

/** Метаданные, которые разрешено менять после создания. Цены здесь нет и быть не может. */
export interface UpdateArchiveRequest {
  title?: string
  short_description?: string
  description?: string
  cover_url?: string | null
  category?: string
  tags?: string[]
}

/** Архив глазами владельца. */
export const creatorArchiveSchema = z.object({
  archive_id: z.string(),
  slug: z.string().nullable(),
  title: z.string(),
  short_description: z.string(),
  description: z.string(),
  cover_url: z.string().nullable(),
  technical_status: technicalStatusSchema,
  marketplace_status: marketplaceStatusSchema,
  price: moneySchema,
  economics: economicsSchema,
  license_policy: licensePolicySchema,
  creator_payout_wallet: z.string(),
  /**
   * ДОПУЩЕНИЕ (открытый вопрос Q17): публикация требует подготовленного USDC ATA
   * автора (`docs/API.md` §3), но поля, по которому фронт мог бы это узнать,
   * в контракте нет. Аккаунт заводит backend сам (ADR-009), поэтому ожидание
   * короткое — и всё же кнопку публикации надо на чём-то гасить, иначе автор
   * узнаёт о неготовности только из отказа.
   */
  payout_account_ready: z.boolean(),
  file_count: z.number(),
  size_bytes: z.number(),
  metrics: publicMetricsSchema,
  created_at: z.string(),
  /** Заполнено, когда `technical_status = failed`. */
  failure_reason: z.string().optional(),
})
export type CreatorArchive = z.infer<typeof creatorArchiveSchema>

export const creatorArchiveListSchema = z.array(creatorArchiveSchema)

/** Ответ на создание архива: экономика уже посчитана backend и является авторитетной. */
export const createArchiveResponseSchema = z.object({
  archive_id: z.string(),
  technical_status: technicalStatusSchema,
  marketplace_status: marketplaceStatusSchema,
  price: moneySchema,
  economics: economicsSchema,
})
export type CreateArchiveResponse = z.infer<typeof createArchiveResponseSchema>

// --------------------------------------------------------------- uploads API

export interface UploadInitRequest {
  archive_id: string
  filename: string
  size_bytes: number
}

/**
 * ДОПУЩЕНИЕ (открытый вопрос Q2): поддерживаем оба транспорта сразу.
 *
 * Если backend вернул `upload_url` — грузим файл прямо в хранилище.
 * Если нет — отправляем байты через сам API. Ответ на Q2 не сломает код,
 * изменится только то, какая ветка отработает.
 */
export const uploadInitResponseSchema = z.object({
  upload_id: z.string(),
  upload_url: z.string().optional(),
  method: z.enum(['PUT', 'POST']).optional(),
  headers: z.record(z.string(), z.string()).optional(),
})
export type UploadInitResponse = z.infer<typeof uploadInitResponseSchema>

export const uploadCompleteResponseSchema = z.object({
  upload_id: z.string(),
  archive_id: z.string(),
  technical_status: technicalStatusSchema,
})
export type UploadCompleteResponse = z.infer<typeof uploadCompleteResponseSchema>

// ------------------------------------------------------------- analytics API

export const analyticsConversionsSchema = z.object({
  view_to_download: z.number(),
  download_to_purchase: z.number(),
})
export type AnalyticsConversions = z.infer<typeof analyticsConversionsSchema>

export const analyticsRevenueSchema = z.object({
  gross: z.string(),
  creator: z.string(),
  platform: z.string(),
  currency: currencySchema,
})
export type AnalyticsRevenue = z.infer<typeof analyticsRevenueSchema>

export const archiveAnalyticsSchema = z.object({
  period: analyticsPeriodSchema,
  views: z.number(),
  downloads: z.number(),
  paid_unlocks: z.number(),
  conversions: analyticsConversionsSchema,
  revenue: analyticsRevenueSchema,
})
export type ArchiveAnalytics = z.infer<typeof archiveAnalyticsSchema>
