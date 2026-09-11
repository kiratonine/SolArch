import { CheckCircle2, LoaderCircle } from "lucide-react";
import { QRCodeSVG } from "qrcode.react";

import { type Locale, type MessageKey, useI18n } from "../../i18n";
import { type PaymentView, type ViewerState } from "../../ipc";

export function PaymentPanel({ payment, state }: { payment: PaymentView; state: ViewerState }) {
  const { locale, t } = useI18n();
  const activating = state === "activating";
  const tone = activating ? "success" : state === "payment_ready" ? "neutral" : "warning";

  return (
    <aside className="payment-pane">
      {activating ? (
        <div className="payment-confirmed" role="status">
          <CheckCircle2 size={32} aria-hidden="true" />
          <strong>{t("payment.confirmedDetail")}</strong>
        </div>
      ) : (
        <div className="qr-frame" data-qr-value={payment.solanaPayUrl}>
          <QRCodeSVG value={payment.solanaPayUrl} size={184} level="M" title={t("payment.qrLabel")} />
        </div>
      )}
      <dl className="payment-facts">
        <Fact label={t("payment.amount")} value={`${payment.amount} ${payment.currency}`} mono />
        <Fact label={t("payment.network")} value={t("payment.networkValue")} />
        <div>
          <dt>{t("payment.status")}</dt>
          <dd><span className={`status-chip status-${tone}`}>{t(`states.${state}` as MessageKey)}</span></dd>
        </div>
      </dl>
      <p className="payment-detail">
        {activating
          ? t("progress.wait")
          : state === "awaiting_finality"
            ? t("payment.awaitingDetail")
            : t("payment.scan")}
      </p>
      <p className="expiry-row">
        <span>{t("payment.expires")}</span>
        <time dateTime={payment.expiresAt}>{formatExpiry(payment.expiresAt, locale)}</time>
      </p>
      {activating ? <LoaderCircle className="spinner activation-spinner" size={18} aria-hidden="true" /> : null}
    </aside>
  );
}

function Fact({ label, value, mono = false }: { label: string; value: string; mono?: boolean }) {
  return <div><dt>{label}</dt><dd className={mono ? "mono" : undefined}>{value}</dd></div>;
}

function formatExpiry(value: string, locale: Locale): string {
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return value;
  return new Intl.DateTimeFormat(locale === "ru" ? "ru-RU" : "en-US", {
    dateStyle: "medium",
    timeStyle: "short",
  }).format(date);
}
