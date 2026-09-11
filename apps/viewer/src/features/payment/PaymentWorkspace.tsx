import { type MessageKey, useI18n } from "../../i18n";
import { type PaymentView, type VerifiedArchive, type ViewerState } from "../../ipc";
import { ArchiveDetails, ArchiveFrame } from "../archive/ArchiveWorkspace";
import { PaymentPanel } from "./PaymentPanel";

export function PaymentWorkspace({ archive, payment, state, onClose }: {
  archive: VerifiedArchive;
  payment: PaymentView;
  state: ViewerState;
  onClose: () => void;
}) {
  const { t } = useI18n();
  const tone = state === "activating" ? "success" : state === "payment_ready" ? "neutral" : "warning";
  return (
    <ArchiveFrame
      archive={archive}
      status={t(`states.${state}` as MessageKey)}
      statusTone={tone}
      onClose={onClose}
    >
      <div className="archive-layout">
        <ArchiveDetails archive={archive} />
        <PaymentPanel payment={payment} state={state} />
      </div>
    </ArchiveFrame>
  );
}
