import { invoke } from "@tauri-apps/api/core";
import { listen, type UnlistenFn } from "@tauri-apps/api/event";

export type VerifiedArchive = {
  title: string;
  creatorWallet: string;
  priceAmount: string;
  priceCurrency: "USDC";
  archiveId: string;
  maxDevices: number;
  allowExport: false;
  watermarkEnabled: true;
  fingerprint: string;
};

export type ProtectedFile = {
  fileId: string;
  path: string;
  displayName: string;
  mimeType: string;
  sizeBytes: number;
};

export type PaymentState =
  | "payment_ready"
  | "payment_pending"
  | "awaiting_finality"
  | "activating";

export type PaymentView = {
  state: PaymentState;
  paymentIntentId: string;
  amount: string;
  currency: "USDC";
  solanaPayUrl: string;
  expiresAt: string;
};

export type ViewerState =
  | "idle"
  | "opening"
  | "locked"
  | "checking_metadata"
  | "payment_preparing"
  | PaymentState
  | "unlocked"
  | "refresh_required"
  | "refreshing"
  | "backend_unavailable"
  | "payment_expired"
  | "payment_failed"
  | "device_limit_reached"
  | "license_revoked"
  | "archive_blocked"
  | "error";

export type ViewerSnapshot = {
  state: ViewerState;
  archive: VerifiedArchive | null;
  payment: PaymentView | null;
  files: ProtectedFile[];
};

export type ViewerCommandError = {
  code: string;
  message_key: string;
};

export type FileOpenEvent = {
  snapshot: ViewerSnapshot | null;
  error: ViewerCommandError | null;
};

const FILE_OPEN_EVENT = "viewer://archive-opened";
const FILE_OPEN_REQUESTED_EVENT = "viewer://archive-open-requested";

export function getDevicePublicKey(): Promise<string> {
  return invoke<string>("get_device_public_key");
}

export function getInstallerLocale(): Promise<"ru" | "en" | null> {
  return invoke<"ru" | "en" | null>("get_installer_locale");
}

export function openArchive(path: string): Promise<ViewerSnapshot> {
  return invoke<ViewerSnapshot>("open_archive", { path });
}

export function takeStartupArchive(): Promise<ViewerSnapshot | null> {
  return invoke<ViewerSnapshot | null>("take_startup_archive");
}

export function isStartupArchivePending(): Promise<boolean> {
  return invoke<boolean>("startup_archive_pending");
}

export function onExternalArchiveOpened(
  handler: (event: FileOpenEvent) => void,
): Promise<UnlistenFn> {
  return listen<FileOpenEvent>(FILE_OPEN_EVENT, ({ payload }) => handler(payload));
}

export function onExternalArchiveRequested(handler: () => void): Promise<UnlistenFn> {
  return listen(FILE_OPEN_REQUESTED_EVENT, handler);
}

export function startPayment(): Promise<ViewerSnapshot> {
  return invoke<ViewerSnapshot>("start_payment");
}

export function retryMetadata(): Promise<ViewerSnapshot> {
  return invoke<ViewerSnapshot>("retry_metadata");
}

export function pollPayment(): Promise<ViewerSnapshot> {
  return invoke<ViewerSnapshot>("poll_payment");
}

export function activatePayment(): Promise<ViewerSnapshot> {
  return invoke<ViewerSnapshot>("activate_payment");
}

export function refreshLicense(): Promise<ViewerSnapshot> {
  return invoke<ViewerSnapshot>("refresh_license");
}

export function closeArchive(): Promise<void> {
  return invoke<void>("close_archive");
}

export function errorMessageKey(error: unknown): string | null {
  if (typeof error !== "object" || error === null) return null;
  const candidate = error as Partial<ViewerCommandError>;
  return typeof candidate.message_key === "string" ? candidate.message_key : null;
}
