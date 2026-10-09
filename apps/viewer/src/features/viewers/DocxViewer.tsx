import { useCallback, useEffect, useState } from "react";

import { useI18n } from "../../i18n";
import {
  docxOpen,
  errorMessageKey,
  rendererBeginOpen,
  rendererCancelOpen,
  rendererClose,
  type DocxBlock,
  type ProtectedFile,
  type WatermarkDescriptor,
} from "../../ipc";
import { ViewerFailure, ViewerLoading, ViewerSurface } from "./ViewerSurface";

type State =
  | { kind: "loading" }
  | { kind: "ready"; handle: string; blocks: DocxBlock[] }
  | { kind: "error"; messageKey: string };

export function DocxViewer({ file, watermark, onClose }: {
  file: ProtectedFile;
  watermark: WatermarkDescriptor;
  onClose: () => void;
}) {
  const { t } = useI18n();
  const [generation, setGeneration] = useState(0);
  const [state, setState] = useState<State>({ kind: "loading" });

  useEffect(() => {
    let active = true;
    let requestId: string | null = null;
    let handle: string | null = null;
    setState({ kind: "loading" });
    void rendererBeginOpen(file.fileId, "docx")
      .then((request) => {
        requestId = request.requestId;
        if (!active) {
          void rendererCancelOpen(request.requestId).catch(() => undefined);
          return null;
        }
        return docxOpen(request.requestId);
      })
      .then((opened) => {
        if (!opened) return;
        handle = opened.handle;
        if (active) {
          setState({ kind: "ready", handle: opened.handle, blocks: opened.blocks });
        } else {
          void rendererClose(opened.handle).catch(() => undefined);
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

  const retry = useCallback(() => setGeneration((value) => value + 1), []);
  return (
    <ViewerSurface file={file} watermark={watermark} onClose={onClose}>
      {state.kind === "loading" ? <ViewerLoading /> : null}
      {state.kind === "error" ? <ViewerFailure message={t(state.messageKey as Parameters<typeof t>[0])} onRetry={retry} /> : null}
      {state.kind === "ready" ? (
        <article className="document-viewport" aria-label={file.displayName}>
          <div className="document-page">
            {state.blocks.map((block, blockIndex) => {
              if (block.kind === "table") {
                return (
                  <div className="docx-table-wrap" key={blockIndex}>
                    <table className="docx-table"><tbody>{block.rows.map((row, rowIndex) => (
                      <tr key={rowIndex}>{row.map((cell, cellIndex) => <td key={cellIndex}>{cell}</td>)}</tr>
                    ))}</tbody></table>
                  </div>
                );
              }
              const Tag = block.style === "heading" ? "h2" : "p";
              return (
                <Tag className={`docx-${block.style}`} key={blockIndex}>
                  {block.style === "list" ? <span aria-hidden="true">• </span> : null}
                  {block.runs.map((run, runIndex) => (
                    <span className={[run.bold ? "docx-bold" : "", run.italic ? "docx-italic" : "", run.underline ? "docx-underline" : ""].join(" ")} key={runIndex}>{run.text}</span>
                  ))}
                </Tag>
              );
            })}
          </div>
        </article>
      ) : null}
    </ViewerSurface>
  );
}
