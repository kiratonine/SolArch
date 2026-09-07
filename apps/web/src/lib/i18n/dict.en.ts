import { makePlural } from './plural'

const plural = makePlural('en')

/**
 * Английский словарь — источник ФОРМЫ для всех остальных локалей.
 *
 * `dict.ru.ts` объявлен как `typeof en`, поэтому забытый или лишний ключ
 * падает на `tsc`, а не всплывает пустой строкой в интерфейсе.
 *
 * Правила копирайтинга: активный залог, обычный регистр, никаких капслок-меток.
 * Одно действие называется одним словом на всём пути: кнопка «Publish» даёт
 * состояние «Published».
 */
export const en = {
  localeName: 'English',

  brand: {
    /** Одна строка, объясняющая механику продукта целиком. */
    tagline: 'Sealed files, open catalog',
  },

  nav: {
    catalog: 'Catalog',
    viewer: 'Get the Viewer',
    dashboard: 'Dashboard',
    signIn: 'Sign in',
    language: 'Language',
    themeDark: 'Switch to the dark theme',
    themeLight: 'Switch to the light theme',
  },

  footer: {
    mechanic:
      'An .slr file downloads for free and travels like any other file. Paying in USDC inside the SolArch Viewer is what opens it.',
    fee: 'Creators keep 95% of every sale.',
  },

  catalog: {
    title: 'Catalog',
    lead: 'Take any archive without an account. Payment happens later, in the desktop Viewer, once the file is already yours.',
    loading: 'Loading the catalog',

    /** Три шага механики. Landing обязан объяснять продукт (роль §3.1). */
    steps: [
      {
        title: 'Take the file',
        body: 'Every .slr leaves the catalog for free and without an account. Keep it, copy it, pass it on.',
      },
      {
        title: 'Open it in the Viewer',
        body: 'The container stays sealed until the desktop SolArch Viewer opens it on your computer.',
      },
      {
        title: 'Pay once in USDC',
        body: 'One payment unlocks the archive on one device. The creator keeps 95% of it.',
      },
    ],

    sort: {
      label: 'Sort',
      popular_week: 'This week',
      popular_month: 'This month',
      most_downloaded: 'Most downloaded',
      price_asc: 'Lowest price',
      price_desc: 'Highest price',
    },

    search: {
      label: 'Search the catalog',
      placeholder: 'Search by title or description',
      clear: 'Clear the search',
    },

    pagination: {
      label: 'Catalog pages',
      previous: 'Previous',
      next: 'Next',
      position: (page: number, pages: number) => `Page ${page} of ${pages}`,
    },

    empty: {
      title: 'Nothing is published yet',
      body: 'The first archive to go live shows up here.',
    },
    noMatches: {
      title: (query: string) => `Nothing matches “${query}”`,
      body: 'Try a shorter query, or clear the search and browse everything.',
    },
    error: {
      title: 'The catalog did not load',
    },
  },

  archive: {
    by: 'by',
    download: 'Download .slr',
    price: 'Price',
    free: 'Free to download',
    openedIn: 'Opens in the SolArch Viewer after payment',
    loading: 'Loading the archive',
    about: 'About this archive',
    back: 'Back to the catalog',
    error: {
      title: 'The archive did not load',
    },
    missing: {
      title: 'This archive is not available',
      body: 'It was either taken off the catalog or the link is wrong.',
    },
  },

  metrics: {
    views: 'Views',
    downloads: 'Downloads',
    unlocks: 'Unlocks',
    files: 'Files',
    size: 'size',
  },

  units: {
    files: (count: number) => plural(count, { one: 'file', other: 'files' }),
    archives: (count: number) => plural(count, { one: 'archive', other: 'archives' }),
    views: (count: number) => plural(count, { one: 'view', other: 'views' }),
    downloads: (count: number) => plural(count, { one: 'download', other: 'downloads' }),
    unlocks: (count: number) => plural(count, { one: 'unlock', other: 'unlocks' }),
  },

  status: {
    technical: {
      draft: 'Draft',
      uploading: 'Uploading',
      processing: 'Processing',
      ready: 'Ready',
      failed: 'Failed',
    },
    marketplace: {
      draft: 'Draft',
      published: 'Published',
      unpublished: 'Unpublished',
      blocked: 'Blocked',
    },
  },

  economics: {
    title: 'How the price splits',
    buyerPays: 'Buyer pays',
    creator: 'Creator',
    platform: 'SolArch fee',
    networkFees: 'SolArch covers Solana network fees. The buyer pays the archive price and nothing else.',
    immutable: 'The price is fixed when the archive is created and cannot be changed later.',
  },

  common: {
    retry: 'Try again',
    notFound: {
      title: 'This page does not exist',
      back: 'Back to the catalog',
    },
  },
}

export type Dictionary = typeof en
