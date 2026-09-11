import { CheckCircle2 } from "lucide-react";

import { useI18n } from "../../i18n";
import { type ProtectedFile, type VerifiedArchive } from "../../ipc";
import { ArchiveFrame } from "../archive/ArchiveWorkspace";
import { FileTable } from "./FileTable";

export function UnlockedWorkspace({ archive, files, onClose }: {
  archive: VerifiedArchive;
  files: ProtectedFile[];
  onClose: () => void;
}) {
  const { t } = useI18n();
  return (
    <ArchiveFrame archive={archive} status={t("states.unlocked")} statusTone="success" onClose={onClose}>
      <section className="files-workspace" aria-labelledby="protected-files-heading">
        <div className="files-heading">
          <CheckCircle2 size={20} aria-hidden="true" />
          <div>
            <h2 id="protected-files-heading">{t("unlocked.title")}</h2>
            <p>{t("unlocked.description")}</p>
          </div>
        </div>
        <FileTable files={files} />
      </section>
    </ArchiveFrame>
  );
}
