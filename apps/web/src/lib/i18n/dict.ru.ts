import type { Dictionary } from './dict.en'
import { makePlural } from './plural'

const plural = makePlural('ru')

/**
 * Русский словарь. Тип `Dictionary` заимствован у английского:
 * пропущенный или лишний ключ — ошибка компиляции, а не пустое место на экране.
 */
export const ru: Dictionary = {
  localeName: 'Русский',

  nav: {
    catalog: 'Каталог',
    viewer: 'Скачать Viewer',
    dashboard: 'Кабинет',
    signIn: 'Войти',
    language: 'Язык',
    themeDark: 'Включить тёмную тему',
    themeLight: 'Включить светлую тему',
  },

  footer: {
    rights: (year: number) => `© ${year} SolArch`,
  },

  catalog: {
    title: 'Каталог',
    lead: 'Любой архив можно забрать без регистрации. Оплата происходит позже, в десктопном Viewer, когда файл уже у вас.',
    loading: 'Загружаем каталог',

    sort: {
      label: 'Сортировка',
      popular_week: 'За неделю',
      popular_month: 'За месяц',
      most_downloaded: 'По скачиваниям',
      price_asc: 'Сначала дешевле',
      price_desc: 'Сначала дороже',
    },

    search: {
      label: 'Поиск по каталогу',
      placeholder: 'Название, автор или описание',
      clear: 'Очистить поиск',
    },

    pagination: {
      label: 'Страницы каталога',
      previous: 'Назад',
      next: 'Вперёд',
      position: (page: number, pages: number) => `Страница ${page} из ${pages}`,
    },

    empty: {
      title: 'Пока ничего не опубликовано',
      body: 'Первый вышедший архив появится здесь.',
    },
    noMatches: {
      title: (query: string) => `По запросу «${query}» ничего нет`,
      body: 'Попробуйте запрос короче или очистите поиск и посмотрите весь каталог.',
    },
    error: {
      title: 'Каталог не загрузился',
    },
  },

  archive: {
    by: 'автор',
    download: 'Скачать .slr',
    price: 'Цена',
    free: 'Скачивание бесплатно',
    loading: 'Загружаем архив',
    about: 'Об архиве',
    back: 'Вернуться в каталог',

    payment: (price: string) =>
      `Оплата — ${price} — происходит позже, в SolArch Viewer на вашем компьютере, а не в этом браузере. Сетевые комиссии Solana платит SolArch.`,

    files: {
      title: 'Содержимое',
      loading: 'Загружаем список файлов',
      error: 'Список файлов не загрузился. С самим архивом всё в порядке.',
      empty: 'В этом архиве пока нет файлов.',
    },

    terms: {
      title: 'Что даёт оплата',
      devices: {
        term: (count: number) =>
          count === 1
            ? 'Одно устройство'
            : `${count} ${plural(count, { one: 'устройство', few: 'устройства', other: 'устройств' })}`,
        body: (count: number) =>
          count === 1
            ? 'Архив открывается на том компьютере, с которого прошла оплата. Другому компьютеру нужна другая оплата.'
            : `Одна оплата открывает архив не более чем на ${count} компьютерах.`,
      },
      export: {
        term: 'Без экспорта',
        body: 'Файлы открываются внутри Viewer. Сохранить их наружу лицензия не позволяет.',
      },
      exportAllowed: {
        term: 'Экспорт разрешён',
        body: 'Viewer позволяет сохранить файлы из архива наружу.',
      },
      watermark: {
        term: 'С водяным знаком',
        body: 'На каждой открытой странице стоят ваш кошелёк и номер лицензии — утёкшая копия указывает на источник.',
      },
    },

    error: {
      title: 'Архив не загрузился',
    },
    missing: {
      title: 'Этот архив недоступен',
      body: 'Его либо сняли с публикации, либо ссылка неверна.',
    },
  },

  metrics: {
    views: 'просмотры',
    downloads: 'скачивания',
    unlocks: 'открытия',
    size: 'вес',
  },

  units: {
    files: (count: number) => plural(count, { one: 'файл', few: 'файла', other: 'файлов' }),
    views: (count: number) => plural(count, { one: 'просмотр', few: 'просмотра', other: 'просмотров' }),
    downloads: (count: number) =>
      plural(count, { one: 'скачивание', few: 'скачивания', other: 'скачиваний' }),
    unlocks: (count: number) =>
      plural(count, { one: 'открытие', few: 'открытия', other: 'открытий' }),
  },

  status: {
    technical: {
      draft: 'Черновик',
      uploading: 'Загрузка',
      processing: 'Обработка',
      ready: 'Готов',
      failed: 'Ошибка',
    },
    marketplace: {
      draft: 'Черновик',
      published: 'Опубликован',
      unpublished: 'Снят с публикации',
      blocked: 'Заблокирован',
    },
  },

  economics: {
    title: 'Как делится цена',
    buyerPays: 'Покупатель платит',
    creator: 'Автору',
    platform: 'Комиссия SolArch',
    networkFees:
      'Сетевые комиссии Solana платит SolArch. Покупатель платит только цену архива и ничего сверх неё.',
    immutable: 'Цена фиксируется при создании архива и потом не меняется.',
  },

  auth: {
    title: 'Вход по кошельку',
    lead: 'В SolArch нет паролей. Вы подписываете короткое сообщение, и эта подпись доказывает, что кошелёк ваш. Она ничего не переводит и не даёт SolArch права тратить ваши средства.',
    keyNote: 'Приватный ключ остаётся внутри кошелька. Сообщение, которое вы подписываете, показано здесь целиком — до того, как кошелёк его запросит.',

    choose: 'Выберите кошелёк',
    connecting: (wallet: string) => `Ждём подключения ${wallet}`,

    message: {
      title: 'Что вы подписываете',
      hint: 'Прочитайте перед подписью. SolArch никогда не просит подписать то, чего вы не видите.',
      wallet: 'Кошелёк',
      sign: 'Подписать сообщение',
      signing: (wallet: string) => `Ждём подпись в ${wallet}`,
      verifying: 'Проверяем подпись',
      back: 'Выбрать другой кошелёк',
    },

    declined: (wallet: string) =>
      `${wallet} не подписал сообщение. Ничего не отправлено — можно подписать снова.`,
    failed: 'Кошелёк не ответил. Попробуйте снова или выберите другой.',
    verifyFailed: 'SolArch не смог проверить эту подпись. Запросите новое сообщение и подпишите его заново.',
    serverFailed: 'SolArch не ответил. Попробуйте ещё раз через минуту.',

    noWallets: {
      title: 'В этом браузере нет кошелька Solana',
      body: 'SolArch работает с любым кошельком по стандарту Solana Wallet Standard — чаще всего это Phantom или Solflare. Установите один из них и вернитесь на эту страницу.',
      reload: 'Установил, проверить снова',
    },

    session: {
      account: 'Ваш кошелёк',
      signOut: 'Выйти',
    },
  },

  dashboard: {
    title: 'Ваши архивы',
    lead: 'Каждый созданный архив появляется здесь со своим статусом, ценой и метриками.',
    signedInAs: 'Вы вошли как',
  },

  common: {
    retry: 'Попробовать снова',
    notFound: {
      title: 'Такой страницы нет',
      back: 'Вернуться в каталог',
    },
  },
}
