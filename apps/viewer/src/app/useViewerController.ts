import { open } from "@tauri-apps/plugin-dialog";
import { useCallback, useEffect, useState } from "react";

import { type MessageKey } from "../i18n";
import {
  activatePayment,
  closeArchive,
  errorMessageKey,
  getDevicePublicKey,
  isStartupArchivePending,
  onExternalArchiveOpened,
  onExternalArchiveRequested,
  openArchive,
  pollPayment,
  refreshLicense,
  retryMetadata,
  startPayment,
  takeStartupArchive,
  type ViewerSnapshot,
  type ViewerState,
} from "../ipc";

export type Screen = ViewerSnapshot & { messageKey: MessageKey | null };
export type DeviceStatus = "loading" | "ready" | "unavailable";

const EMPTY_SCREEN: Screen = {
  state: "idle",
  archive: null,
  payment: null,
  files: [],
  messageKey: null,
};

const NETWORK_PAYMENT_STATES: ViewerState[] = [
  "payment_ready",
  "payment_pending",
  "awaiting_finality",
];

const BUSY_STATES: ViewerState[] = [
  "opening",
  "checking_metadata",
  "payment_preparing",
  "activating",
  "refreshing",
];

export function useViewerController() {
  const [screen, setScreen] = useState<Screen>(EMPTY_SCREEN);
  const [deviceStatus, setDeviceStatus] = useState<DeviceStatus>("loading");
  const [pollRetry, setPollRetry] = useState(0);

  const applySnapshot = useCallback((next: ViewerSnapshot) => {
    setScreen((current) => ({
      ...next,
      archive: next.archive ?? current.archive,
      messageKey: null,
    }));
  }, []);

  const applyError = useCallback((error: unknown, clearArchive = false) => {
    const state = stateFromError(error);
    const key = errorMessageKey(error);
    setScreen((current) => ({
      ...(clearArchive ? EMPTY_SCREEN : current),
      state,
      payment: state.startsWith("payment_") ? null : clearArchive ? null : current.payment,
      messageKey: key && key in KNOWN_MESSAGE_KEYS ? key as MessageKey : null,
    }));
  }, []);

  useEffect(() => {
    let active = true;
    void getDevicePublicKey()
      .then(() => active && setDeviceStatus("ready"))
      .catch(() => active && setDeviceStatus("unavailable"));
    return () => { active = false; };
  }, []);

  useEffect(() => {
    let active = true;
    const unlisten: Array<() => void> = [];
    void (async () => {
      try {
        const listeners = await Promise.all([
          onExternalArchiveRequested(() => {
            if (!active) return;
            setPollRetry(0);
            setScreen({ ...EMPTY_SCREEN, state: "opening" });
          }),
          onExternalArchiveOpened((event) => {
            if (!active) return;
            if (event.snapshot) applySnapshot(event.snapshot);
            else if (event.error) applyError(event.error, true);
          }),
        ]);
        if (!active) {
          listeners.forEach((stop) => stop());
          return;
        }
        unlisten.push(...listeners);
      } catch {
        // The desktop event bridge is unavailable in browser-only development.
      }

      try {
        const pending = await isStartupArchivePending();
        if (!active || !pending) return;
        setScreen({ ...EMPTY_SCREEN, state: "opening" });
        const snapshot = await takeStartupArchive();
        if (active && snapshot) applySnapshot(snapshot);
      } catch (error) {
        if (active) applyError(error, true);
      }
    })();

    return () => {
      active = false;
      unlisten.forEach((stop) => stop());
    };
  }, [applyError, applySnapshot]);

  useEffect(() => {
    if (!NETWORK_PAYMENT_STATES.includes(screen.state)) return;
    const timer = window.setTimeout(() => {
      void pollPayment()
        .then((next) => {
          setPollRetry(0);
          applySnapshot(next);
        })
        .catch((error: unknown) => {
          if (stateFromError(error) === "backend_unavailable" && pollRetry < 2) {
            setPollRetry((attempt) => attempt + 1);
          } else {
            setPollRetry(0);
            applyError(error);
          }
        });
    }, (screen.state === "payment_ready" ? 1_800 : 2_600) * 2 ** pollRetry);
    return () => window.clearTimeout(timer);
  }, [applyError, applySnapshot, pollRetry, screen.payment?.paymentIntentId, screen.state]);

  useEffect(() => {
    if (screen.state !== "activating") return;
    let active = true;
    void activatePayment()
      .then((next) => active && applySnapshot(next))
      .catch((error: unknown) => active && applyError(error));
    return () => { active = false; };
  }, [applyError, applySnapshot, screen.state]);

  const chooseArchive = useCallback(async () => {
    try {
      const selected = await open({
        multiple: false,
        directory: false,
        filters: [{ name: "SolArch", extensions: ["slr"] }],
      });
      if (typeof selected !== "string") return;
      setPollRetry(0);
      setScreen({ ...EMPTY_SCREEN, state: "opening" });
      applySnapshot(await openArchive(selected));
    } catch (error) {
      applyError(error, true);
    }
  }, [applyError, applySnapshot]);

  const beginPayment = useCallback(async () => {
    setScreen((current) => ({ ...current, state: "payment_preparing" }));
    try {
      applySnapshot(await startPayment());
    } catch (error) {
      applyError(error);
    }
  }, [applyError, applySnapshot]);

  const retryNetwork = useCallback(async () => {
    try {
      if (screen.payment) applySnapshot(await pollPayment());
      else if (screen.state === "refresh_required") {
        setScreen((current) => ({ ...current, state: "refreshing" }));
        applySnapshot(await refreshLicense());
      } else applySnapshot(await retryMetadata());
    } catch (error) {
      applyError(error);
    }
  }, [applyError, applySnapshot, screen.payment, screen.state]);

  const clearArchive = useCallback(async () => {
    try {
      await closeArchive();
    } finally {
      setPollRetry(0);
      setScreen(EMPTY_SCREEN);
    }
  }, []);

  return {
    screen,
    deviceStatus,
    busy: BUSY_STATES.includes(screen.state),
    chooseArchive,
    beginPayment,
    retryNetwork,
    clearArchive,
  };
}

function stateFromError(error: unknown): ViewerState {
  const code = typeof error === "object" && error !== null && "code" in error
    ? String((error as { code: unknown }).code)
    : "";
  const states: Record<string, ViewerState> = {
    BACKEND_UNAVAILABLE: "backend_unavailable",
    PAYMENT_EXPIRED: "payment_expired",
    PAYMENT_FAILED: "payment_failed",
    DEVICE_LIMIT_REACHED: "device_limit_reached",
    LICENSE_REVOKED: "license_revoked",
    ARCHIVE_BLOCKED: "archive_blocked",
    REFRESH_REQUIRED: "refresh_required",
  };
  return states[code] ?? "error";
}

const KNOWN_MESSAGE_KEYS: Record<string, true> = {
  "errors.invalidInput": true,
  "errors.untrustedArchive": true,
  "errors.invalidArchive": true,
  "errors.secureStoreUnavailable": true,
  "errors.corruptSecureStore": true,
  "errors.licenseStorage": true,
  "errors.paymentStorage": true,
  "errors.backendUnavailable": true,
  "errors.metadataMismatch": true,
  "errors.missingIntentCredential": true,
  "errors.missingRefreshCredential": true,
  "errors.invalidLicense": true,
  "errors.wrongDevice": true,
  "errors.expired": true,
  "errors.refreshRequired": true,
  "errors.paymentExpired": true,
  "errors.paymentFailed": true,
  "errors.deviceLimitReached": true,
  "errors.licenseRevoked": true,
  "errors.archiveBlocked": true,
  "errors.internal": true,
};
