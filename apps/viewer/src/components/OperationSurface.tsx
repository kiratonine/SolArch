import { LoaderCircle } from "lucide-react";

import { type MessageKey, useI18n } from "../i18n";
import { type ViewerState } from "../ipc";

export function OperationSurface({ state }: { state: ViewerState }) {
  const { t } = useI18n();
  const key: MessageKey = state === "payment_preparing"
    ? "progress.payment"
    : state === "refreshing"
      ? "progress.refreshing"
      : "loading.title";
  const detail = state === "opening" || state === "checking_metadata"
    ? t("loading.description")
    : t("progress.wait");

  return (
    <section className="operation-surface" role="status">
      <LoaderCircle className="spinner" size={22} aria-hidden="true" />
      <div>
        <h1>{t(key)}</h1>
        <p>{detail}</p>
      </div>
    </section>
  );
}
