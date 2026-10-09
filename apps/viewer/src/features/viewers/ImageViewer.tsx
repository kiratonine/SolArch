import { Maximize2, Minus, Plus, RotateCcw } from "lucide-react";
import { useCallback, useEffect, useState } from "react";

import { useI18n } from "../../i18n";
import {
  errorMessageKey,
  imageOpen,
  imageRenderData,
  rendererBeginOpen,
  rendererCancelOpen,
  rendererClose,
  type ProtectedFile,
  type WatermarkDescriptor,
} from "../../ipc";
import { ViewerFailure, ViewerLoading, ViewerSurface } from "./ViewerSurface";

type State =
  | { kind: "loading" }
  | { kind: "ready"; handle: string; url: string; width: number; height: number }
  | { kind: "error"; messageKey: string };

export function ImageViewer({ file, watermark, onClose }: {
  file: ProtectedFile;
  watermark: WatermarkDescriptor;
  onClose: () => void;
}) {
  const { t } = useI18n();
  const [generation, setGeneration] = useState(0);
  const [state, setState] = useState<State>({ kind: "loading" });
  const [zoom, setZoom] = useState(1);
  const [fit, setFit] = useState(true);

  useEffect(() => {
    let active = true;
    let requestId: string | null = null;
    let handle: string | null = null;
    let url: string | null = null;
    setState({ kind: "loading" });
    void rendererBeginOpen(file.fileId, "image")
      .then((request) => {
        requestId = request.requestId;
        if (!active) {
          void rendererCancelOpen(request.requestId).catch(() => undefined);
          return null;
        }
        return imageOpen(request.requestId);
      })
      .then(async (opened) => {
        if (!opened) return;
        handle = opened.handle;
        if (!active) {
          await rendererClose(opened.handle).catch(() => undefined);
          return;
        }
        const bytes = await imageRenderData(opened.handle);
        if (!active) {
          await rendererClose(opened.handle).catch(() => undefined);
          return;
        }
        url = URL.createObjectURL(new Blob([Uint8Array.from(bytes)], { type: opened.mimeType }));
        setState({ kind: "ready", handle: opened.handle, url, width: opened.width, height: opened.height });
      })
      .catch((error: unknown) => {
        if (active) setState({ kind: "error", messageKey: errorMessageKey(error) ?? "viewer.error" });
      });
    return () => {
      active = false;
      if (requestId) void rendererCancelOpen(requestId).catch(() => undefined);
      if (url) URL.revokeObjectURL(url);
      if (handle) void rendererClose(handle).catch(() => undefined);
    };
  }, [file.fileId, generation]);

  const retry = useCallback(() => setGeneration((value) => value + 1), []);
  const controls = state.kind === "ready" ? (
    <>
      <button className="icon-button" type="button" onClick={() => { setFit(false); setZoom((value) => Math.max(0.25, value - 0.25)); }} aria-label={t("pdf.zoomOut")}>
        <Minus size={17} aria-hidden="true" />
      </button>
      <span className="viewer-scale mono">{Math.round(zoom * 100)}%</span>
      <button className="icon-button" type="button" onClick={() => { setFit(false); setZoom((value) => Math.min(4, value + 0.25)); }} aria-label={t("pdf.zoomIn")}>
        <Plus size={17} aria-hidden="true" />
      </button>
      <button className="icon-button" type="button" onClick={() => { setFit(true); setZoom(1); }} aria-label={t("image.fit")}>
        <Maximize2 size={17} aria-hidden="true" />
      </button>
      <button className="icon-button" type="button" onClick={() => { setFit(false); setZoom(1); }} aria-label={t("image.reset")}>
        <RotateCcw size={17} aria-hidden="true" />
      </button>
    </>
  ) : null;

  return (
    <ViewerSurface file={file} watermark={watermark} controls={controls} onClose={onClose}>
      {state.kind === "loading" ? <ViewerLoading /> : null}
      {state.kind === "error" ? <ViewerFailure message={t(state.messageKey as Parameters<typeof t>[0])} onRetry={retry} /> : null}
      {state.kind === "ready" ? (
        <div className="image-viewport">
          <img
            src={state.url}
            width={state.width}
            height={state.height}
            alt={file.displayName}
            draggable={false}
            tabIndex={0}
            style={fit ? undefined : { width: `${state.width * zoom}px`, height: `${state.height * zoom}px`, maxWidth: "none" }}
          />
        </div>
      ) : null}
    </ViewerSurface>
  );
}
