import {
  createContext,
  type PropsWithChildren,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useState,
} from "react";

import { getInstallerLocale } from "./ipc";

export const LOCALE_STORAGE_KEY = "solarch.viewer.locale";

export const en = {
  "app.name": "SolArch Viewer",
  "app.securityBoundary": "Verified locally. Access remains locked.",
  "app.securityUnlocked": "Protected access is authorized locally. Export remains disabled.",
  "app.openArchive": "Open archive",
  "language.label": "Interface language",
  "language.en": "EN",
  "language.ru": "RU",
  "device.label": "Device A",
  "device.ready": "Device secured",
  "device.loading": "Securing device…",
  "device.unavailable": "Device identity is unavailable",
  "idle.eyebrow": "Protected archive viewer",
  "idle.title": "Open a .slr archive",
  "idle.description": "Choose an archive here, or double-click a .slr file in Windows Explorer. SolArch verifies it before showing metadata.",
  "idle.open": "Open archive",
  "loading.title": "Verifying archive",
  "loading.description": "Checking the archive locally…",
  "locked.status": "Locked",
  "locked.verified": "Archive signature verified",
  "locked.description": "Signature and fingerprint verified locally.",
  "locked.price": "Price",
  "locked.creator": "Creator wallet",
  "locked.archiveId": "Archive ID",
  "locked.policy": "Access policy",
  "locked.policyValue": "1 device · export disabled",
  "locked.fingerprint": "Verified fingerprint",
  "locked.unlockNote": "Access unlocks only after finalized payment and device-license validation.",
  "locked.close": "Close archive",
  "locked.openAnother": "Open another archive",
  "payment.buy": "Pay with Solana Pay",
  "payment.unlockFor": "Unlock for",
  "payment.solanaPay": "Solana Pay",
  "payment.qrLabel": "Solana Pay payment QR code",
  "payment.scan": "Scan with a compatible wallet. Access remains locked until finalized confirmation.",
  "payment.awaitingDetail": "The transaction was observed and is waiting for Solana finalized commitment. Access is still locked.",
  "payment.expires": "Transaction request expires:",
  "payment.amount": "Amount",
  "payment.network": "Network",
  "payment.networkValue": "Solana",
  "payment.status": "Status",
  "payment.confirmedDetail": "Payment confirmed. Securing this device license…",
  "progress.payment": "Preparing secure payment",
  "progress.activating": "Activating Device A",
  "progress.refreshing": "Refreshing device license",
  "progress.wait": "Please keep SolArch open.",
  "unlocked.title": "Protected archive unlocked",
  "unlocked.description": "Protected files remain inside SolArch Viewer. Export is disabled.",
  "unlocked.files": "Protected files",
  "files.name": "Name",
  "files.type": "Type",
  "files.size": "Size",
  "files.empty": "This archive has no protected files.",
  "states.locked": "Locked",
  "states.payment_ready": "Ready to pay",
  "states.payment_pending": "Waiting for payment",
  "states.awaiting_finality": "Awaiting finality",
  "states.activating": "Activating",
  "states.unlocked": "Unlocked",
  "states.backend_unavailable": "Backend unavailable",
  "states.refresh_required": "Refresh required",
  "states.payment_expired": "Payment expired",
  "states.payment_failed": "Payment failed",
  "states.device_limit_reached": "Device limit reached",
  "states.license_revoked": "License revoked",
  "states.archive_blocked": "Archive blocked",
  "states.error": "Operation failed",
  "error.title": "Archive could not be opened",
  "error.description": "The file may be malformed, modified, or signed by an untrusted key.",
  "error.retry": "Choose another file",
  "error.retryNetwork": "Retry securely",
  "errors.invalidInput": "Choose a valid .slr file.",
  "errors.untrustedArchive": "This archive signing key is not trusted by this Viewer build.",
  "errors.invalidArchive": "Archive verification failed. The file was not opened.",
  "errors.secureStoreUnavailable": "Windows secure storage is unavailable.",
  "errors.corruptSecureStore": "Stored device identity is malformed. It was not replaced.",
  "errors.licenseStorage": "Local signed-license storage is unavailable.",
  "errors.paymentStorage": "Local non-secret payment state is unavailable.",
  "errors.backendUnavailable": "The Backend cannot be reached. No access decision was weakened.",
  "errors.metadataMismatch": "Backend metadata does not match this verified archive.",
  "errors.missingIntentCredential": "The one-time payment credential is unavailable; this intent cannot be resumed.",
  "errors.missingRefreshCredential": "The device refresh credential is unavailable.",
  "errors.invalidLicense": "The signed device license is invalid.",
  "errors.wrongDevice": "This license belongs to another device.",
  "errors.expired": "The local license window has ended.",
  "errors.refreshRequired": "Online license refresh is required.",
  "errors.paymentExpired": "The payment intent expired.",
  "errors.paymentFailed": "The Backend marked this payment attempt as failed.",
  "errors.deviceLimitReached": "The single-device limit was reached.",
  "errors.licenseRevoked": "This device license or entitlement was revoked.",
  "errors.archiveBlocked": "This archive is not available for activation or refresh.",
  "errors.internal": "The Viewer could not complete the operation.",
} as const;

export type MessageKey = keyof typeof en;
export type Locale = "en" | "ru";

export const ru: Record<MessageKey, string> = {
  "app.name": "SolArch Viewer",
  "app.securityBoundary": "Проверено локально. Доступ остаётся заблокирован.",
  "app.securityUnlocked": "Защищённый доступ подтверждён локально. Экспорт остаётся отключён.",
  "app.openArchive": "Открыть архив",
  "language.label": "Язык интерфейса",
  "language.en": "EN",
  "language.ru": "RU",
  "device.label": "Устройство A",
  "device.ready": "Устройство защищено",
  "device.loading": "Защита устройства…",
  "device.unavailable": "Идентификация устройства недоступна",
  "idle.eyebrow": "Просмотр защищённых архивов",
  "idle.title": "Откройте архив .slr",
  "idle.description": "Выберите архив здесь или откройте файл .slr двойным щелчком в Проводнике. SolArch проверит его до показа метаданных.",
  "idle.open": "Открыть архив",
  "loading.title": "Проверка архива",
  "loading.description": "Архив проверяется локально…",
  "locked.status": "Заблокирован",
  "locked.verified": "Подпись архива проверена",
  "locked.description": "Подпись и fingerprint проверены локально.",
  "locked.price": "Цена",
  "locked.creator": "Кошелёк автора",
  "locked.archiveId": "ID архива",
  "locked.policy": "Политика доступа",
  "locked.policyValue": "1 устройство · экспорт отключён",
  "locked.fingerprint": "Проверенный fingerprint",
  "locked.unlockNote": "Доступ откроется только после finalized-оплаты и проверки лицензии устройства.",
  "locked.close": "Закрыть архив",
  "locked.openAnother": "Открыть другой архив",
  "payment.buy": "Оплатить через Solana Pay",
  "payment.unlockFor": "Разблокировать за",
  "payment.solanaPay": "Solana Pay",
  "payment.qrLabel": "QR-код оплаты Solana Pay",
  "payment.scan": "Отсканируйте совместимым кошельком. Доступ останется закрыт до finalized-подтверждения.",
  "payment.awaitingDetail": "Транзакция обнаружена и ожидает Solana finalized. Доступ всё ещё закрыт.",
  "payment.expires": "Срок запроса транзакции:",
  "payment.amount": "Сумма",
  "payment.network": "Сеть",
  "payment.networkValue": "Solana",
  "payment.status": "Статус",
  "payment.confirmedDetail": "Оплата подтверждена. Лицензия устройства защищается…",
  "progress.payment": "Подготовка защищённой оплаты",
  "progress.activating": "Активация устройства A",
  "progress.refreshing": "Обновление лицензии устройства",
  "progress.wait": "Не закрывайте SolArch.",
  "unlocked.title": "Защищённый архив разблокирован",
  "unlocked.description": "Защищённые файлы остаются внутри SolArch Viewer. Экспорт отключён.",
  "unlocked.files": "Защищённые файлы",
  "files.name": "Имя",
  "files.type": "Тип",
  "files.size": "Размер",
  "files.empty": "В архиве нет защищённых файлов.",
  "states.locked": "Заблокирован",
  "states.payment_ready": "Готово к оплате",
  "states.payment_pending": "Ожидание оплаты",
  "states.awaiting_finality": "Ожидание finality",
  "states.activating": "Активация",
  "states.unlocked": "Разблокирован",
  "states.backend_unavailable": "Backend недоступен",
  "states.refresh_required": "Требуется обновление",
  "states.payment_expired": "Срок оплаты истёк",
  "states.payment_failed": "Оплата не прошла",
  "states.device_limit_reached": "Лимит устройств исчерпан",
  "states.license_revoked": "Лицензия отозвана",
  "states.archive_blocked": "Архив заблокирован",
  "states.error": "Операция не выполнена",
  "error.title": "Не удалось открыть архив",
  "error.description": "Файл может быть повреждён, изменён или подписан недоверенным ключом.",
  "error.retry": "Выбрать другой файл",
  "error.retryNetwork": "Повторить безопасно",
  "errors.invalidInput": "Выберите корректный файл .slr.",
  "errors.untrustedArchive": "Ключ подписи архива не доверен этой сборкой Viewer.",
  "errors.invalidArchive": "Проверка архива не пройдена. Файл не открыт.",
  "errors.secureStoreUnavailable": "Защищённое хранилище Windows недоступно.",
  "errors.corruptSecureStore": "Сохранённая идентификация устройства повреждена и не была заменена.",
  "errors.licenseStorage": "Локальное хранилище подписанной лицензии недоступно.",
  "errors.paymentStorage": "Локальное хранилище несекретного состояния оплаты недоступно.",
  "errors.backendUnavailable": "Backend недоступен. Требования к авторизации не были ослаблены.",
  "errors.metadataMismatch": "Метаданные Backend не совпадают с проверенным архивом.",
  "errors.missingIntentCredential": "Одноразовый платёжный credential недоступен; продолжить этот intent нельзя.",
  "errors.missingRefreshCredential": "Credential обновления устройства недоступен.",
  "errors.invalidLicense": "Подписанная лицензия устройства недействительна.",
  "errors.wrongDevice": "Лицензия принадлежит другому устройству.",
  "errors.expired": "Срок локального действия лицензии завершён.",
  "errors.refreshRequired": "Требуется обновить лицензию онлайн.",
  "errors.paymentExpired": "Срок платёжного intent истёк.",
  "errors.paymentFailed": "Backend пометил попытку оплаты как неуспешную.",
  "errors.deviceLimitReached": "Достигнут лимит одного устройства.",
  "errors.licenseRevoked": "Лицензия устройства или entitlement отозваны.",
  "errors.archiveBlocked": "Архив недоступен для активации или обновления.",
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
  const [locale, updateLocale] = useState<Locale | null>(() => readStoredLocale());

  useEffect(() => {
    if (locale !== null) return;
    let active = true;
    void getInstallerLocale()
      .catch(() => null)
      .then((installerLocale) => {
        if (!active) return;
        const initial = resolveInitialLocale(
          null,
          typeof installerLocale === "string" ? installerLocale : null,
          navigator.language,
        );
        writeStoredLocale(initial);
        updateLocale(initial);
      });
    return () => { active = false; };
  }, [locale]);

  const setLocale = useCallback((next: Locale) => {
    writeStoredLocale(next);
    updateLocale(next);
  }, []);

  useEffect(() => {
    if (locale !== null) document.documentElement.lang = locale;
  }, [locale]);

  const value = useMemo<I18nContextValue>(
    () => ({ locale: locale ?? "en", setLocale, t: (key) => resources[locale ?? "en"][key] }),
    [locale, setLocale],
  );
  if (locale === null) return <div className="locale-bootstrap" aria-hidden="true" />;
  return <I18nContext.Provider value={value}>{children}</I18nContext.Provider>;
}

function readStoredLocale(): Locale | null {
  try {
    const stored = localStorage.getItem(LOCALE_STORAGE_KEY);
    return stored === "ru" || stored === "en" ? stored : null;
  } catch {
    return null;
  }
}

function writeStoredLocale(locale: Locale): void {
  try {
    localStorage.setItem(LOCALE_STORAGE_KEY, locale);
  } catch {
    // A blocked preference store must not block the Viewer itself.
  }
}

export function useI18n(): I18nContextValue {
  const context = useContext(I18nContext);
  if (!context) throw new Error("I18nProvider is required");
  return context;
}
