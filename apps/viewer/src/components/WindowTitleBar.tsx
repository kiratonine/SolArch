import { Archive, Copy, Maximize2, Minus, X } from "lucide-react";
import { useCallback, useEffect, useMemo, useState } from "react";
import { getCurrentWindow } from "@tauri-apps/api/window";

import { useI18n } from "../i18n";

export function WindowTitleBar() {
  const { t } = useI18n();
  const appWindow = useMemo(() => getCurrentWindow(), []);
  const [maximized, setMaximized] = useState(false);

  const refreshMaximized = useCallback(() => {
    void appWindow.isMaximized().then(setMaximized).catch(() => undefined);
  }, [appWindow]);

  useEffect(() => {
    let active = true;
    let unlisten: (() => void) | undefined;
    void appWindow.isMaximized().then((value) => {
      if (active) setMaximized(value);
    }).catch(() => undefined);
    void appWindow.onResized(() => {
      if (active) refreshMaximized();
    }).then((cleanup) => {
      if (active) unlisten = cleanup;
      else cleanup();
    }).catch(() => undefined);
    return () => {
      active = false;
      unlisten?.();
    };
  }, [appWindow, refreshMaximized]);

  const toggleMaximize = useCallback(() => {
    void appWindow.toggleMaximize().then(refreshMaximized).catch(() => undefined);
  }, [appWindow, refreshMaximized]);

  return (
    <header className="window-titlebar" aria-label={t("window.titlebar")}>
      <div className="window-titlebar-brand" data-tauri-drag-region>
        <Archive size={15} aria-hidden="true" data-tauri-drag-region />
        <span data-tauri-drag-region>{t("app.name")}</span>
      </div>
      <div
        className="window-titlebar-drag"
        data-tauri-drag-region
      />
      <div className="window-controls">
        <button
          type="button"
          aria-label={t("window.minimize")}
          onClick={() => { void appWindow.minimize().catch(() => undefined); }}
        >
          <Minus size={15} aria-hidden="true" />
        </button>
        <button
          type="button"
          aria-label={maximized ? t("window.restore") : t("window.maximize")}
          onClick={toggleMaximize}
        >
          {maximized
            ? <Copy size={13} aria-hidden="true" />
            : <Maximize2 size={13} aria-hidden="true" />}
        </button>
        <button
          className="window-close-button"
          type="button"
          aria-label={t("window.close")}
          onClick={() => { void appWindow.close().catch(() => undefined); }}
        >
          <X size={16} aria-hidden="true" />
        </button>
      </div>
    </header>
  );
}
