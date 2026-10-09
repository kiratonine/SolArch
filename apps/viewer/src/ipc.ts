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
  watermark: WatermarkDescriptor | null;
};

export type WatermarkDescriptor = {
  buyerWalletShort: string;
  licenseIdShort: string;
  archiveIdShort: string;
};

export type RendererKind = "pdf" | "image" | "docx" | "xlsx";
export type RendererOpenRequest = { requestId: string };
export type PdfOpenResult = { handle: string; sizeBytes: number };
export type ImageOpenResult = {
  handle: string;
  width: number;
  height: number;
  mimeType: "image/png";
};
export type DocxRun = {
  text: string;
  bold: boolean;
  italic: boolean;
  underline: boolean;
};
export type DocxBlock =
  | { kind: "paragraph"; style: "normal" | "heading" | "list"; runs: DocxRun[] }
  | { kind: "table"; rows: string[][] };
export type DocxOpenResult = { handle: string; blocks: DocxBlock[] };
export type XlsxSheet = { name: string; rowCount: number; columnCount: number };
export type XlsxOpenResult = { handle: string; sheets: XlsxSheet[] };
export type XlsxCell = { row: number; column: number; displayValue: string };
export type XlsxWindow = {
  sheetIndex: number;
  rowOffset: number;
  columnOffset: number;
  rowCount: number;
  columnCount: number;
  cells: XlsxCell[];
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
const PROTECTED_SESSION_EXPIRED_EVENT = "viewer://protected-session-expired";

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

export function protectedSessionStatus(): Promise<void> {
  return invoke<void>("protected_session_status");
}

export function onProtectedSessionExpired(handler: () => void): Promise<UnlistenFn> {
  return listen(PROTECTED_SESSION_EXPIRED_EVENT, handler);
}

export function rendererBeginOpen(fileId: string, kind: RendererKind): Promise<RendererOpenRequest> {
  return invoke<RendererOpenRequest>("renderer_begin_open", { fileId, kind });
}

export function rendererCancelOpen(requestId: string): Promise<void> {
  return invoke<void>("renderer_cancel_open", { requestId });
}

export function pdfOpen(requestId: string): Promise<PdfOpenResult> {
  return invoke<PdfOpenResult>("pdf_open", { requestId });
}

export async function pdfReadRange(handle: string, offset: number, length: number): Promise<Uint8Array> {
  return normalizeBinary(await invoke<ArrayBuffer | Uint8Array>("pdf_read_range", { handle, offset, length }));
}

export function imageOpen(requestId: string): Promise<ImageOpenResult> {
  return invoke<ImageOpenResult>("image_open", { requestId });
}

export async function imageRenderData(handle: string): Promise<Uint8Array> {
  return normalizeBinary(await invoke<ArrayBuffer | Uint8Array>("image_render_data", { handle }));
}

export function docxOpen(requestId: string): Promise<DocxOpenResult> {
  return invoke<DocxOpenResult>("docx_open", { requestId });
}

export function xlsxOpen(requestId: string): Promise<XlsxOpenResult> {
  return invoke<XlsxOpenResult>("xlsx_open", { requestId });
}

export function xlsxSheetWindow(
  handle: string,
  sheetIndex: number,
  rowOffset: number,
  rowCount: number,
  columnOffset: number,
  columnCount: number,
): Promise<XlsxWindow> {
  return invoke<XlsxWindow>("xlsx_sheet_window", {
    handle,
    sheetIndex,
    rowOffset,
    rowCount,
    columnOffset,
    columnCount,
  });
}

export function rendererClose(handle: string): Promise<void> {
  return invoke<void>("renderer_close", { handle });
}

function normalizeBinary(value: ArrayBuffer | Uint8Array): Uint8Array {
  return value instanceof Uint8Array ? value : new Uint8Array(value);
}

export function errorMessageKey(error: unknown): string | null {
  if (typeof error !== "object" || error === null) return null;
  const candidate = error as Partial<ViewerCommandError>;
  return typeof candidate.message_key === "string" ? candidate.message_key : null;
}
