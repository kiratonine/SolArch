import { ChevronLeft, ChevronRight, Columns2, Maximize2, Minus, Plus } from "lucide-react";
import { useCallback, useEffect, useRef, useState } from "react";
import {
  AnnotationMode,
  GlobalWorkerOptions,
  PDFDataRangeTransport,
  getDocument,
  type PDFDocumentLoadingTask,
  type PDFDocumentProxy,
  type RenderTask,
} from "pdfjs-dist";
import workerUrl from "pdfjs-dist/build/pdf.worker.min.mjs?url";

import { useI18n } from "../../i18n";
import {
  errorMessageKey,
  pdfOpen,
  pdfReadRange,
  rendererBeginOpen,
  rendererCancelOpen,
  rendererClose,
  type ProtectedFile,
  type WatermarkDescriptor,
} from "../../ipc";
import { ViewerFailure, ViewerLoading, ViewerSurface } from "./ViewerSurface";

GlobalWorkerOptions.workerSrc = workerUrl;
const RANGE_BYTES = 256 * 1024;
export const MAX_PDF_CANVAS_PIXELS = 16_777_216;
const MAX_PDF_CANVAS_DIMENSION = 16_384;
const MIN_PDF_SCALE = 0.25;
const MAX_PDF_SCALE = 4;
const PDF_ZOOM_STEP = 0.25;

export function boundedPdfCanvasSize(width: number, height: number, pixelRatio: number) {
  const canvasWidth = Math.floor(width * pixelRatio);
  const canvasHeight = Math.floor(height * pixelRatio);
  if (
    !Number.isFinite(canvasWidth)
    || !Number.isFinite(canvasHeight)
    || canvasWidth <= 0
    || canvasHeight <= 0
    || canvasWidth > MAX_PDF_CANVAS_DIMENSION
    || canvasHeight > MAX_PDF_CANVAS_DIMENSION
    || canvasWidth * canvasHeight > MAX_PDF_CANVAS_PIXELS
  ) {
    return null;
  }
  return { width: canvasWidth, height: canvasHeight };
}

type State =
  | { kind: "loading" }
  | { kind: "ready"; handle: string; document: PDFDocumentProxy; loadingTask: PDFDocumentLoadingTask }
  | { kind: "error"; messageKey: string };
type Fit = "page" | "width" | "manual";
type StageSize = { width: number; height: number };

function boundedPdfScale(scale: number): number {
  return Math.max(MIN_PDF_SCALE, Math.min(MAX_PDF_SCALE, scale));
}

class ProtectedRangeTransport extends PDFDataRangeTransport {
  private active = true;
  private readonly handle: string;
  private readonly onFailure: (error: unknown) => void;

  constructor(length: number, handle: string, onFailure: (error: unknown) => void) {
    super(length, null, true);
    this.handle = handle;
    this.onFailure = onFailure;
  }

  override requestDataRange(begin: number, end: number): void {
    const length = end - begin;
    if (!this.active || begin < 0 || length <= 0 || length > RANGE_BYTES) {
      this.onFailure(new Error("invalid PDF range"));
      return;
    }
    void pdfReadRange(this.handle, begin, length)
      .then((chunk) => { if (this.active) this.onDataRange(begin, chunk); })
      .catch((error: unknown) => { if (this.active) this.onFailure(error); });
  }

  override abort(): void { this.active = false; }
}

export function PdfViewer({ file, watermark, onClose }: {
  file: ProtectedFile;
  watermark: WatermarkDescriptor;
  onClose: () => void;
}) {
  const { t } = useI18n();
  const [generation, setGeneration] = useState(0);
  const [state, setState] = useState<State>({ kind: "loading" });
  const [pageNumber, setPageNumber] = useState(1);
  const [fit, setFit] = useState<Fit>("width");
  const [zoom, setZoom] = useState(1);
  const [visualScale, setVisualScale] = useState<number | null>(null);
  const [stageSize, setStageSize] = useState<StageSize>({ width: 0, height: 0 });
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const stageRef = useRef<HTMLDivElement>(null);
  const observedStageSizeRef = useRef<StageSize>({ width: 0, height: 0 });

  useEffect(() => {
    let active = true;
    let requestId: string | null = null;
    let handle: string | null = null;
    let loadingTask: PDFDocumentLoadingTask | null = null;
    let transport: ProtectedRangeTransport | null = null;
    setState({ kind: "loading" });
    setPageNumber(1);
    setFit("width");
    setZoom(1);
    setVisualScale(null);
    observedStageSizeRef.current = { width: 0, height: 0 };
    void rendererBeginOpen(file.fileId, "pdf")
      .then((request) => {
        requestId = request.requestId;
        if (!active) {
          void rendererCancelOpen(request.requestId).catch(() => undefined);
          return null;
        }
        return pdfOpen(request.requestId);
      })
      .then(async (opened) => {
        if (!opened) return;
        handle = opened.handle;
        if (!active) {
          await rendererClose(opened.handle).catch(() => undefined);
          return;
        }
        const fail = (error: unknown) => {
          if (active) setState({ kind: "error", messageKey: errorMessageKey(error) ?? "viewer.error" });
          void loadingTask?.destroy();
        };
        transport = new ProtectedRangeTransport(opened.sizeBytes, opened.handle, fail);
        loadingTask = getDocument({
          range: transport,
          rangeChunkSize: RANGE_BYTES,
          disableAutoFetch: true,
          disableStream: true,
          enableXfa: false,
          stopAtErrors: true,
          maxImageSize: 16_777_216,
        });
        const document = await loadingTask.promise;
        if (active) {
          setState({ kind: "ready", handle: opened.handle, document, loadingTask });
        } else {
          await loadingTask.destroy().catch(() => undefined);
          await rendererClose(opened.handle).catch(() => undefined);
        }
      })
      .catch((error: unknown) => {
        if (active) setState({ kind: "error", messageKey: errorMessageKey(error) ?? "viewer.error" });
      });
    return () => {
      active = false;
      if (requestId) void rendererCancelOpen(requestId).catch(() => undefined);
      transport?.abort();
      void loadingTask?.destroy();
      if (handle) void rendererClose(handle).catch(() => undefined);
    };
  }, [file.fileId, generation]);

  const document = state.kind === "ready" ? state.document : null;
  const rendererHandle = state.kind === "ready" ? state.handle : null;
  const activeLoadingTask = state.kind === "ready" ? state.loadingTask : null;

  useEffect(() => {
    const stage = stageRef.current;
    if (!document || !stage || typeof ResizeObserver === "undefined") return;
    const updateSize = (width: number, height: number) => {
      if (width <= 0 || height <= 0) return;
      const current = observedStageSizeRef.current;
      if (current.width === width && current.height === height) return;
      observedStageSizeRef.current = { width, height };
      setVisualScale(null);
      setStageSize({ width, height });
    };
    updateSize(stage.clientWidth, stage.clientHeight);
    const observer = new ResizeObserver((entries) => {
      const entry = entries[0];
      if (entry) updateSize(entry.contentRect.width, entry.contentRect.height);
    });
    observer.observe(stage);
    return () => observer.disconnect();
  }, [document]);

  useEffect(() => {
    if (!document || !rendererHandle || !activeLoadingTask || !canvasRef.current || !stageRef.current) return;
    let active = true;
    let task: RenderTask | null = null;
    void document.getPage(pageNumber).then((page) => {
      if (!active || !canvasRef.current || !stageRef.current) return;
      const base = page.getViewport({ scale: 1 });
      const availableWidth = Math.max(240, (stageSize.width || stageRef.current.clientWidth) - 32);
      const availableHeight = Math.max(240, (stageSize.height || stageRef.current.clientHeight) - 32);
      const scale = fit === "width"
        ? availableWidth / base.width
        : fit === "page"
          ? Math.min(availableWidth / base.width, availableHeight / base.height)
          : zoom;
      const renderedScale = boundedPdfScale(scale);
      setVisualScale(renderedScale);
      const viewport = page.getViewport({ scale: renderedScale });
      const pixelRatio = Math.min(window.devicePixelRatio || 1, 2);
      const canvas = canvasRef.current;
      const canvasSize = boundedPdfCanvasSize(viewport.width, viewport.height, pixelRatio);
      if (!canvasSize) {
        setState({ kind: "error", messageKey: "errors.rendererLimit" });
        void activeLoadingTask.destroy().catch(() => undefined);
        void rendererClose(rendererHandle).catch(() => undefined);
        return;
      }
      canvas.width = canvasSize.width;
      canvas.height = canvasSize.height;
      canvas.style.width = `${Math.floor(viewport.width)}px`;
      canvas.style.height = `${Math.floor(viewport.height)}px`;
      task = page.render({
        canvas,
        viewport,
        annotationMode: AnnotationMode.DISABLE,
        transform: pixelRatio === 1 ? undefined : [pixelRatio, 0, 0, pixelRatio, 0, 0],
      });
      return task.promise;
    }).catch(() => {
      if (active) setState({ kind: "error", messageKey: "viewer.error" });
    });
    return () => {
      active = false;
      task?.cancel();
      const canvas = canvasRef.current;
      if (canvas) { canvas.width = 0; canvas.height = 0; }
    };
  }, [activeLoadingTask, document, fit, pageNumber, rendererHandle, stageSize, zoom]);

  const retry = useCallback(() => setGeneration((value) => value + 1), []);
  const pageCount = state.kind === "ready" ? state.document.numPages : 0;
  const changePage = useCallback((nextPage: number) => {
    setVisualScale(null);
    setPageNumber(nextPage);
  }, []);
  const selectFit = useCallback((nextFit: Exclude<Fit, "manual">) => {
    if (fit === nextFit) return;
    setVisualScale(null);
    setFit(nextFit);
  }, [fit]);
  const adjustZoom = useCallback((delta: number) => {
    if (visualScale === null) return;
    const nextZoom = boundedPdfScale(visualScale + delta);
    setFit("manual");
    setZoom(nextZoom);
    setVisualScale(nextZoom);
  }, [visualScale]);
  const controls = state.kind === "ready" ? (
    <>
      <button className="icon-button" type="button" onClick={() => changePage(Math.max(1, pageNumber - 1))} disabled={pageNumber <= 1} aria-label={t("pdf.previous")}><ChevronLeft size={17} aria-hidden="true" /></button>
      <span className="viewer-page-count mono">{t("pdf.page")} {pageNumber} {t("pdf.of")} {pageCount}</span>
      <button className="icon-button" type="button" onClick={() => changePage(Math.min(pageCount, pageNumber + 1))} disabled={pageNumber >= pageCount} aria-label={t("pdf.next")}><ChevronRight size={17} aria-hidden="true" /></button>
      <span className="viewer-control-divider" aria-hidden="true" />
      <button className="icon-button" type="button" onClick={() => adjustZoom(-PDF_ZOOM_STEP)} disabled={visualScale === null} aria-label={t("pdf.zoomOut")}><Minus size={17} aria-hidden="true" /></button>
      <button className="icon-button" type="button" onClick={() => adjustZoom(PDF_ZOOM_STEP)} disabled={visualScale === null} aria-label={t("pdf.zoomIn")}><Plus size={17} aria-hidden="true" /></button>
      <button className="icon-button" type="button" onClick={() => selectFit("page")} aria-pressed={fit === "page"} aria-label={t("pdf.fitPage")}><Maximize2 size={17} aria-hidden="true" /></button>
      <button className="icon-button" type="button" onClick={() => selectFit("width")} aria-pressed={fit === "width"} aria-label={t("pdf.fitWidth")}><Columns2 size={17} aria-hidden="true" /></button>
    </>
  ) : null;

  return (
    <ViewerSurface file={file} watermark={watermark} controls={controls} onClose={onClose}>
      {state.kind === "loading" ? <ViewerLoading /> : null}
      {state.kind === "error" ? <ViewerFailure message={t(state.messageKey as Parameters<typeof t>[0])} onRetry={retry} /> : null}
      {state.kind === "ready" ? <div className="pdf-viewport" ref={stageRef}><canvas ref={canvasRef} aria-label={`${file.displayName}, ${t("pdf.page")} ${pageNumber}`} /></div> : null}
    </ViewerSurface>
  );
}
