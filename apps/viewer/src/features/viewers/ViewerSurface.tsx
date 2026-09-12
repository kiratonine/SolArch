import { AlertTriangle, LoaderCircle, RotateCcw, X } from "lucide-react";
import { type PropsWithChildren, type ReactNode } from "react";

import { useI18n } from "../../i18n";
import { type ProtectedFile, type WatermarkDescriptor } from "../../ipc";
import { WatermarkOverlay } from "./WatermarkOverlay";

export function ViewerSurface({
  file,
  watermark,
  controls,
  children,
  onClose,
}: PropsWithChildren<{
  file: ProtectedFile;
  watermark: WatermarkDescriptor;
  controls?: ReactNode;
  onClose: () => void;
}>) {
  const { t } = useI18n();
  return (
    <section
      className="viewer-surface"
      aria-label={file.displayName}
      data-protected-viewer="true"
      onContextMenu={(event) => event.preventDefault()}
      onKeyDownCapture={(event) => {
        const key = event.key.toLowerCase();
        const blockedCommand = event.ctrlKey && (
          key === "p"
          || key === "s"
          || (event.shiftKey && (key === "i" || key === "j" || key === "c"))
        );
        if (blockedCommand || event.key === "F12") event.preventDefault();
      }}
    >
      <header className="viewer-toolbar">
        <div className="viewer-file-name" title={file.displayName}>{file.displayName}</div>
        <div className="viewer-controls">{controls}</div>
        <button className="icon-button" type="button" onClick={onClose} aria-label={t("viewer.close")}>
          <X size={18} aria-hidden="true" />
        </button>
      </header>
      <div className="viewer-stage">
        {children}
        <WatermarkOverlay watermark={watermark} />
      </div>
      <footer className="viewer-policy">{t("viewer.noExport")}</footer>
    </section>
  );
}

export function ViewerLoading() {
  const { t } = useI18n();
  return (
    <div className="viewer-message" role="status">
      <LoaderCircle className="spinner" size={22} aria-hidden="true" />
      <span>{t("viewer.loading")}</span>
    </div>
  );
}

export function ViewerFailure({ message, onRetry }: { message: string; onRetry: () => void }) {
  const { t } = useI18n();
  return (
    <div className="viewer-message viewer-message-error" role="alert">
      <AlertTriangle size={22} aria-hidden="true" />
      <span>{message}</span>
      <button className="secondary-button" type="button" onClick={onRetry}>
        <RotateCcw size={15} aria-hidden="true" />
        {t("viewer.retry")}
      </button>
    </div>
  );
}
