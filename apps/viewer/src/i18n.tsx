import {
  createContext,
  type PropsWithChildren,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useState,
} from "react";

export const LOCALE_STORAGE_KEY = "solarch.viewer.locale";

export const en = {
  "app.name": "SolArch Viewer",
  "app.securityBoundary": "Verified locally. Access remains locked.",
  "language.label": "Interface language",
  "language.en": "English",
  "language.ru": "Русский",
  "device.label": "Device A",
  "device.loading": "Preparing protected device identity…",
  "device.unavailable": "Device identity is unavailable",
  "idle.eyebrow": "Protected archive viewer",
  "idle.title": "Open a SolArch archive",
  "idle.description": "Choose a .slr file. Its signature and fingerprint are verified in Rust before any metadata appears.",
  "idle.open": "Open .slr",
  "loading.title": "Verifying archive",
  "loading.description": "Checking structure, trusted signature, and final fingerprint…",
  "locked.status": "Locked",
  "locked.verified": "Archive signature verified",
  "locked.description": "The archive is authentic. Payment and protected viewing are intentionally unavailable in this build.",
  "locked.price": "Price",
  "locked.creator": "Creator wallet",
  "locked.archiveId": "Archive ID",
  "locked.policy": "Access policy",
  "locked.policyValue": "1 device · export disabled · watermark required",
  "locked.fingerprint": "Verified fingerprint",
  "locked.close": "Close archive",
  "locked.openAnother": "Open another archive",
  "error.title": "Archive could not be opened",
  "error.description": "The file may be malformed, modified, or signed by an untrusted key.",
  "error.retry": "Choose another file",
  "errors.invalidInput": "Choose a valid .slr file.",
  "errors.untrustedArchive": "This archive signing key is not trusted by this Viewer build.",
  "errors.invalidArchive": "Archive verification failed. The file was not opened.",
  "errors.secureStoreUnavailable": "Windows secure storage is unavailable.",
  "errors.corruptSecureStore": "Stored device identity is malformed. It was not replaced.",
  "errors.licenseStorage": "Local signed-license storage is unavailable.",
  "errors.invalidLicense": "The signed device license is invalid.",
  "errors.wrongDevice": "This license belongs to another device.",
  "errors.expired": "The local license window has ended.",
  "errors.refreshRequired": "Online license refresh is required.",
  "errors.internal": "The Viewer could not complete the operation.",
} as const;

export type MessageKey = keyof typeof en;
export type Locale = "en" | "ru";

export const ru: Record<MessageKey, string> = {
  "app.name": "SolArch Viewer",
  "app.securityBoundary": "Проверено локально. Доступ остаётся заблокирован.",
  "language.label": "Язык интерфейса",
  "language.en": "English",
  "language.ru": "Русский",
  "device.label": "Устройство A",
  "device.loading": "Подготавливается защищённая идентификация устройства…",
  "device.unavailable": "Идентификация устройства недоступна",
  "idle.eyebrow": "Просмотр защищённых архивов",
  "idle.title": "Откройте архив SolArch",
  "idle.description": "Выберите файл .slr. Rust проверит подпись и fingerprint до показа любых метаданных.",
  "idle.open": "Открыть .slr",
  "loading.title": "Проверка архива",
  "loading.description": "Проверяются структура, доверенная подпись и итоговый fingerprint…",
  "locked.status": "Заблокирован",
  "locked.verified": "Подпись архива проверена",
  "locked.description": "Архив подлинный. Оплата и защищённый просмотр намеренно недоступны в этой сборке.",
  "locked.price": "Цена",
  "locked.creator": "Кошелёк автора",
  "locked.archiveId": "ID архива",
  "locked.policy": "Политика доступа",
  "locked.policyValue": "1 устройство · экспорт отключён · watermark обязателен",
  "locked.fingerprint": "Проверенный fingerprint",
  "locked.close": "Закрыть архив",
  "locked.openAnother": "Открыть другой архив",
  "error.title": "Не удалось открыть архив",
  "error.description": "Файл может быть повреждён, изменён или подписан недоверенным ключом.",
  "error.retry": "Выбрать другой файл",
  "errors.invalidInput": "Выберите корректный файл .slr.",
  "errors.untrustedArchive": "Ключ подписи архива не доверен этой сборкой Viewer.",
  "errors.invalidArchive": "Проверка архива не пройдена. Файл не открыт.",
  "errors.secureStoreUnavailable": "Защищённое хранилище Windows недоступно.",
  "errors.corruptSecureStore": "Сохранённая идентификация устройства повреждена и не была заменена.",
  "errors.licenseStorage": "Локальное хранилище подписанной лицензии недоступно.",
  "errors.invalidLicense": "Подписанная лицензия устройства недействительна.",
  "errors.wrongDevice": "Лицензия принадлежит другому устройству.",
  "errors.expired": "Срок локального действия лицензии завершён.",
  "errors.refreshRequired": "Требуется обновить лицензию онлайн.",
  "errors.internal": "Viewer не смог завершить операцию.",
};

const resources: Record<Locale, Record<MessageKey, string>> = { en, ru };

type I18nContextValue = {
  locale: Locale;
  setLocale: (locale: Locale) => void;
  t: (key: MessageKey) => string;
};

const I18nContext = createContext<I18nContextValue | null>(null);

export function resolveInitialLocale(
  stored: string | null,
  installerLocale: string | null,
  systemLocale: string,
): Locale {
  for (const candidate of [stored, installerLocale, systemLocale]) {
    if (candidate?.toLowerCase().startsWith("ru")) return "ru";
    if (candidate?.toLowerCase().startsWith("en")) return "en";
  }
  return "en";
}

export function I18nProvider({ children }: PropsWithChildren) {
  const [locale, updateLocale] = useState<Locale>(() =>
    resolveInitialLocale(
      localStorage.getItem(LOCALE_STORAGE_KEY),
      document.documentElement.dataset.installerLocale ?? null,
      navigator.language,
    ),
  );

  const setLocale = useCallback((next: Locale) => {
    localStorage.setItem(LOCALE_STORAGE_KEY, next);
    updateLocale(next);
  }, []);

  useEffect(() => {
    document.documentElement.lang = locale;
  }, [locale]);

  const value = useMemo<I18nContextValue>(
    () => ({ locale, setLocale, t: (key) => resources[locale][key] }),
    [locale, setLocale],
  );
  return <I18nContext.Provider value={value}>{children}</I18nContext.Provider>;
}

export function useI18n(): I18nContextValue {
  const context = useContext(I18nContext);
  if (!context) throw new Error("I18nProvider is required");
  return context;
}
