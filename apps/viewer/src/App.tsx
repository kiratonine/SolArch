import { open } from "@tauri-apps/plugin-dialog";
import {
  Archive,
  CheckCircle2,
  ChevronRight,
  FileLock2,
  FolderOpen,
  KeyRound,
  LockKeyhole,
  ShieldAlert,
  X,
} from "lucide-react";
import { useEffect, useState } from "react";

import { type MessageKey, useI18n } from "./i18n";
import {
  closeArchive,
  errorMessageKey,
  getDevicePublicKey,
  type VerifiedArchive,
  verifyArchive,
} from "./ipc";

type ViewState =
  | { kind: "idle" }
  | { kind: "loading" }
  | { kind: "locked"; archive: VerifiedArchive }
  | { kind: "error"; messageKey: MessageKey | null };

function compact(value: string, edge = 8): string {
  if (value.length <= edge * 2 + 1) return value;
  return `${value.slice(0, edge)}…${value.slice(-edge)}`;
}

export default function App() {
  const { locale, setLocale, t } = useI18n();
  const [view, setView] = useState<ViewState>({ kind: "idle" });
  const [deviceKey, setDeviceKey] = useState<string | null>(null);
  const [deviceFailed, setDeviceFailed] = useState(false);

  useEffect(() => {
    let active = true;
    void getDevicePublicKey()
      .then((key) => active && setDeviceKey(key))
      .catch(() => active && setDeviceFailed(true));
    return () => {
      active = false;
    };
  }, []);

  async function chooseArchive() {
    try {
      const selected = await open({
        multiple: false,
        directory: false,
        filters: [{ name: "SolArch", extensions: ["slr"] }],
      });
      if (typeof selected !== "string") return;
      setView({ kind: "loading" });
      const archive = await verifyArchive(selected);
      setView({ kind: "locked", archive });
    } catch (error) {
      const key = errorMessageKey(error);
      setView({
        kind: "error",
        messageKey: key && key in enMessageKeys ? (key as MessageKey) : null,
      });
    }
  }

  async function clearArchive() {
    try {
      await closeArchive();
    } finally {
      setView({ kind: "idle" });
    }
  }

  return (
    <div className="app-shell">
      <header className="topbar">
        <div className="brand" aria-label={t("app.name")}>
          <span className="brand-mark" aria-hidden="true"><Archive size={20} /></span>
          <span>{t("app.name")}</span>
        </div>
        <div className="topbar-actions">
          <div className="device-pill" aria-live="polite">
            <KeyRound size={15} aria-hidden="true" />
            <span>{t("device.label")}</span>
            <code>{deviceFailed ? t("device.unavailable") : deviceKey ? compact(deviceKey, 5) : t("device.loading")}</code>
          </div>
          <div className="locale-switcher" aria-label={t("language.label")}>
            <button type="button" aria-pressed={locale === "ru"} onClick={() => setLocale("ru")}>{t("language.ru")}</button>
            <button type="button" aria-pressed={locale === "en"} onClick={() => setLocale("en")}>{t("language.en")}</button>
          </div>
        </div>
      </header>

      <main className="workspace" aria-busy={view.kind === "loading"}>
        {view.kind === "idle" && <IdleState onOpen={chooseArchive} />}
        {view.kind === "loading" && <LoadingState />}
        {view.kind === "locked" && (
          <LockedState archive={view.archive} onClose={clearArchive} onOpen={chooseArchive} />
        )}
        {view.kind === "error" && <ErrorState messageKey={view.messageKey} onRetry={chooseArchive} />}
      </main>

      <footer className="security-footer">
        <LockKeyhole size={15} aria-hidden="true" />
        <span>{t("app.securityBoundary")}</span>
      </footer>
    </div>
  );
}

const enMessageKeys: Record<string, true> = {
  "errors.invalidInput": true,
  "errors.untrustedArchive": true,
  "errors.invalidArchive": true,
  "errors.secureStoreUnavailable": true,
  "errors.corruptSecureStore": true,
  "errors.licenseStorage": true,
  "errors.invalidLicense": true,
  "errors.wrongDevice": true,
  "errors.expired": true,
  "errors.refreshRequired": true,
  "errors.internal": true,
};

function IdleState({ onOpen }: { onOpen: () => void }) {
  const { t } = useI18n();
  return (
    <section className="empty-state">
      <div className="hero-icon" aria-hidden="true"><FileLock2 size={34} /></div>
      <p className="eyebrow">{t("idle.eyebrow")}</p>
      <h1>{t("idle.title")}</h1>
      <p className="lede">{t("idle.description")}</p>
      <button className="primary-button" type="button" onClick={onOpen}>
        <FolderOpen size={18} aria-hidden="true" />
        {t("idle.open")}
        <ChevronRight size={17} aria-hidden="true" />
      </button>
    </section>
  );
}

function LoadingState() {
  const { t } = useI18n();
  return (
    <section className="loading-card" role="status">
      <div className="scan-icon" aria-hidden="true"><ShieldAlert size={28} /></div>
      <div>
        <h1>{t("loading.title")}</h1>
        <p>{t("loading.description")}</p>
      </div>
      <div className="progress-track" aria-hidden="true"><span /></div>
      <div className="skeleton-grid" aria-hidden="true">
        <i /><i /><i /><i />
      </div>
    </section>
  );
}

function LockedState({ archive, onClose, onOpen }: { archive: VerifiedArchive; onClose: () => void; onOpen: () => void }) {
  const { t } = useI18n();
  return (
    <article className="archive-card">
      <div className="archive-heading">
        <div className="locked-emblem" aria-hidden="true"><LockKeyhole size={27} /></div>
        <div className="archive-title-block">
          <div className="status-row">
            <span className="locked-badge">{t("locked.status")}</span>
            <span className="verified-label"><CheckCircle2 size={15} aria-hidden="true" />{t("locked.verified")}</span>
          </div>
          <h1>{archive.title}</h1>
          <p>{t("locked.description")}</p>
        </div>
        <button className="icon-button" type="button" aria-label={t("locked.close")} onClick={onClose}><X size={20} aria-hidden="true" /></button>
      </div>

      <dl className="metadata-grid">
        <Metadata label={t("locked.price")} value={`${archive.priceAmount} ${archive.priceCurrency}`} accent />
        <Metadata label={t("locked.archiveId")} value={archive.archiveId} />
        <Metadata label={t("locked.creator")} value={archive.creatorWallet} mono />
        <Metadata label={t("locked.policy")} value={t("locked.policyValue")} />
      </dl>

      <div className="fingerprint-panel">
        <span>{t("locked.fingerprint")}</span>
        <code>{archive.fingerprint}</code>
      </div>

      <div className="archive-actions">
        <button className="secondary-button" type="button" onClick={onClose}>{t("locked.close")}</button>
        <button className="primary-button" type="button" onClick={onOpen}><FolderOpen size={18} aria-hidden="true" />{t("locked.openAnother")}</button>
      </div>
    </article>
  );
}

function Metadata({ label, value, mono = false, accent = false }: { label: string; value: string; mono?: boolean; accent?: boolean }) {
  return <div><dt>{label}</dt><dd className={`${mono ? "mono" : ""} ${accent ? "accent" : ""}`}>{value}</dd></div>;
}

function ErrorState({ messageKey, onRetry }: { messageKey: MessageKey | null; onRetry: () => void }) {
  const { t } = useI18n();
  return (
    <section className="error-card" role="alert">
      <div className="error-icon" aria-hidden="true"><ShieldAlert size={30} /></div>
      <div>
        <h1>{t("error.title")}</h1>
        <p>{messageKey ? t(messageKey) : t("error.description")}</p>
      </div>
      <button className="secondary-button" type="button" onClick={onRetry}><FolderOpen size={18} aria-hidden="true" />{t("error.retry")}</button>
    </section>
  );
}
