import { lazy, Suspense } from "react";

import { type ProtectedFile, type WatermarkDescriptor } from "../../ipc";
import { DocxViewer } from "./DocxViewer";
import { ImageViewer } from "./ImageViewer";
import { ViewerLoading } from "./ViewerSurface";
import { XlsxViewer } from "./XlsxViewer";

const PdfViewer = lazy(async () => {
  const module = await import("./PdfViewer");
  return { default: module.PdfViewer };
});

export function ProtectedViewer({ file, watermark, onClose }: {
  file: ProtectedFile;
  watermark: WatermarkDescriptor;
  onClose: () => void;
}) {
  if (file.mimeType === "application/pdf") {
    return (
      <Suspense fallback={<ViewerLoading />}>
        <PdfViewer file={file} watermark={watermark} onClose={onClose} />
      </Suspense>
    );
  }
  if (["image/png", "image/jpeg", "image/webp"].includes(file.mimeType)) {
    return <ImageViewer file={file} watermark={watermark} onClose={onClose} />;
  }
  if (file.mimeType === "application/vnd.openxmlformats-officedocument.wordprocessingml.document") {
    return <DocxViewer file={file} watermark={watermark} onClose={onClose} />;
  }
  if (file.mimeType === "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet") {
    return <XlsxViewer file={file} watermark={watermark} onClose={onClose} />;
  }
  return null;
}
