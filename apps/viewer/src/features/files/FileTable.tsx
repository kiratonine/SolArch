import { ChevronRight, FileLock2 } from "lucide-react";

import { type Locale, useI18n } from "../../i18n";
import { type ProtectedFile } from "../../ipc";

export function FileTable({ files, selectedFileId, onOpen }: {
  files: ProtectedFile[];
  selectedFileId: string | null;
  onOpen: (file: ProtectedFile) => void;
}) {
  const { locale, t } = useI18n();
  if (files.length === 0) return <p className="files-empty">{t("files.empty")}</p>;

  return (
    <ul className="file-list" aria-label={t("unlocked.files")}>
      {files.map((file) => {
        const selected = selectedFileId === file.fileId;
        return (
          <li key={file.fileId}>
            <button
              type="button"
              className="file-list-button"
              aria-label={`${t("files.open")}: ${file.displayName}`}
              aria-pressed={selected}
              title={file.displayName}
              onClick={() => onOpen(file)}
            >
              <FileLock2 size={16} aria-hidden="true" />
              <span className="file-list-copy">
                <span className="file-list-name">{file.displayName}</span>
                <span className="file-list-meta">
                  <span>{fileType(file.mimeType)}</span>
                  <span aria-hidden="true">·</span>
                  <span className="mono">{formatBytes(file.sizeBytes, locale)}</span>
                </span>
              </span>
              <ChevronRight size={15} aria-hidden="true" />
            </button>
          </li>
        );
      })}
    </ul>
  );
}

function fileType(mimeType: string): string {
  const types: Record<string, string> = {
    "application/pdf": "PDF",
    "image/png": "PNG",
    "image/jpeg": "JPEG",
    "image/webp": "WebP",
    "application/vnd.openxmlformats-officedocument.wordprocessingml.document": "DOCX",
    "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet": "XLSX",
  };
  return types[mimeType] ?? mimeType;
}

function formatBytes(bytes: number, locale: Locale): string {
  const formatter = new Intl.NumberFormat(locale === "ru" ? "ru-RU" : "en-US", {
    maximumFractionDigits: 1,
  });
  if (bytes < 1_024) return `${formatter.format(bytes)} B`;
  if (bytes < 1_048_576) return `${formatter.format(bytes / 1_024)} KB`;
  return `${formatter.format(bytes / 1_048_576)} MB`;
}
