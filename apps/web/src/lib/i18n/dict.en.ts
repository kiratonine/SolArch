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
    howItWorks: 'How it works',
    viewer: 'Get the Viewer',
    dashboard: 'Dashboard',
    signIn: 'Sign in',
    language: 'Language',
    themeDark: 'Switch to the dark theme',
    themeLight: 'Switch to the light theme',
    /** Кнопка и название списка ссылок на узком экране — одно и то же слово. */
    menu: 'Menu',
    /** Подвал несёт ещё одну навигацию на странице, и она обязана быть названа. */
    pages: 'Site pages',
  },

  footer: {
    rights: (year: number) => `© ${year} SolArch`,
  },

  /**
   * Как это работает.
   *
   * Сюда вернулся текст, снятый с двух мест: три шага механики с главной (F41)
   * и оба объяснения из подвала (F55). Убирали их не за содержание, а за место —
   * продуктовая проза, размазанная по подвалам и подзаголовкам, читается шумом
   * на каждом экране. Текст восстановлен слово в слово: он был написан
   * и утверждён, и переезд — не повод его переписывать.
   */
  howItWorks: {
    title: 'How it works',
    /** Восстановлено из `footer.mechanic`. Одна фраза про весь продукт. */
    lead: 'An .slr file downloads for free and travels like any other file. Paying in USDC inside the SolArch Viewer is what opens it.',

    reader: {
      title: 'If you want to read something',
      /** Восстановлено из `catalog.steps`, слово в слово и в прежнем порядке. */
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
    },

    creator: {
      title: 'If you want to sell something',
      /** Восстановлено из `footer.fee`. */
      fee: 'Creators keep 95% of every sale.',
      payout: 'The payout goes straight to your own Solana wallet. SolArch never holds it and never asks for your keys.',
    },

    toCatalog: 'Browse the catalog',
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
      placeholder: 'Title or description',
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

    /**
     * Главный вопрос гостя на этой странице: где и когда с него возьмут деньги.
     * Одна фраза, и только про это. Про сетевые комиссии и остальную механику
     * рассказывает `/how-it-works` — ссылка стоит сразу за этой строкой.
     */
    payment: 'You pay later, inside the SolArch Viewer on your own computer, never in this browser.',

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
      `${wallet} did not sign the message. Nothing was sent - you can sign again.`,
    failed: 'The wallet did not respond. Try again, or choose another wallet.',
    verifyFailed: 'SolArch could not verify that signature. Ask for a new message and sign it again.',
    serverFailed: 'SolArch did not answer. Try again in a moment.',

    noWallets: {
      title: 'No Solana wallet in this browser',
      body: 'SolArch works with any wallet that follows the Solana Wallet Standard - Phantom and Solflare are the common ones. Install one, then come back to this page.',
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
      payout: 'payout',
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

    /** Страница одного архива: всё, что автор делает с ним после создания. */
    detail: {
      back: 'All archives',
      loading: 'Loading the archive',
      missing: {
        title: 'No such archive',
        body: 'This archive does not exist, or it belongs to another creator.',
      },
      error: {
        title: 'The archive did not load',
      },

      build: {
        title: 'The container',

        draft: {
          title: 'Nothing sealed yet',
          body: 'Add the files you are selling. SolArch packs them into a sealed .slr on its servers - nothing is encrypted in your browser.',
        },
        uploading: {
          title: 'Sending your files',
          body: 'Keep this page open until the last file is through.',
        },
        processing: {
          title: 'SolArch is building the container',
          body: 'Your files are on the server. This page updates itself when the build finishes.',
        },
        ready: {
          title: 'The container is built',
          body: 'The .slr is packed and can be downloaded. Anyone can copy it around; only a paid license opens it in the Viewer.',
        },
        failed: {
          title: 'The container was not built',
          body: 'Nothing was published. Fix the file the message names and upload it again.',
        },

        download: 'Download the .slr',
        downloading: 'Preparing the .slr',
        downloadFailed: 'The .slr did not download. Try again.',
      },

      /**
       * Витрина. Заголовки описывают положение архива, а не действие: человек
       * сначала узнаёт, где архив сейчас, и только потом читает кнопку.
       */
      listing: {
        title: 'The catalog',

        draft: {
          title: 'Not in the catalog',
          body: 'Nobody can find this archive yet. Publishing gives it a page in the catalog and a link you can hand to anyone.',
        },
        published: {
          title: 'In the catalog',
          body: 'Anyone can open this archive, read its file list and download the .slr. Paying for it happens later, in the Viewer.',
        },
        unpublished: {
          title: 'Out of the catalog',
          body: 'The public page is closed and nobody new can find the archive. Copies people already downloaded still open: a license, once paid for, stays valid.',
        },
        blocked: {
          title: 'SolArch took this archive down',
          body: 'It cannot go back in the catalog from here. Write to SolArch to find out what happened.',
        },

        publish: 'Publish',
        publishing: 'Publishing',
        unpublish: 'Unpublish',
        unpublishing: 'Unpublishing',

        /** Почему кнопка погашена. Проверяет это backend, называем — мы. */
        requires: {
          notReady: 'The container has to be built before the archive can go in the catalog.',
        },

        link: {
          label: 'Public link',
          copy: 'Copy the link',
          copied: 'Copied',
        },

        preview: {
          title: 'How the catalog will show it',
          body: 'Visitors see this card in the catalog and nothing else about the archive until they open it.',
        },

        /**
         * Кнопки диалога названы одним словом. Вопрос в заголовке уже сказал, о чём
         * речь, и повторять это на обеих кнопках незачем: длинные подписи не влезали
         * в строку и вставали друг под друга.
         */
        confirm: {
          title: 'Take the archive out of the catalog?',
          body: 'The public page stops opening and the archive leaves the catalog. You can publish it again at any time, and everyone who already paid keeps their access.',
          cancel: 'Keep it',
          confirm: 'Unpublish',
        },
      },

      files: {
        title: 'Inside the archive',
        loading: 'Loading the file list',
        error: 'The file list did not load.',
        empty: 'The archive holds no files yet.',
      },
    },

    upload: {
      title: 'Add files',
      body: 'A ZIP keeps the folders you built inside it - SolArch unpacks it on the server. Single files land at the root of the archive.',
      formats: 'PDF, PNG, JPG, WebP, DOCX, XLSX or a ZIP.',
      replaces: 'A new upload replaces everything the archive holds now.',
      choose: 'Choose files',
      drop: 'or drop them here',
      dropping: 'Drop the files',

      queue: 'Files being sent',
      status: {
        queued: 'Waiting',
        done: 'Sent',
        canceled: 'Canceled',
        failed: 'Not sent',
      },
      progress: (name: string) => `Sending ${name}`,
      bundle: (files: string) => `${files} in one ZIP`,
      cancel: 'Cancel',
      retry: 'Send again',

      refused: {
        title: 'These files were not taken',
        unsupportedType: 'the Viewer cannot show this format',
        empty: 'the file is empty',
        zipNotAlone: 'a ZIP goes on its own, without other files',
      },
    },
  },

  /**
   * Аналитика архива. Ни одного числа фронт не считает — все приходят с backend,
   * и текст обязан это подтверждать: он объясняет, откуда цифры, а не толкует их.
   */
  analytics: {
    action: 'Analytics',
    title: 'Analytics',
    lead: 'SolArch does the counting. Views and downloads come from the catalog, unlocks and revenue from payments confirmed on Solana.',
    back: 'Back to the archive',
    loading: 'Loading the analytics',

    period: {
      label: 'Period',
      '7d': 'Last 7 days',
      '30d': 'Last 30 days',
      all: 'All time',
    },

    funnel: {
      title: 'From a view to an unlock',
      toDownload: 'of views ended in a download',
      toPurchase: 'of downloads ended in a paid unlock',
    },

    revenue: {
      title: 'What the archive earned',
      gross: 'Buyers paid',
      creator: 'Your payout',
      platform: 'SolArch fee',
      note: 'Only payments confirmed on Solana are counted here. The payout goes straight to your wallet - SolArch never holds it.',
    },

    empty: {
      title: 'Nothing counted yet',
      body: 'Nothing happened with this archive in this period. Counting starts once the archive is in the catalog and somebody opens it.',
    },
    error: {
      title: 'The analytics did not load',
    },
  },

  create: {
    title: 'New archive',
    lead: 'Name the archive, set its price and say where the payout goes. Files come afterwards, once the archive exists.',
    action: 'New archive',
    submit: 'Create archive',
    submitting: 'Creating the archive',
    cancel: 'Cancel',

    fields: {
      title: {
        label: 'Title',
        hint: 'Buyers read it in the catalog and at the top of the archive page.',
      },
      shortDescription: {
        label: 'Short description',
        hint: 'The single line under the title in the catalog.',
      },
      description: {
        label: 'Description',
        hint: 'The long version, shown on the archive page. You can write it later.',
      },
      price: {
        label: 'Price',
        hint: 'The buyer pays this and nothing else.',
      },
      payoutWallet: {
        label: 'Payout wallet',
        hint: 'The payout goes straight to this address. SolArch never holds it.',
        own: 'This is the wallet you signed in with.',
      },
    },

    /** Счётчик длины: он же несёт предел, поэтому в тексте ошибки числа нет. */
    counter: (used: number, max: number) => `${used} / ${max}`,

    policy: {
      title: 'What the buyer gets',
      devices: 'One device',
      devicesBody: 'A license opens the archive on a single device. This holds for every archive on SolArch.',
      export: {
        label: 'Let buyers export files',
        body: 'Leave it off and the files stay inside the Viewer.',
      },
      watermark: {
        label: 'Stamp a watermark',
        body: 'The Viewer marks every page with the license it was opened under.',
      },
    },

    errors: {
      'titleRequired': 'Name the archive.',
      'titleTooLong': 'The title is longer than the catalog can show.',
      'shortDescriptionRequired': 'Write the line that goes under the title.',
      'shortDescriptionTooLong': 'This line is longer than the catalog can show.',
      'descriptionTooLong': 'The description is longer than the page can hold.',
      'priceRequired': 'Set the price.',
      'priceFormat': 'Write the price as a number, for example 10.00.',
      'pricePrecision': 'Two decimal places at most, like 10.25.',
      'priceNotPositive': 'The price has to be above zero.',
      'payoutWalletRequired': 'Enter the address the payout goes to.',
      'payoutWalletInvalid': 'This is not a Solana address.',
    },

    failed: 'The archive was not created.',
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
