import { ChevronDown, ChevronLeft, ChevronRight, ChevronUp } from "lucide-react";
import { useCallback, useEffect, useMemo, useState, type KeyboardEvent } from "react";

import { useI18n } from "../../i18n";
import {
  errorMessageKey,
  rendererBeginOpen,
  rendererCancelOpen,
  rendererClose,
  xlsxOpen,
  xlsxSheetWindow,
  type ProtectedFile,
  type WatermarkDescriptor,
  type XlsxOpenResult,
  type XlsxWindow,
} from "../../ipc";
import { ViewerFailure, ViewerLoading, ViewerSurface } from "./ViewerSurface";

const WINDOW_ROWS = 40;
const WINDOW_COLUMNS = 12;

type State =
  | { kind: "loading" }
  | { kind: "ready"; workbook: XlsxOpenResult; window: XlsxWindow | null; windowLoading: boolean }
  | { kind: "error"; messageKey: string };

export function XlsxViewer({ file, watermark, onClose }: {
  file: ProtectedFile;
  watermark: WatermarkDescriptor;
  onClose: () => void;
}) {
  const { t } = useI18n();
  const [generation, setGeneration] = useState(0);
  const [state, setState] = useState<State>({ kind: "loading" });
  const [sheetIndex, setSheetIndex] = useState(0);
  const [rowOffset, setRowOffset] = useState(0);
  const [columnOffset, setColumnOffset] = useState(0);

  useEffect(() => {
    let active = true;
    let requestId: string | null = null;
    let handle: string | null = null;
    setState({ kind: "loading" });
    setSheetIndex(0);
    setRowOffset(0);
    setColumnOffset(0);
    void rendererBeginOpen(file.fileId, "xlsx")
      .then((request) => {
        requestId = request.requestId;
        if (!active) {
          void rendererCancelOpen(request.requestId).catch(() => undefined);
          return null;
        }
        return xlsxOpen(request.requestId);
      })
      .then((workbook) => {
        if (!workbook) return;
        handle = workbook.handle;
        if (active) {
          setState({ kind: "ready", workbook, window: null, windowLoading: true });
        } else {
          void rendererClose(workbook.handle).catch(() => undefined);
        }
      })
      .catch((error: unknown) => {
        if (active) setState({ kind: "error", messageKey: errorMessageKey(error) ?? "viewer.error" });
      });
    return () => {
      active = false;
      if (requestId) void rendererCancelOpen(requestId).catch(() => undefined);
      if (handle) void rendererClose(handle).catch(() => undefined);
    };
  }, [file.fileId, generation]);

  const handle = state.kind === "ready" ? state.workbook.handle : null;
  useEffect(() => {
    if (!handle) return;
    let active = true;
    setState((current) => current.kind === "ready" ? { ...current, windowLoading: true } : current);
    void xlsxSheetWindow(handle, sheetIndex, rowOffset, WINDOW_ROWS, columnOffset, WINDOW_COLUMNS)
      .then((window) => {
        if (active) setState((current) => current.kind === "ready" ? { ...current, window, windowLoading: false } : current);
      })
      .catch((error: unknown) => {
        if (active) setState({ kind: "error", messageKey: errorMessageKey(error) ?? "viewer.error" });
      });
    return () => { active = false; };
  }, [columnOffset, handle, rowOffset, sheetIndex]);

  const selectSheet = (next: number) => {
    setSheetIndex(next);
    setRowOffset(0);
    setColumnOffset(0);
  };
  const retry = useCallback(() => setGeneration((value) => value + 1), []);
  const sheet = state.kind === "ready" ? state.workbook.sheets[sheetIndex] : undefined;
  const controls = state.kind === "ready" && sheet ? (
    <>
      <button className="icon-button" type="button" onClick={() => setColumnOffset((value) => Math.max(0, value - WINDOW_COLUMNS))} disabled={columnOffset === 0} aria-label={t("xlsx.previousColumns")}><ChevronLeft size={17} aria-hidden="true" /></button>
      <button className="icon-button" type="button" onClick={() => setColumnOffset((value) => value + WINDOW_COLUMNS)} disabled={columnOffset + WINDOW_COLUMNS >= sheet.columnCount} aria-label={t("xlsx.nextColumns")}><ChevronRight size={17} aria-hidden="true" /></button>
      <button className="icon-button" type="button" onClick={() => setRowOffset((value) => Math.max(0, value - WINDOW_ROWS))} disabled={rowOffset === 0} aria-label={t("xlsx.previousRows")}><ChevronUp size={17} aria-hidden="true" /></button>
      <button className="icon-button" type="button" onClick={() => setRowOffset((value) => value + WINDOW_ROWS)} disabled={rowOffset + WINDOW_ROWS >= sheet.rowCount} aria-label={t("xlsx.nextRows")}><ChevronDown size={17} aria-hidden="true" /></button>
    </>
  ) : null;

  return (
    <ViewerSurface file={file} watermark={watermark} controls={controls} onClose={onClose}>
      {state.kind === "loading" ? <ViewerLoading /> : null}
      {state.kind === "error" ? <ViewerFailure message={t(state.messageKey as Parameters<typeof t>[0])} onRetry={retry} /> : null}
      {state.kind === "ready" ? (
        <div className="xlsx-viewport">
          <div className="xlsx-tabs" role="tablist" aria-label={t("xlsx.sheet")}>
            {state.workbook.sheets.map((candidate, index) => (
              <button
                key={`${index}-${candidate.name}`}
                id={`sheet-tab-${index}`}
                type="button"
                role="tab"
                aria-selected={sheetIndex === index}
                aria-controls="xlsx-grid"
                tabIndex={sheetIndex === index ? 0 : -1}
                onClick={() => selectSheet(index)}
                onKeyDown={(event) => handleSheetKey(event, index, state.workbook.sheets.length, selectSheet)}
              >{candidate.name}</button>
            ))}
          </div>
          {state.windowLoading || !state.window ? <ViewerLoading /> : <SpreadsheetGrid window={state.window} />}
        </div>
      ) : null}
    </ViewerSurface>
  );
}

function SpreadsheetGrid({ window }: { window: XlsxWindow }) {
  const values = useMemo(() => new Map(window.cells.map((cell) => [`${cell.row}:${cell.column}`, cell.displayValue])), [window.cells]);
  const rows = Array.from({ length: window.rowCount }, (_, index) => window.rowOffset + index);
  const columns = Array.from({ length: window.columnCount }, (_, index) => window.columnOffset + index);
  return (
    <div className="xlsx-grid-wrap">
      <table className="xlsx-grid" id="xlsx-grid" role="grid">
        <thead><tr><th aria-hidden="true" />{columns.map((column) => <th key={column} scope="col">{columnName(column)}</th>)}</tr></thead>
        <tbody>{rows.map((row) => (
          <tr key={row}><th scope="row">{row + 1}</th>{columns.map((column) => <td key={column}>{values.get(`${row}:${column}`) ?? ""}</td>)}</tr>
        ))}</tbody>
      </table>
    </div>
  );
}

function columnName(zeroBased: number): string {
  let value = zeroBased + 1;
  let output = "";
  while (value > 0) {
    value -= 1;
    output = String.fromCharCode(65 + (value % 26)) + output;
    value = Math.floor(value / 26);
  }
  return output;
}

function handleSheetKey(
  event: KeyboardEvent<HTMLButtonElement>,
  index: number,
  count: number,
  select: (index: number) => void,
) {
  let next: number | null = null;
  if (event.key === "ArrowRight") next = (index + 1) % count;
  if (event.key === "ArrowLeft") next = (index - 1 + count) % count;
  if (event.key === "Home") next = 0;
  if (event.key === "End") next = count - 1;
  if (next === null) return;
  event.preventDefault();
  select(next);
  requestAnimationFrame(() => document.getElementById(`sheet-tab-${next}`)?.focus());
}
