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
    rights: (year: number) => `© ${year} SolArch`,
  },

  catalog: {
    title: 'Catalog',
    lead: 'Take any archive without an account. Payment happens later, in the desktop Viewer, once the file is already yours.',
    loading: 'Loading the catalog',

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
      placeholder: 'Title, author or description',
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
    loading: 'Loading the archive',
    about: 'About this archive',
    back: 'Back to the catalog',

    /** Главный вопрос гостя на этой странице: где и когда с него возьмут деньги. */
    payment: (price: string) =>
      `You pay ${price} later, inside the SolArch Viewer on your own computer — never in this browser. SolArch covers the Solana network fees.`,

    files: {
      title: 'Contents',
      loading: 'Loading the file list',
      error: 'The file list did not load. The archive itself is fine.',
      empty: 'This archive has no files yet.',
    },

    terms: {
      title: 'What paying gives you',
      devices: {
        term: (count: number) => (count === 1 ? 'One device' : `${count} devices`),
        body: (count: number) =>
          count === 1
            ? 'The archive unlocks on the computer you pay from. Another computer needs another unlock.'
            : `One payment unlocks the archive on up to ${count} computers.`,
      },
      export: {
        term: 'No export',
        body: 'Files open inside the Viewer. Saving them back out is not part of the license.',
      },
      exportAllowed: {
        term: 'Export allowed',
        body: 'The Viewer lets you save the files out of the archive.',
      },
      watermark: {
        term: 'Watermarked',
        body: 'Every page you open carries your wallet and license id, so a leaked copy points back to it.',
      },
    },

    error: {
      title: 'The archive did not load',
    },
    missing: {
      title: 'This archive is not available',
      body: 'It was either taken off the catalog or the link is wrong.',
    },
  },

  /** Подписи под числами — строчными: это хвост числа, а не заголовок. */
  metrics: {
    views: 'views',
    downloads: 'downloads',
    unlocks: 'unlocks',
    size: 'size',
  },

  units: {
    files: (count: number) => plural(count, { one: 'file', other: 'files' }),
    views: (count: number) => plural(count, { one: 'view', other: 'views' }),
    downloads: (count: number) => plural(count, { one: 'download', other: 'downloads' }),
    unlocks: (count: number) => plural(count, { one: 'unlock', other: 'unlocks' }),
  },

  status: {
    /**
     * Технический статус говорит о файле, маркетплейсный — о витрине, и у нового
     * архива оба равны `draft`. Одно слово на двух бейджах подряд читается как
     * ошибка вёрстки, поэтому технический `draft` назван тем, чем он и является:
     * контейнер ещё не собран.
     */
    technical: {
      draft: 'Not built',
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

  /**
   * Вход автора. Главное, что должен снять текст, — страх: подпись сообщения
   * похожа на подтверждение перевода, хотя не переводит ничего.
   */
  auth: {
    title: 'Sign in with your wallet',
    lead: 'SolArch has no passwords. You sign a short message, and that signature proves the wallet is yours. It moves no funds and gives SolArch no right to spend anything.',
    keyNote: 'Your private key stays inside the wallet. The message you sign is shown here in full before the wallet asks for it.',

    choose: 'Choose your wallet',
    connecting: (wallet: string) => `Waiting for ${wallet} to connect`,

    message: {
      title: 'The message you are signing',
      hint: 'Read it before you sign. SolArch never asks you to sign something you cannot see.',
      wallet: 'Signing wallet',
      sign: 'Sign the message',
      signing: (wallet: string) => `Waiting for ${wallet} to sign`,
      verifying: 'Checking the signature',
      back: 'Use another wallet',
    },

    declined: (wallet: string) =>
      `${wallet} did not sign the message. Nothing was sent — you can sign again.`,
    failed: 'The wallet did not respond. Try again, or choose another wallet.',
    verifyFailed: 'SolArch could not verify that signature. Ask for a new message and sign it again.',
    serverFailed: 'SolArch did not answer. Try again in a moment.',

    noWallets: {
      title: 'No Solana wallet in this browser',
      body: 'SolArch works with any wallet that follows the Solana Wallet Standard — Phantom and Solflare are the common ones. Install one, then come back to this page.',
      reload: 'I installed one, look again',
    },

    session: {
      account: 'Your wallet',
      signOut: 'Sign out',

      /** Подтверждение выхода: цена промаха — кошелёк и новая подпись. */
      confirm: {
        title: 'Sign out of SolArch?',
        body: 'Your archives stay exactly where they are. Coming back means connecting your wallet and signing the message again.',
        cancel: 'Stay signed in',
      },
    },
  },

  dashboard: {
    title: 'Your archives',
    lead: 'Every archive you create shows up here with its status, price and metrics.',
    signedInAs: 'Signed in as',
    loading: 'Loading your archives',

    card: {
      yourShare: 'your share',
      created: (date: string) => `created ${date}`,
      publicPage: 'Open the public page',
    },

    empty: {
      title: 'No archives yet',
      body: 'The archives you create show up here, each with its build status, its price and what it has done in the catalog.',
    },
    error: {
      title: 'Your archives did not load',
    },
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
