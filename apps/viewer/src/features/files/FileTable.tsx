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
    <div className="file-table-wrap">
      <table className="file-table">
        <thead>
          <tr>
            <th scope="col">{t("files.name")}</th>
            <th scope="col">{t("files.type")}</th>
            <th scope="col" className="numeric">{t("files.size")}</th>
            <th scope="col" className="visually-hidden">{t("files.open")}</th>
          </tr>
        </thead>
        <tbody>
          {files.map((file) => (
            <tr key={file.fileId} className={selectedFileId === file.fileId ? "selected" : undefined}>
              <td>
                <button type="button" className="file-open-button" onClick={() => onOpen(file)} aria-label={`${t("files.open")}: ${file.displayName}`}>
                  <FileLock2 size={16} aria-hidden="true" />
                  <span>{file.displayName}</span>
                </button>
              </td>
              <td>{fileType(file.mimeType)}</td>
              <td className="numeric mono">{formatBytes(file.sizeBytes, locale)}</td>
              <td className="file-row-action"><ChevronRight size={16} aria-hidden="true" /></td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
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
