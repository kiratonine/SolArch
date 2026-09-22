// Browser-only stand-in for the Tauri backend, used to preview and restyle every screen
// without Rust. Installed from main.tsx only in `vite dev` outside the desktop shell.
import { emit } from "@tauri-apps/api/event";
import { mockIPC, mockWindows } from "@tauri-apps/api/mocks";

import { type PaymentState, type ViewerState } from "../ipc";
import {
  buildPdf,
  buildPng,
  DOCX_BLOCKS,
  ERRORS,
  snapshot,
  XLSX_SHEETS,
  xlsxCell,
} from "./fixtures";

const PAYMENT_FLOW: PaymentState[] = ["payment_ready", "payment_pending", "awaiting_finality", "activating"];
const LATENCY_MS = 350;

type Listener = () => void;

const store = {
  state: "idle" as ViewerState,
  autoFlow: false,
  listeners: new Set<Listener>(),
};

export const previewStore = {
  get state() { return store.state; },
  get autoFlow() { return store.autoFlow; },
  setAutoFlow(value: boolean) {
    store.autoFlow = value;
    notify();
  },
  subscribe(listener: Listener) {
    store.listeners.add(listener);
    return () => { store.listeners.delete(listener); };
  },
  /** Jumps the running app to a state through the same event the desktop shell emits. */
  async show(state: ViewerState) {
    setState(state);
    const error = ERRORS[state];
    await emit("viewer://archive-opened", error
      ? { snapshot: null, error }
      : { snapshot: snapshot(state), error: null });
  },
};

function notify() {
  store.listeners.forEach((listener) => listener());
}

function setState(state: ViewerState) {
  store.state = state;
  notify();
}

function delay<T>(value: T): Promise<T> {
  return new Promise((resolve) => window.setTimeout(() => resolve(value), LATENCY_MS));
}

function advance(state: ViewerState) {
  setState(state);
  return delay(snapshot(state));
}

let pdfBytes: Uint8Array | null = null;
const PNG_SIZE = { width: 1200, height: 800 };

async function handle(cmd: string, args: Record<string, unknown> = {}): Promise<unknown> {
  switch (cmd) {
    case "get_device_public_key": return "preview-device-key";
    case "get_installer_locale": return null;
    case "startup_archive_pending": return false;
    case "take_startup_archive": return null;

    case "plugin:dialog|open": return "C:\\Users\\preview\\Downloads\\field-notes.slr";
    case "open_archive":
    case "retry_metadata": return advance("locked");
    case "start_payment": return advance("payment_ready");
    case "poll_payment": {
      const index = PAYMENT_FLOW.indexOf(store.state as PaymentState);
      if (!store.autoFlow || index < 0) return snapshot(store.state);
      return advance(PAYMENT_FLOW[Math.min(index + 1, PAYMENT_FLOW.length - 1)]);
    }
    case "activate_payment":
      if (!store.autoFlow) return new Promise(() => undefined);
      await delay(null);
      return advance("unlocked");
    case "refresh_license": return advance("unlocked");
    case "close_archive": setState("idle"); return null;
    case "protected_session_status": return null;

    case "renderer_begin_open": return delay({ requestId: `${String(args.kind)}:${String(args.fileId)}` });
    case "renderer_cancel_open":
    case "renderer_close": return null;
    case "pdf_open":
      pdfBytes ??= buildPdf();
      return { handle: "pdf_preview", sizeBytes: pdfBytes.length };
    case "pdf_read_range": {
      pdfBytes ??= buildPdf();
      const offset = Number(args.offset);
      return pdfBytes.slice(offset, offset + Number(args.length));
    }
    case "image_open": return { handle: "image_preview", ...PNG_SIZE, mimeType: "image/png" };
    case "image_render_data": return buildPng(PNG_SIZE.width, PNG_SIZE.height);
    case "docx_open": return delay({ handle: "docx_preview", blocks: DOCX_BLOCKS });
    case "xlsx_open": return delay({ handle: "xlsx_preview", sheets: XLSX_SHEETS });
    case "xlsx_sheet_window": {
      const sheetIndex = Number(args.sheetIndex);
      const sheet = XLSX_SHEETS[sheetIndex];
      const rowOffset = Number(args.rowOffset);
      const columnOffset = Number(args.columnOffset);
      const rowCount = Math.max(0, Math.min(Number(args.rowCount), sheet.rowCount - rowOffset));
      const columnCount = Math.max(0, Math.min(Number(args.columnCount), sheet.columnCount - columnOffset));
      const cells = [];
      for (let row = rowOffset; row < rowOffset + rowCount; row += 1) {
        for (let column = columnOffset; column < columnOffset + columnCount; column += 1) {
          cells.push({ row, column, displayValue: xlsxCell(sheetIndex, row, column) });
        }
      }
      return { sheetIndex, rowOffset, columnOffset, rowCount, columnCount, cells };
    }

    case "plugin:window|is_maximized": return false;
    default:
      if (cmd.startsWith("plugin:window|")) return null;
      console.warn(`[preview] unmocked command: ${cmd}`, args);
      return null;
  }
}

export function installMockDesktop() {
  mockWindows("main");
  mockIPC((cmd, args) => handle(cmd, args as Record<string, unknown>), { shouldMockEvents: true });
}
