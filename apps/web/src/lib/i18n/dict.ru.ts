import type { Dictionary } from './dict.en'
import { makePlural } from './plural'

const plural = makePlural('ru')

/**
 * Русский словарь. Тип `Dictionary` заимствован у английского:
 * пропущенный или лишний ключ — ошибка компиляции, а не пустое место на экране.
 */
export const ru: Dictionary = {
  localeName: 'Русский',

  brand: {
    tagline: 'Запечатанные файлы, открытый каталог',
  },

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
    mechanic:
      'Файл .slr скачивается бесплатно и пересылается как любой другой. Открывает его оплата в USDC внутри SolArch Viewer.',
    fee: 'Автор получает 95% с каждой продажи.',
  },

  catalog: {
    title: 'Каталог',
    lead: 'Любой архив можно забрать без регистрации. Оплата происходит позже, в десктопном Viewer, когда файл уже у вас.',
    loading: 'Загружаем каталог',

    steps: [
      {
        title: 'Заберите файл',
        body: 'Любой .slr уходит из каталога бесплатно и без регистрации. Храните, копируйте, пересылайте.',
      },
      {
        title: 'Откройте его в Viewer',
        body: 'Контейнер остаётся запечатанным, пока десктопный SolArch Viewer не откроет его на вашем компьютере.',
      },
      {
        title: 'Заплатите один раз в USDC',
        body: 'Одна оплата открывает архив на одном устройстве. Автору из неё уходит 95%.',
      },
    ],

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
      placeholder: 'Название или описание',
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
    openedIn: 'Открывается в SolArch Viewer после оплаты',
    loading: 'Загружаем архив',
    about: 'Об архиве',
    back: 'Вернуться в каталог',
    error: {
      title: 'Архив не загрузился',
    },
    missing: {
      title: 'Этот архив недоступен',
      body: 'Его либо сняли с публикации, либо ссылка неверна.',
    },
  },

  metrics: {
    views: 'Просмотры',
    downloads: 'Скачивания',
    unlocks: 'Открытия',
    files: 'Файлы',
    size: 'вес',
  },

  units: {
    files: (count: number) => plural(count, { one: 'файл', few: 'файла', other: 'файлов' }),
    archives: (count: number) => plural(count, { one: 'архив', few: 'архива', other: 'архивов' }),
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

  common: {
    retry: 'Попробовать снова',
    notFound: {
      title: 'Такой страницы нет',
      back: 'Вернуться в каталог',
    },
  },
}
