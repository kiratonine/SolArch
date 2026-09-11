import { Archive, FolderOpen, ShieldCheck, ShieldX } from "lucide-react";

import { type Locale, useI18n } from "../i18n";
import { type DeviceStatus } from "../app/useViewerController";

type AppChromeProps = {
  archiveTitle: string | null;
  deviceStatus: DeviceStatus;
  onOpen: () => void;
};

export function AppChrome({ archiveTitle, deviceStatus, onOpen }: AppChromeProps) {
  const { locale, setLocale, t } = useI18n();
  const deviceLabel = deviceStatus === "ready"
    ? t("device.ready")
    : deviceStatus === "unavailable"
      ? t("device.unavailable")
      : t("device.loading");

  return (
    <header className="topbar">
      <div className="brand" aria-label={t("app.name")}>
        <span className="brand-mark" aria-hidden="true"><Archive size={17} /></span>
        <span>{t("app.name")}</span>
      </div>
      <div className="archive-context" title={archiveTitle ?? undefined}>
        {archiveTitle ?? ""}
      </div>
      <div className="topbar-actions">
        {archiveTitle ? (
          <button className="toolbar-button" type="button" onClick={onOpen}>
            <FolderOpen size={16} aria-hidden="true" />
            <span>{t("app.openArchive")}</span>
          </button>
        ) : null}
        <div className={`device-indicator device-${deviceStatus}`} aria-live="polite" title={deviceLabel}>
          {deviceStatus === "unavailable"
            ? <ShieldX size={16} aria-hidden="true" />
            : <ShieldCheck size={16} aria-hidden="true" />}
          <span>{deviceLabel}</span>
        </div>
        <LocaleSwitcher locale={locale} setLocale={setLocale} />
      </div>
    </header>
  );
}

function LocaleSwitcher({ locale, setLocale }: { locale: Locale; setLocale: (locale: Locale) => void }) {
  const { t } = useI18n();
  return (
    <div className="locale-switcher" role="group" aria-label={t("language.label")}>
      <button type="button" aria-pressed={locale === "ru"} onClick={() => setLocale("ru")}>
        {t("language.ru")}
      </button>
      <span aria-hidden="true">|</span>
      <button type="button" aria-pressed={locale === "en"} onClick={() => setLocale("en")}>
        {t("language.en")}
      </button>
    </div>
  );
}
