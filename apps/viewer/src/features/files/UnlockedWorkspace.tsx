import { CheckCircle2, FileLock2 } from "lucide-react";
import { useEffect, useMemo, useState } from "react";

import { useI18n } from "../../i18n";
import { type ProtectedFile, type VerifiedArchive, type WatermarkDescriptor } from "../../ipc";
import { ArchiveFrame } from "../archive/ArchiveWorkspace";
import { ProtectedViewer } from "../viewers/ProtectedViewer";
import { FileTable } from "./FileTable";

export function UnlockedWorkspace({ archive, files, watermark, onClose }: {
  archive: VerifiedArchive;
  files: ProtectedFile[];
  watermark: WatermarkDescriptor;
  onClose: () => void;
}) {
  const { t } = useI18n();
  const [selectedFileId, setSelectedFileId] = useState<string | null>(null);
  const selected = useMemo(
    () => files.find((file) => file.fileId === selectedFileId) ?? null,
    [files, selectedFileId],
  );

  useEffect(() => {
    if (selectedFileId && !selected) setSelectedFileId(null);
  }, [selected, selectedFileId]);

  return (
    <ArchiveFrame archive={archive} status={t("states.unlocked")} statusTone="success" onClose={onClose} compact>
      <section className="files-workspace" aria-labelledby="protected-files-heading">
        <div className="protected-layout">
          <aside className="protected-files-pane">
            <div className="files-heading">
              <CheckCircle2 size={20} aria-hidden="true" />
              <div>
                <h2 id="protected-files-heading">{t("unlocked.title")}</h2>
                <p>{files.length} {t("files.count")}</p>
              </div>
            </div>
            <FileTable files={files} selectedFileId={selectedFileId} onOpen={(file) => setSelectedFileId(file.fileId)} />
          </aside>
          <div className="protected-view-pane">
            {selected ? (
              <ProtectedViewer file={selected} watermark={watermark} onClose={() => setSelectedFileId(null)} />
            ) : (
              <div className="viewer-empty"><FileLock2Icon /><p>{t("viewer.select")}</p></div>
            )}
          </div>
        </div>
      </section>
    </ArchiveFrame>
  );
}

function FileLock2Icon() {
  return <span className="viewer-empty-icon" aria-hidden="true"><FileLock2 size={22} /></span>;
}
