import { fireEvent, render, screen } from "@testing-library/react";
import { vi } from "vitest";

import { I18nProvider, LOCALE_STORAGE_KEY } from "../../i18n";
import { type ProtectedFile } from "../../ipc";
import { FileTable } from "./FileTable";

const files: ProtectedFile[] = [
  { fileId: "pdf", path: "docs/guide.pdf", displayName: "guide.pdf", mimeType: "application/pdf", sizeBytes: 1_200 },
  { fileId: "png", path: "images/photo.png", displayName: "photo.png", mimeType: "image/png", sizeBytes: 2_048 },
  { fileId: "docx", path: "docs/report.docx", displayName: "report.docx", mimeType: "application/vnd.openxmlformats-officedocument.wordprocessingml.document", sizeBytes: 3_145_728 },
  { fileId: "xlsx", path: "sheets/very-long-financial-model-filename-for-accessibility.xlsx", displayName: "very-long-financial-model-filename-for-accessibility.xlsx", mimeType: "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet", sizeBytes: 512 },
];

beforeEach(() => localStorage.setItem(LOCALE_STORAGE_KEY, "en"));

it("renders four compact selectable files with type, size, and accessible full names", () => {
  const onOpen = vi.fn();
  render(<I18nProvider><FileTable files={files} selectedFileId="png" onOpen={onOpen} /></I18nProvider>);

  const list = screen.getByRole("list", { name: "Protected files" });
  expect(list).toBeInTheDocument();
  expect(list.querySelectorAll("li")).toHaveLength(4);
  expect(screen.getByText("PDF")).toBeInTheDocument();
  expect(screen.getByText("DOCX")).toBeInTheDocument();
  expect(screen.getByText("3 MB")).toBeInTheDocument();

  const selected = screen.getByRole("button", { name: "Open internally: photo.png" });
  expect(selected).toHaveAttribute("aria-pressed", "true");
  const longName = screen.getByRole("button", { name: `Open internally: ${files[3].displayName}` });
  expect(longName).toHaveAttribute("title", files[3].displayName);
  expect(longName.tagName).toBe("BUTTON");
  longName.focus();
  expect(longName).toHaveFocus();
  fireEvent.click(longName);
  expect(onOpen).toHaveBeenCalledWith(files[3]);
  expect(document.body.textContent).not.toMatch(/export|save|print|open external/i);
});
