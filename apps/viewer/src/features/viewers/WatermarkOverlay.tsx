import { useI18n } from "../../i18n";
import { type WatermarkDescriptor } from "../../ipc";

export function WatermarkOverlay({ watermark }: { watermark: WatermarkDescriptor }) {
  const { t } = useI18n();
  const text = `${t("watermark.wallet")} ${watermark.buyerWalletShort} · ${t("watermark.license")} ${watermark.licenseIdShort} · ${t("watermark.archive")} ${watermark.archiveIdShort}`;

  return (
    <div className="watermark-overlay" aria-label={text} data-testid="watermark-overlay">
      {Array.from({ length: 12 }, (_, index) => (
        <span key={index} aria-hidden="true">{text}</span>
      ))}
    </div>
  );
}
