import {
  CheckCircle2,
  FileLock2,
  FolderOpen,
  LockKeyhole,
  RefreshCw,
  ShieldAlert,
  X,
} from "lucide-react";
import { type ReactNode } from "react";

import { type MessageKey, useI18n } from "../../i18n";
import { type VerifiedArchive, type ViewerState } from "../../ipc";

export function EmptyWorkspace({ onOpen }: { onOpen: () => void }) {
  const { t } = useI18n();
  return (
    <section className="empty-workspace">
      <FileLock2 size={25} aria-hidden="true" />
      <div>
        <h1>{t("idle.title")}</h1>
        <p>{t("idle.description")}</p>
      </div>
      <button className="primary-button" type="button" onClick={onOpen}>
        <FolderOpen size={17} aria-hidden="true" />
        {t("idle.open")}
      </button>
    </section>
  );
}

type ArchiveFrameProps = {
  archive: VerifiedArchive;
  status: string;
  statusTone: "warning" | "success" | "neutral";
  onClose: () => void;
  children: ReactNode;
};

export function ArchiveFrame({ archive, status, statusTone, onClose, children }: ArchiveFrameProps) {
  const { t } = useI18n();
  return (
    <article className="archive-workspace">
      <header className="archive-heading">
        <div className="archive-title-block">
          <div className="status-row">
            <span className={`status-chip status-${statusTone}`}>{status}</span>
            <span className="verified-label">
              <CheckCircle2 size={15} aria-hidden="true" />
              {t("locked.verified")}
            </span>
          </div>
          <h1>{archive.title}</h1>
          <p>{t("locked.description")}</p>
        </div>
        <button className="icon-button" type="button" aria-label={t("locked.close")} onClick={onClose}>
          <X size={18} aria-hidden="true" />
        </button>
      </header>
      {children}
    </article>
  );
}

export function ArchiveDetails({ archive }: { archive: VerifiedArchive }) {
  const { t } = useI18n();
  return (
    <section className="archive-details" aria-label={t("locked.description")}>
      <dl className="metadata-list">
        <Metadata label={t("locked.creator")} value={archive.creatorWallet} mono />
        <Metadata label={t("locked.archiveId")} value={archive.archiveId} mono />
        <Metadata label={t("locked.policy")} value={t("locked.policyValue")} />
      </dl>
      <div className="fingerprint-row">
        <span>{t("locked.fingerprint")}</span>
        <code>{archive.fingerprint}</code>
      </div>
    </section>
  );
}

export function LockedWorkspace({ archive, onPay, onClose }: {
  archive: VerifiedArchive;
  onPay: () => void;
  onClose: () => void;
}) {
  const { t } = useI18n();
  return (
    <ArchiveFrame archive={archive} status={t("locked.status")} statusTone="warning" onClose={onClose}>
      <div className="archive-layout">
        <ArchiveDetails archive={archive} />
        <aside className="action-pane">
          <div className="price-block">
            <span>{t("locked.price")}</span>
            <strong><b>{archive.priceAmount}</b> {archive.priceCurrency}</strong>
          </div>
          <button className="primary-button unlock-button" type="button" onClick={onPay}>
            <LockKeyhole size={17} aria-hidden="true" />
            {t("payment.unlockFor")} {archive.priceAmount} {archive.priceCurrency}
          </button>
          <p className="action-note">{t("locked.unlockNote")}</p>
        </aside>
      </div>
    </ArchiveFrame>
  );
}

export function FailureSurface({ state, messageKey, canRetry, onRetry, onClose }: {
  state: ViewerState;
  messageKey: MessageKey | null;
  canRetry: boolean;
  onRetry: () => void;
  onClose: () => void;
}) {
  const { t } = useI18n();
  return (
    <section className="failure-surface" role="alert">
      <ShieldAlert size={22} aria-hidden="true" />
      <div className="failure-copy">
        <h1>{t(`states.${state}` as MessageKey)}</h1>
        <p>{messageKey ? t(messageKey) : t("error.description")}</p>
      </div>
      <div className="failure-actions">
        {canRetry ? (
          <button className="primary-button" type="button" onClick={onRetry}>
            <RefreshCw size={16} aria-hidden="true" />
            {t("error.retryNetwork")}
          </button>
        ) : null}
        <button className="secondary-button" type="button" onClick={onClose}>{t("locked.close")}</button>
      </div>
    </section>
  );
}

function Metadata({ label, value, mono = false }: { label: string; value: string; mono?: boolean }) {
  return (
    <div>
      <dt>{label}</dt>
      <dd className={mono ? "mono" : undefined}>{value}</dd>
    </div>
  );
}
