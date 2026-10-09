import { LockKeyhole } from "lucide-react";

import { useViewerController } from "./app/useViewerController";
import { AppChrome } from "./components/AppChrome";
import { OperationSurface } from "./components/OperationSurface";
import { WindowTitleBar } from "./components/WindowTitleBar";
import {
  EmptyWorkspace,
  FailureSurface,
  LockedWorkspace,
} from "./features/archive/ArchiveWorkspace";
import { UnlockedWorkspace } from "./features/files/UnlockedWorkspace";
import { PaymentWorkspace } from "./features/payment/PaymentWorkspace";
import { useI18n } from "./i18n";
import { type ViewerState } from "./ipc";

const OPERATION_STATES: ViewerState[] = [
  "opening",
  "checking_metadata",
  "payment_preparing",
  "refreshing",
];

const PAYMENT_STATES: ViewerState[] = [
  "payment_ready",
  "payment_pending",
  "awaiting_finality",
  "activating",
];

const FAILURE_STATES: ViewerState[] = [
  "backend_unavailable",
  "refresh_required",
  "payment_expired",
  "payment_failed",
  "device_limit_reached",
  "license_revoked",
  "archive_blocked",
  "error",
];

const TRANSACTION_STATES: ViewerState[] = [
  "locked",
  ...PAYMENT_STATES,
  "payment_expired",
];

export default function App() {
  const { t } = useI18n();
  const viewer = useViewerController();
  const { screen } = viewer;
  const busy = viewer.busy;

  return (
    <div className="app-shell" data-viewer-state={screen.state}>
      <WindowTitleBar />
      <AppChrome
        archiveTitle={screen.archive?.title ?? null}
        deviceStatus={viewer.deviceStatus}
        onOpen={viewer.chooseArchive}
      />
      <main
        className={`workspace${TRANSACTION_STATES.includes(screen.state) ? " workspace-transaction" : ""}`}
        aria-busy={busy}
        tabIndex={screen.state === "unlocked" ? undefined : 0}
      >
        {screen.state === "idle" ? <EmptyWorkspace onOpen={viewer.chooseArchive} /> : null}
        {OPERATION_STATES.includes(screen.state) ? <OperationSurface state={screen.state} /> : null}
        {screen.state === "locked" && screen.archive ? (
          <LockedWorkspace
            archive={screen.archive}
            onPay={viewer.beginPayment}
            onClose={viewer.clearArchive}
          />
        ) : null}
        {PAYMENT_STATES.includes(screen.state) && screen.archive && screen.payment ? (
          <PaymentWorkspace
            archive={screen.archive}
            payment={screen.payment}
            state={screen.state}
            onClose={viewer.clearArchive}
          />
        ) : null}
        {screen.state === "unlocked" && screen.archive && screen.watermark ? (
          <UnlockedWorkspace
            archive={screen.archive}
            files={screen.files}
            watermark={screen.watermark}
            onClose={viewer.clearArchive}
          />
        ) : null}
        {FAILURE_STATES.includes(screen.state) ? (
          <FailureSurface
            state={screen.state}
            messageKey={screen.messageKey}
            canRetry={screen.state === "backend_unavailable" || screen.state === "refresh_required"}
            onRetry={viewer.retryNetwork}
            onReturnToLocked={viewer.returnToLocked}
            onClose={viewer.clearArchive}
          />
        ) : null}
      </main>
      <footer className="security-footer">
        <LockKeyhole size={14} aria-hidden="true" />
        <span>{screen.state === "unlocked" ? t("app.securityUnlocked") : t("app.securityBoundary")}</span>
      </footer>
    </div>
  );
}
