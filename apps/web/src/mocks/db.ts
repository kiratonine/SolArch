import { previewEconomics } from '@/lib/money'
import type {
  CreatorArchive,
  Economics,
  LicensePolicy,
  PublicFileEntry,
  SessionUser,
} from '@/lib/api/types'

/**
 * Состояние мок-backend в памяти.
 *
 * Мок хранит состояние, а не отдаёт статику: created → uploaded → processing → ready
 * → published должно реально проходить, иначе экраны состояний невозможно проверить.
 * Состояние живёт до перезагрузки страницы; в тестах сбрасывается через `resetDb()`.
 */

export interface MockArchive extends CreatorArchive {
  files: PublicFileEntry[]
  /** Имя автора. В контракте это `creator.display_name` публичного ответа. */
  creator_display_name: string
  /**
   * Владелец архива. Поля нет в контракте: оно нужно самому моку, чтобы кабинет
   * автора показывал свои архивы, а не весь каталог. Наружу не отдаётся.
   */
  owner_id: string
}

export interface MockUpload {
  upload_id: string
  archive_id: string
  filename: string
  size_bytes: number
}

export const MOCK_CREATOR: SessionUser = {
  id: 'usr_creator_1',
  wallet: '7xKXtg2CW87d97TXJSDpbD5jBkheTqA83TZRuJosgAsU',
  display_name: 'Aurora Labs',
}

const DEFAULT_POLICY: LicensePolicy = {
  max_devices: 1,
  allow_export: false,
  watermark_enabled: true,
}

function economicsFor(amount: string): Economics {
  const preview = previewEconomics(amount)
  return {
    platform_fee_bps: preview.feeBps,
    creator_share: preview.creator,
    platform_share: preview.platform,
    network_fees_paid_by: 'solarch',
  }
}

function pdf(path: string, sizeKb: number): PublicFileEntry {
  const name = path.split('/').at(-1) ?? path
  return {
    display_path: path,
    display_name: name,
    extension: 'pdf',
    mime_type: 'application/pdf',
    size_bytes: sizeKb * 1024,
  }
}

function image(path: string, sizeKb: number): PublicFileEntry {
  const name = path.split('/').at(-1) ?? path
  return {
    display_path: path,
    display_name: name,
    extension: 'png',
    mime_type: 'image/png',
    size_bytes: sizeKb * 1024,
  }
}

function sheet(path: string, sizeKb: number): PublicFileEntry {
  const name = path.split('/').at(-1) ?? path
  return {
    display_path: path,
    display_name: name,
    extension: 'xlsx',
    mime_type: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
    size_bytes: sizeKb * 1024,
  }
}

/**
 * Обложка-заглушка как data URI.
 *
 * Настоящие обложки грузит автор (открытый вопрос Q3), но без единой обложки в моке
 * весь путь отрисовки был бы мёртвым кодом. Картинка нарочно схематична — лист,
 * расчерченный волосяными линиями, и печать посередине: это заглушка, а не дизайн.
 */
function cover(hue: number): string {
  const svg =
    `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 1200 630">` +
    `<rect width="1200" height="630" fill="hsl(${hue} 24% 93%)"/>` +
    `<g stroke="hsl(${hue} 20% 80%)" stroke-width="2">` +
    `<path d="M0 210h1200M0 420h1200M400 0v630M800 0v630"/></g>` +
    `<circle cx="600" cy="315" r="84" fill="hsl(38 74% 62%)"/>` +
    `<circle cx="600" cy="315" r="84" fill="none" stroke="hsl(38 46% 36%)" stroke-width="6"/>` +
    `</svg>`

  return `data:image/svg+xml,${encodeURIComponent(svg)}`
}

interface SeedInput {
  id: string
  slug: string | null
  title: string
  short: string
  description: string
  /** Имя автора. У каждого архива своё: каталог с одним автором на все карточки
   *  не даёт увидеть ни как ведёт себя длинное имя, ни что автор вообще меняется. */
  creator: string
  /** Архив принадлежит тому автору, который логинится в кабинете. */
  mine?: boolean
  amount: string
  views: number
  downloads: number
  paid: number
  files: PublicFileEntry[]
  createdAt: string
  cover?: string
  marketplace_status?: MockArchive['marketplace_status']
  technical_status?: MockArchive['technical_status']
}

function seedArchive(input: SeedInput): MockArchive {
  return {
    archive_id: input.id,
    slug: input.slug,
    title: input.title,
    short_description: input.short,
    description: input.description,
    cover_url: input.cover ?? null,
    technical_status: input.technical_status ?? 'ready',
    marketplace_status: input.marketplace_status ?? 'published',
    price: { amount: input.amount, currency: 'USDC' },
    economics: economicsFor(input.amount),
    license_policy: DEFAULT_POLICY,
    creator_payout_wallet: MOCK_CREATOR.wallet,
    payout_account_ready: true,
    file_count: input.files.length,
    size_bytes: input.files.reduce((sum, file) => sum + file.size_bytes, 0),
    metrics: { views: input.views, downloads: input.downloads, paid_unlocks: input.paid },
    created_at: input.createdAt,
    files: input.files,
    creator_display_name: input.creator,
    owner_id: input.mine ? MOCK_CREATOR.id : `usr_${input.id}`,
  }
}

function seed(): MockArchive[] {
  return [
    seedArchive({
      id: 'arc_solana_course',
      creator: 'Aurora Labs',
      mine: true,
      slug: 'solana-program-security',
      title: 'Solana Program Security',
      short: 'Аудит смарт-контрактов Solana: чек-листы, разборы уязвимостей, шаблоны отчётов.',
      description:
        'Полный курс по безопасности программ на Solana. Внутри — 12 разборов реальных ' +
        'уязвимостей, чек-лист аудитора, шаблоны отчётов и таблица оценки рисков.',
      amount: '49.00',
      views: 18420,
      downloads: 4210,
      paid: 612,
      createdAt: '2026-04-12T09:00:00Z',
      // Корень, папка и вложенная папка сразу: опись обязана читаться на всех трёх.
      files: [
        pdf('read-me-first.pdf', 64),
        pdf('security/00-intro.pdf', 820),
        pdf('security/01-account-model.pdf', 1640),
        pdf('security/02-signer-checks.pdf', 1200),
        sheet('security/checklists/audit-checklist.xlsx', 112),
        sheet('security/checklists/risk-matrix.xlsx', 96),
      ],
    }),
    seedArchive({
      id: 'arc_brand_kit',
      creator: 'Studio Kirn',
      slug: 'nebula-brand-kit',
      title: 'Nebula Brand Kit',
      short: 'Айдентика для web3-проекта: логотипы, палитры, типографика, гайдлайны.',
      description:
        'Готовая айдентика: логотип в четырёх начертаниях, палитры для светлой и тёмной темы, ' +
        'типографическая шкала и руководство по применению.',
      amount: '19.00',
      views: 9310,
      downloads: 2870,
      paid: 421,
      createdAt: '2026-05-02T12:30:00Z',
      cover: cover(258),
      files: [
        pdf('brand/guidelines.pdf', 5400),
        image('brand/logo-primary.png', 340),
        image('brand/logo-mono.png', 210),
        image('brand/palette.png', 180),
      ],
    }),
    seedArchive({
      id: 'arc_trading_journal',
      creator: 'Mara Velez',
      slug: 'quant-trading-journal',
      title: 'Quant Trading Journal',
      short: 'Система учёта сделок и разбора ошибок: таблицы, метрики, инструкция.',
      description:
        'Журнал сделок с автоматическим расчётом метрик, шаблоны еженедельного разбора ' +
        'и методика работы над ошибками.',
      amount: '12.50',
      views: 22140,
      downloads: 7650,
      paid: 388,
      createdAt: '2026-03-18T08:15:00Z',
      files: [sheet('journal/trades.xlsx', 240), pdf('journal/manual.pdf', 980)],
    }),
    seedArchive({
      id: 'arc_photo_pack',
      creator: 'Илья Соколов',
      slug: 'analog-film-pack',
      title: 'Analog Film Pack',
      short: 'Сто отсканированных плёночных кадров в высоком разрешении.',
      description: 'Сканы 35 мм плёнки: городские сцены, портреты, ночная съёмка.',
      amount: '8.00',
      views: 15980,
      downloads: 6120,
      paid: 205,
      createdAt: '2026-06-01T17:45:00Z',
      cover: cover(28),
      files: [
        image('film/roll-01.png', 8200),
        image('film/roll-02.png', 7900),
        image('film/roll-03.png', 8400),
      ],
    }),
    seedArchive({
      id: 'arc_legal_templates',
      creator: 'Brightwater Legal Collective',
      slug: 'web3-legal-templates',
      title: 'Web3 Legal Templates',
      short: 'Договоры и политики для крипто-продукта: 14 документов.',
      description:
        'Пакет юридических шаблонов: пользовательское соглашение, политика ' +
        'конфиденциальности, договор с подрядчиком, условия токенсейла.',
      amount: '120.00',
      views: 6240,
      downloads: 980,
      paid: 143,
      createdAt: '2026-02-09T10:00:00Z',
      files: [pdf('legal/terms-of-service.pdf', 420), pdf('legal/privacy-policy.pdf', 380)],
    }),
    seedArchive({
      id: 'arc_anchor_cookbook',
      creator: 'Aurora Labs',
      mine: true,
      slug: 'solana-anchor-cookbook',
      title: 'Solana Anchor Cookbook',
      short: 'Готовые рецепты на Anchor: PDA, токен-аккаунты, тесты, деплой.',
      description:
        'Сборник рецептов для разработки на Anchor: работа с PDA, создание и закрытие ' +
        'токен-аккаунтов, интеграционные тесты и порядок деплоя в mainnet.',
      amount: '24.00',
      views: 11730,
      downloads: 3480,
      paid: 517,
      createdAt: '2026-05-21T14:20:00Z',
      files: [
        pdf('anchor/01-pda.pdf', 940),
        pdf('anchor/02-token-accounts.pdf', 1120),
        pdf('anchor/03-testing.pdf', 860),
      ],
    }),
    seedArchive({
      id: 'arc_ml_notebooks',
      creator: 'Nadia Oyelaran',
      slug: 'applied-ml-notebooks',
      title: 'Applied ML Notebooks',
      short: 'Разборы прикладных задач машинного обучения с данными и выводами.',
      description:
        'Двенадцать разобранных задач: подготовка данных, выбор метрики, ошибки ' +
        'валидации и разбор того, почему модель работает не так, как ожидалось.',
      amount: '34.00',
      views: 8120,
      downloads: 1940,
      paid: 268,
      createdAt: '2026-06-14T11:05:00Z',
      files: [
        pdf('ml/00-method.pdf', 1280),
        sheet('ml/datasets.xlsx', 520),
        pdf('ml/case-studies.pdf', 3400),
      ],
    }),
    seedArchive({
      id: 'arc_type_specimens',
      creator: 'Foundry Kolm',
      slug: 'grotesque-type-specimens',
      title: 'Grotesque Type Specimens',
      short: 'Сорок разворотов-образцов гротесков в высоком разрешении.',
      description:
        'Образцы наборных гротесков: развороты с кеглями, начертаниями и примерами ' +
        'вёрстки. Пригодны для подбора шрифтовой пары и печати.',
      amount: '15.00',
      views: 5410,
      downloads: 1620,
      paid: 96,
      createdAt: '2026-07-02T09:40:00Z',
      cover: cover(150),
      files: [
        image('type/spread-01.png', 6100),
        image('type/spread-02.png', 5800),
        image('type/spread-03.png', 6400),
        image('type/spread-04.png', 5900),
      ],
    }),
    seedArchive({
      id: 'arc_startup_finance',
      creator: 'Peter Zheng',
      slug: 'startup-finance-models',
      title: 'Startup Finance Models',
      short: 'Финансовые модели раннего этапа: юнит-экономика, runway, найм.',
      description:
        'Три связанные модели: юнит-экономика, план найма и прогноз runway. ' +
        'К каждой — инструкция, как заполнять и что проверять перед показом инвестору.',
      amount: '59.00',
      views: 7340,
      downloads: 1180,
      paid: 174,
      createdAt: '2026-04-28T16:10:00Z',
      files: [
        sheet('finance/unit-economics.xlsx', 310),
        sheet('finance/hiring-plan.xlsx', 180),
        sheet('finance/runway.xlsx', 220),
        pdf('finance/manual.pdf', 760),
      ],
    }),
    seedArchive({
      id: 'arc_draft_notes',
      creator: 'Aurora Labs',
      mine: true,
      slug: null,
      title: 'Untitled research notes',
      short: 'Черновик, ещё не опубликован.',
      description: 'Черновик архива для проверки состояния draft в дашборде автора.',
      amount: '5.00',
      views: 0,
      downloads: 0,
      paid: 0,
      createdAt: '2026-09-01T09:00:00Z',
      marketplace_status: 'draft',
      technical_status: 'draft',
      files: [],
    }),
  ]
}

interface MockDb {
  archives: MockArchive[]
  uploads: MockUpload[]
  session: SessionUser | null
  challenges: Map<string, string>
  counter: number
}

export const db: MockDb = {
  archives: seed(),
  uploads: [],
  session: null,
  challenges: new Map(),
  counter: 0,
}

/** Сбрасывает мок в исходное состояние. Вызывается между тестами. */
export function resetDb(): void {
  db.archives = seed()
  db.uploads = []
  db.session = null
  db.challenges = new Map()
  db.counter = 0
}

export function nextId(prefix: string): string {
  db.counter += 1
  return `${prefix}_${db.counter.toString().padStart(4, '0')}`
}

export function findBySlug(slug: string): MockArchive | undefined {
  return db.archives.find((archive) => archive.slug === slug)
}

export function findById(archiveId: string): MockArchive | undefined {
  return db.archives.find((archive) => archive.archive_id === archiveId)
}

export { DEFAULT_POLICY, economicsFor }
