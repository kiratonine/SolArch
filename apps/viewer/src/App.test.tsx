import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { vi } from "vitest";

import App from "./App";
import { I18nProvider, LOCALE_STORAGE_KEY } from "./i18n";

const mocks = vi.hoisted(() => ({ invoke: vi.fn(), open: vi.fn() }));

vi.mock("@tauri-apps/api/core", () => ({ invoke: mocks.invoke }));
vi.mock("@tauri-apps/plugin-dialog", () => ({ open: mocks.open }));

const archive = {
  title: "Авторский заголовок — unchanged",
  creatorWallet: "11111111111111111111111111111111",
  priceAmount: "10.000000",
  priceCurrency: "USDC" as const,
  archiveId: "arc_test_01",
  maxDevices: 1,
  allowExport: false as const,
  watermarkEnabled: true as const,
  fingerprint: "57ce84068fdd9b23f8860afa27834151f4fefb038d812c2ac77e8a861b1eecdb",
};

function renderApp() {
  return render(<I18nProvider><App /></I18nProvider>);
}

beforeEach(() => {
  mocks.invoke.mockReset();
  mocks.open.mockReset();
  mocks.invoke.mockImplementation((command: string) => {
    if (command === "get_device_public_key") return Promise.resolve("aTZYJUYw9zrY2nj7Mxv5ds1C+Q4OnJ6D9AxRBypvdBc=");
    if (command === "close_archive") return Promise.resolve();
    if (command === "open_archive") return Promise.resolve(archive);
    return Promise.reject(new Error("unexpected command"));
  });
  mocks.open.mockResolvedValue("C:\\fixtures\\vector.slr");
});

describe("Viewer shell", () => {
  it("renders the empty state and has no protected export controls", async () => {
    renderApp();
    expect(screen.getByRole("heading", { name: "Open a SolArch archive" })).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Open .slr" })).toBeInTheDocument();
    expect(screen.queryByRole("button", { name: /save as|open external|extract/i })).not.toBeInTheDocument();
    await waitFor(() => expect(mocks.invoke).toHaveBeenCalledWith("get_device_public_key"));
  });

  it("shows loading then verified Locked metadata", async () => {
    let finish: ((value: typeof archive) => void) | undefined;
    mocks.invoke.mockImplementation((command: string) => {
      if (command === "get_device_public_key") return Promise.resolve("aTZYJUYw9zrY2nj7Mxv5ds1C+Q4OnJ6D9AxRBypvdBc=");
      if (command === "open_archive") return new Promise<typeof archive>((resolve) => { finish = resolve; });
      return Promise.resolve();
    });
    renderApp();
    fireEvent.click(screen.getByRole("button", { name: "Open .slr" }));
    expect(await screen.findByRole("heading", { name: "Verifying archive" })).toBeInTheDocument();
    finish?.(archive);
    expect(await screen.findByText("Locked")).toBeInTheDocument();
    expect(screen.getByRole("heading", { name: archive.title })).toBeInTheDocument();
    expect(screen.getByText(archive.fingerprint)).toBeInTheDocument();
  });

  it("switches Locked UI to Russian without translating creator metadata", async () => {
    renderApp();
    fireEvent.click(screen.getByRole("button", { name: "Open .slr" }));
    expect(await screen.findByText("Locked")).toBeInTheDocument();
    fireEvent.click(screen.getByRole("button", { name: "Русский" }));
    expect(screen.getByText("Заблокирован")).toBeInTheDocument();
    expect(screen.getByRole("heading", { name: archive.title })).toBeInTheDocument();
    expect(localStorage.getItem(LOCALE_STORAGE_KEY)).toBe("ru");
  });

  it("shows a localized recoverable error", async () => {
    mocks.invoke.mockImplementation((command: string) => {
      if (command === "get_device_public_key") return Promise.resolve("aTZYJUYw9zrY2nj7Mxv5ds1C+Q4OnJ6D9AxRBypvdBc=");
      return Promise.reject({ code: "UNTRUSTED_ARCHIVE", message_key: "errors.untrustedArchive" });
    });
    renderApp();
    fireEvent.click(screen.getByRole("button", { name: "Open .slr" }));
    expect(await screen.findByRole("alert")).toHaveTextContent("not trusted");
    expect(screen.getByRole("button", { name: "Choose another file" })).toBeInTheDocument();
  });
});
