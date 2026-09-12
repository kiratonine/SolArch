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
  const [fit, setFit] = useState<Fit>("page");
  const [zoom, setZoom] = useState(1);
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const stageRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    let active = true;
    let requestId: string | null = null;
    let handle: string | null = null;
    let loadingTask: PDFDocumentLoadingTask | null = null;
    let transport: ProtectedRangeTransport | null = null;
    setState({ kind: "loading" });
    setPageNumber(1);
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
    if (!document || !rendererHandle || !activeLoadingTask || !canvasRef.current || !stageRef.current) return;
    let active = true;
    let task: RenderTask | null = null;
    void document.getPage(pageNumber).then((page) => {
      if (!active || !canvasRef.current || !stageRef.current) return;
      const base = page.getViewport({ scale: 1 });
      const availableWidth = Math.max(240, stageRef.current.clientWidth - 56);
      const availableHeight = Math.max(240, stageRef.current.clientHeight - 56);
      const scale = fit === "width"
        ? availableWidth / base.width
        : fit === "page"
          ? Math.min(availableWidth / base.width, availableHeight / base.height)
          : zoom;
      const viewport = page.getViewport({ scale: Math.max(0.25, Math.min(4, scale)) });
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
  }, [activeLoadingTask, document, fit, pageNumber, rendererHandle, zoom]);

  const retry = useCallback(() => setGeneration((value) => value + 1), []);
  const pageCount = state.kind === "ready" ? state.document.numPages : 0;
  const controls = state.kind === "ready" ? (
    <>
      <button className="icon-button" type="button" onClick={() => setPageNumber((value) => Math.max(1, value - 1))} disabled={pageNumber <= 1} aria-label={t("pdf.previous")}><ChevronLeft size={17} aria-hidden="true" /></button>
      <span className="viewer-page-count mono">{t("pdf.page")} {pageNumber} {t("pdf.of")} {pageCount}</span>
      <button className="icon-button" type="button" onClick={() => setPageNumber((value) => Math.min(pageCount, value + 1))} disabled={pageNumber >= pageCount} aria-label={t("pdf.next")}><ChevronRight size={17} aria-hidden="true" /></button>
      <span className="viewer-control-divider" aria-hidden="true" />
      <button className="icon-button" type="button" onClick={() => { setFit("manual"); setZoom((value) => Math.max(0.25, value - 0.25)); }} aria-label={t("pdf.zoomOut")}><Minus size={17} aria-hidden="true" /></button>
      <button className="icon-button" type="button" onClick={() => { setFit("manual"); setZoom((value) => Math.min(4, value + 0.25)); }} aria-label={t("pdf.zoomIn")}><Plus size={17} aria-hidden="true" /></button>
      <button className="icon-button" type="button" onClick={() => setFit("page")} aria-pressed={fit === "page"} aria-label={t("pdf.fitPage")}><Maximize2 size={17} aria-hidden="true" /></button>
      <button className="icon-button" type="button" onClick={() => setFit("width")} aria-pressed={fit === "width"} aria-label={t("pdf.fitWidth")}><Columns2 size={17} aria-hidden="true" /></button>
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
