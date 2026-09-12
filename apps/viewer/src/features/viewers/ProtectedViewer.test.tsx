import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { vi } from "vitest";

import { I18nProvider, LOCALE_STORAGE_KEY } from "../../i18n";
import { type ProtectedFile, type WatermarkDescriptor } from "../../ipc";
import { ProtectedViewer } from "./ProtectedViewer";

const mocks = vi.hoisted(() => ({
  pdfOpen: vi.fn(),
  pdfReadRange: vi.fn(),
  imageOpen: vi.fn(),
  imageRenderData: vi.fn(),
  docxOpen: vi.fn(),
  xlsxOpen: vi.fn(),
  xlsxSheetWindow: vi.fn(),
  rendererBeginOpen: vi.fn(),
  rendererCancelOpen: vi.fn(),
  rendererClose: vi.fn(),
  getDocument: vi.fn(),
  rangeRequests: [] as number[],
  createObjectURL: vi.fn(() => "blob:protected-image"),
  revokeObjectURL: vi.fn(),
}));

vi.mock("../../ipc", async (importOriginal) => ({
  ...await importOriginal<typeof import("../../ipc")>(),
  getInstallerLocale: vi.fn(() => Promise.resolve("en")),
  pdfOpen: mocks.pdfOpen,
  pdfReadRange: mocks.pdfReadRange,
  imageOpen: mocks.imageOpen,
  imageRenderData: mocks.imageRenderData,
  docxOpen: mocks.docxOpen,
  xlsxOpen: mocks.xlsxOpen,
  xlsxSheetWindow: mocks.xlsxSheetWindow,
  rendererBeginOpen: mocks.rendererBeginOpen,
  rendererCancelOpen: mocks.rendererCancelOpen,
  rendererClose: mocks.rendererClose,
}));

vi.mock("pdfjs-dist", () => ({
  AnnotationMode: { DISABLE: 0 },
  GlobalWorkerOptions: {},
  PDFDataRangeTransport: class {
    onDataRange = vi.fn();
    constructor(public length: number) {}
    requestDataRange(_begin: number, _end: number) {}
    abort() {}
  },
  getDocument: mocks.getDocument,
}));

const watermark: WatermarkDescriptor = {
  buyerWalletShort: "BuyerW…1111",
  licenseIdShort: "lic_re…0001",
  archiveIdShort: "arc_test_01",
};

function file(mimeType: string, displayName = "protected.file", fileId = "file_000001"): ProtectedFile {
  return { fileId, path: displayName, displayName, mimeType, sizeBytes: 4096 };
}

function viewerElement(protectedFile: ProtectedFile, onClose = vi.fn()) {
  return (
    <I18nProvider>
      <ProtectedViewer file={protectedFile} watermark={watermark} onClose={onClose} />
    </I18nProvider>
  );
}

function renderViewer(protectedFile: ProtectedFile, onClose = vi.fn()) {
  return render(viewerElement(protectedFile, onClose));
}

beforeEach(() => {
  localStorage.clear();
  localStorage.setItem(LOCALE_STORAGE_KEY, "en");
  vi.clearAllMocks();
  mocks.rangeRequests.length = 0;
  Object.defineProperty(URL, "createObjectURL", { configurable: true, value: mocks.createObjectURL });
  Object.defineProperty(URL, "revokeObjectURL", { configurable: true, value: mocks.revokeObjectURL });
  mocks.rendererBeginOpen.mockImplementation((_fileId: string, kind: string) => Promise.resolve({ requestId: `open_${kind}` }));
  mocks.rendererCancelOpen.mockResolvedValue(undefined);
  mocks.rendererClose.mockResolvedValue(undefined);
  mocks.pdfReadRange.mockImplementation((_handle: string, _offset: number, length: number) => {
    mocks.rangeRequests.push(length);
    return Promise.resolve(new Uint8Array(length));
  });
  const page = {
    getViewport: ({ scale }: { scale: number }) => ({ width: 300 * scale, height: 400 * scale }),
    render: vi.fn(() => ({ promise: Promise.resolve(), cancel: vi.fn() })),
  };
  mocks.getDocument.mockImplementation(({ range }: { range: { requestDataRange: (begin: number, end: number) => void } }) => {
    range.requestDataRange(0, 65_536);
    return {
      promise: Promise.resolve({ numPages: 2, getPage: vi.fn(() => Promise.resolve(page)) }),
      destroy: vi.fn(() => Promise.resolve()),
    };
  });
});

it("renders PDF pages through bounded ranges with compact navigation and no escape controls", async () => {
  mocks.pdfOpen.mockResolvedValue({ handle: "view_pdf", sizeBytes: 4096 });
  const view = renderViewer(file("application/pdf", "pages.pdf"));
  expect(await screen.findByText("Page 1 of 2")).toBeInTheDocument();
  expect(mocks.getDocument).toHaveBeenCalledWith(expect.objectContaining({
    disableAutoFetch: true,
    disableStream: true,
    enableXfa: false,
    maxImageSize: 16_777_216,
  }));
  expect(mocks.rangeRequests.every((length) => length <= 256 * 1024)).toBe(true);
  fireEvent.click(screen.getByRole("button", { name: "Next page" }));
  expect(await screen.findByText("Page 2 of 2")).toBeInTheDocument();
  for (let index = 0; index < 20; index += 1) {
    fireEvent.click(screen.getByRole("button", { name: "Zoom in" }));
  }
  await waitFor(() => expect(screen.getByLabelText("pages.pdf, Page 2")).toHaveStyle({ width: "1200px" }));
  fireEvent.click(screen.getByRole("button", { name: "Fit width" }));
  expect(screen.getByRole("button", { name: "Fit width" })).toHaveAttribute("aria-pressed", "true");
  assertWatermarkAndNoEscapeActions();
  view.unmount();
  await waitFor(() => expect(mocks.rendererClose).toHaveBeenCalledWith("view_pdf"));
});

it.each([
  ["image/png", "picture.png"],
  ["image/jpeg", "picture.jpg"],
  ["image/webp", "picture.webp"],
])("renders and releases sanitized %s image data", async (mimeType, name) => {
  mocks.imageOpen.mockResolvedValue({ handle: "view_image", width: 3, height: 2, mimeType: "image/png" });
  mocks.imageRenderData.mockResolvedValue(new Uint8Array([137, 80, 78, 71]));
  const view = renderViewer(file(mimeType, name));
  const image = await screen.findByRole("img", { name });
  expect(image).toHaveAttribute("src", "blob:protected-image");
  for (let index = 0; index < 20; index += 1) {
    fireEvent.click(screen.getByRole("button", { name: "Zoom in" }));
  }
  expect(image).toHaveStyle({ width: "12px", height: "8px" });
  fireEvent.click(screen.getByRole("button", { name: "Reset zoom" }));
  expect(image).toHaveStyle({ width: "3px", height: "2px" });
  fireEvent.click(screen.getByRole("button", { name: "Fit image" }));
  assertWatermarkAndNoEscapeActions();
  view.unmount();
  await waitFor(() => expect(mocks.revokeObjectURL).toHaveBeenCalledWith("blob:protected-image"));
  expect(mocks.rendererClose).toHaveBeenCalledWith("view_image");
});

it("renders DOCX archive text as inert React text with formatting and a table", async () => {
  mocks.docxOpen.mockResolvedValue({
    handle: "view_docx",
    blocks: [
      { kind: "paragraph", style: "heading", runs: [{ text: "<script>alert(1)</script>", bold: true, italic: true, underline: true }] },
      { kind: "table", rows: [["Cell A", "Cell B"]] },
    ],
  });
  renderViewer(file("application/vnd.openxmlformats-officedocument.wordprocessingml.document", "document.docx"));
  expect(await screen.findByText("<script>alert(1)</script>")).toBeInTheDocument();
  expect(document.querySelector("script")).not.toBeInTheDocument();
  expect(screen.getByRole("table")).toHaveTextContent("Cell A");
  assertWatermarkAndNoEscapeActions();
});

it("renders bounded XLSX windows and switches sheets without placing all workbook cells in DOM", async () => {
  mocks.xlsxOpen.mockResolvedValue({
    handle: "view_xlsx",
    sheets: [
      { name: "Overview", rowCount: 1000, columnCount: 30 },
      { name: "Details", rowCount: 1, columnCount: 1 },
    ],
  });
  mocks.xlsxSheetWindow.mockImplementation((_handle, sheetIndex, rowOffset, rowCount, columnOffset, columnCount) => Promise.resolve({
    sheetIndex,
    rowOffset,
    columnOffset,
    rowCount: Math.min(rowCount, 1),
    columnCount: Math.min(columnCount, 2),
    cells: [{ row: rowOffset, column: columnOffset, displayValue: sheetIndex === 0 ? "Revenue" : "Details value" }],
  }));
  renderViewer(file("application/vnd.openxmlformats-officedocument.spreadsheetml.sheet", "workbook.xlsx"));
  expect(await screen.findByText("Revenue")).toBeInTheDocument();
  expect(mocks.xlsxSheetWindow).toHaveBeenCalledWith("view_xlsx", 0, 0, 40, 0, 12);
  fireEvent.click(screen.getByRole("tab", { name: "Details" }));
  expect(await screen.findByText("Details value")).toBeInTheDocument();
  expect(mocks.xlsxSheetWindow).toHaveBeenLastCalledWith("view_xlsx", 1, 0, 40, 0, 12);
  assertWatermarkAndNoEscapeActions();
});

it("shows a typed corrupt-renderer error and permits an explicit retry", async () => {
  mocks.docxOpen
    .mockRejectedValueOnce({ code: "RENDERER_ERROR", message_key: "errors.rendererError" })
    .mockResolvedValueOnce({ handle: "view_retry", blocks: [] });
  renderViewer(file("application/vnd.openxmlformats-officedocument.wordprocessingml.document", "broken.docx"));
  expect(await screen.findByText("The protected file is malformed or could not be rendered safely.")).toBeInTheDocument();
  fireEvent.click(screen.getByRole("button", { name: "Try again" }));
  await waitFor(() => expect(mocks.docxOpen).toHaveBeenCalledTimes(2));
});

it("prevents protected context menus and browser save/print/devtools shortcuts without blocking navigation", async () => {
  mocks.imageOpen.mockResolvedValue({ handle: "view_image", width: 3, height: 2, mimeType: "image/png" });
  mocks.imageRenderData.mockResolvedValue(new Uint8Array([137, 80, 78, 71]));
  renderViewer(file("image/png", "protected.png"));
  await screen.findByRole("img", { name: "protected.png" });
  const surface = screen.getByRole("region", { name: "protected.png" });

  expect(fireEvent.contextMenu(surface)).toBe(false);
  expect(fireEvent.keyDown(surface, { key: "p", ctrlKey: true })).toBe(false);
  expect(fireEvent.keyDown(surface, { key: "s", ctrlKey: true })).toBe(false);
  expect(fireEvent.keyDown(surface, { key: "F12" })).toBe(false);
  expect(fireEvent.keyDown(surface, { key: "Tab" })).toBe(true);
  expect(fireEvent.keyDown(surface, { key: "ArrowRight" })).toBe(true);
});

it("keeps B current when a delayed A renderer open resolves last", async () => {
  let resolveA: ((value: { handle: string; blocks: [] }) => void) | undefined;
  const delayedA = new Promise<{ handle: string; blocks: [] }>((resolve) => { resolveA = resolve; });
  mocks.rendererBeginOpen
    .mockResolvedValueOnce({ requestId: "open_a" })
    .mockResolvedValueOnce({ requestId: "open_b" });
  mocks.docxOpen.mockImplementation((requestId: string) => requestId === "open_a"
    ? delayedA
    : Promise.resolve({ handle: "view_b", blocks: [{ kind: "paragraph", style: "normal", runs: [{ text: "B content", bold: false, italic: false, underline: false }] }] }));

  const view = renderViewer(file("application/vnd.openxmlformats-officedocument.wordprocessingml.document", "A.docx", "file_a"));
  await waitFor(() => expect(mocks.docxOpen).toHaveBeenCalledWith("open_a"));
  view.rerender(viewerElement(file("application/vnd.openxmlformats-officedocument.wordprocessingml.document", "B.docx", "file_b")));
  expect(await screen.findByText("B content")).toBeInTheDocument();

  resolveA?.({ handle: "view_a", blocks: [] });
  await waitFor(() => expect(mocks.rendererClose).toHaveBeenCalledWith("view_a"));
  expect(screen.getByText("B content")).toBeInTheDocument();
  expect(mocks.rendererCancelOpen).toHaveBeenCalledWith("open_a");
});

it("cancels a pending renderer request and destroys its stale completed handle after Close", async () => {
  let resolveOpen: ((value: { handle: string; blocks: [] }) => void) | undefined;
  mocks.rendererBeginOpen.mockResolvedValue({ requestId: "open_pending" });
  mocks.docxOpen.mockReturnValue(new Promise((resolve) => { resolveOpen = resolve; }));
  const view = renderViewer(file("application/vnd.openxmlformats-officedocument.wordprocessingml.document", "pending.docx"));
  await waitFor(() => expect(mocks.docxOpen).toHaveBeenCalledWith("open_pending"));

  view.unmount();
  await waitFor(() => expect(mocks.rendererCancelOpen).toHaveBeenCalledWith("open_pending"));
  resolveOpen?.({ handle: "view_stale", blocks: [] });
  await waitFor(() => expect(mocks.rendererClose).toHaveBeenCalledWith("view_stale"));
});

it("rejects a pathological PDF viewport before assigning a huge canvas", async () => {
  mocks.pdfOpen.mockResolvedValue({ handle: "view_huge_pdf", sizeBytes: 4096 });
  const destroy = vi.fn(() => Promise.resolve());
  const hugePage = {
    getViewport: ({ scale }: { scale: number }) => ({ width: 1_000_000_000 * scale, height: 1_000_000_000 * scale }),
    render: vi.fn(() => ({ promise: Promise.resolve(), cancel: vi.fn() })),
  };
  mocks.getDocument.mockReturnValue({
    promise: Promise.resolve({ numPages: 1, getPage: vi.fn(() => Promise.resolve(hugePage)) }),
    destroy,
  });
  renderViewer(file("application/pdf", "huge.pdf"));

  expect(await screen.findByText("The protected file exceeds safe renderer limits.")).toBeInTheDocument();
  expect(hugePage.render).not.toHaveBeenCalled();
  expect(mocks.rendererClose).toHaveBeenCalledWith("view_huge_pdf");
  expect(destroy).toHaveBeenCalled();
});

function assertWatermarkAndNoEscapeActions() {
  const overlay = screen.getByTestId("watermark-overlay");
  expect(overlay).toHaveAttribute("aria-label", "Wallet BuyerW…1111 · License lic_re…0001 · Archive arc_test_01");
  expect(overlay).toHaveTextContent("BuyerW…1111");
  expect(document.body.textContent).not.toMatch(/save as|open external|extract all|print|download raw/i);
}
