import { act, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { vi } from "vitest";

import App from "./App";
import { formatPaymentAmount } from "./features/payment/formatPaymentAmount";
import { I18nProvider, LOCALE_STORAGE_KEY } from "./i18n";
import type { FileOpenEvent, ViewerSnapshot, ViewerState } from "./ipc";
import "./styles.css";

type EventCallback = (event: { payload: unknown }) => void;
const mocks = vi.hoisted(() => ({
  invoke: vi.fn(),
  open: vi.fn(),
  listeners: new Map<string, EventCallback>(),
  appWindow: {
    isMaximized: vi.fn(() => Promise.resolve(false)),
    onResized: vi.fn(() => Promise.resolve(vi.fn())),
    minimize: vi.fn(() => Promise.resolve()),
    toggleMaximize: vi.fn(() => Promise.resolve()),
    close: vi.fn(() => Promise.resolve()),
  },
}));

vi.mock("@tauri-apps/api/core", () => ({ invoke: mocks.invoke }));
vi.mock("@tauri-apps/api/event", () => ({
  listen: vi.fn((name: string, callback: EventCallback) => {
    mocks.listeners.set(name, callback);
    return Promise.resolve(() => mocks.listeners.delete(name));
  }),
}));
vi.mock("@tauri-apps/plugin-dialog", () => ({ open: mocks.open }));
vi.mock("@tauri-apps/api/window", () => ({ getCurrentWindow: () => mocks.appWindow }));

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

const qr = "solana:https://api.solarch.example/v1/solana-pay/payment-intents/pi_test_01/transaction";
const payment = {
  state: "payment_ready" as const,
  paymentIntentId: "pi_test_01",
  amount: "10.000000",
  currency: "USDC" as const,
  solanaPayUrl: qr,
  expiresAt: "2026-09-10T00:30:00Z",
};

function snapshot(state: ViewerState): ViewerSnapshot {
  return {
    state,
    archive,
    payment: state.startsWith("payment_") || state === "awaiting_finality" || state === "activating"
      ? { ...payment, state: state as typeof payment.state }
      : null,
    files: state === "unlocked"
      ? [{ fileId: "file_000000", path: "course/a.pdf", displayName: "a.pdf", mimeType: "application/pdf", sizeBytes: 1_200 }]
      : [],
    watermark: state === "unlocked" ? {
      buyerWalletShort: "Buyer1…yer1",
      licenseIdShort: "lic_01…c_01",
      archiveIdShort: "arc_te…st_01",
    } : null,
  };
}

function renderApp() {
  return render(<I18nProvider><App /></I18nProvider>);
}

async function openManually() {
  fireEvent.click(await screen.findByRole("button", { name: "Open archive" }));
}

function defaultInvoke(command: string): Promise<unknown> {
  if (command === "get_installer_locale") return Promise.resolve("en");
  if (command === "startup_archive_pending") return Promise.resolve(false);
  if (command === "take_startup_archive") return Promise.resolve(null);
  if (command === "get_device_public_key") return Promise.resolve("public-device-value-that-must-not-render");
  if (command === "close_archive") return Promise.resolve();
  if (command === "protected_session_status") return Promise.resolve();
  if (command === "open_archive") return Promise.resolve(snapshot("locked"));
  return Promise.reject(new Error(`unexpected command ${command}`));
}

function viewportRect(top: number): DOMRect {
  return {
    x: 0,
    y: top,
    top,
    right: 800,
    bottom: top + 40,
    left: 0,
    width: 800,
    height: 40,
    toJSON: () => ({}),
  };
}

beforeEach(() => {
  localStorage.clear();
  mocks.invoke.mockReset();
  mocks.open.mockReset();
  mocks.listeners.clear();
  vi.clearAllMocks();
  mocks.invoke.mockImplementation(defaultInvoke);
  mocks.open.mockResolvedValue("C:\\fixtures\\vector.slr");
});

afterEach(() => {
  vi.useRealTimers();
});

describe("Viewer Part 03 state machine and desktop shell", () => {
  it.each([
    ["1.000000", "1.00"],
    ["1", "1.00"],
    ["1.2", "1.20"],
    ["1.235000", "1.24"],
  ])("formats payment amount %s as %s for presentation only", (value, expected) => {
    expect(formatPaymentAmount(value)).toBe(expected);
  });

  it.each([
    ["idle", "auto", 0],
    ["locked", "auto", 0],
    ["payment_pending", "auto", 0],
    ["error", "auto", 0],
    ["unlocked", "hidden", -1],
  ] as const)("keeps %s inside the bounded desktop shell", async (state, workspaceOverflow, tabIndex) => {
    mocks.invoke.mockImplementation((command: string) => {
      if (["get_installer_locale", "startup_archive_pending", "take_startup_archive", "get_device_public_key"].includes(command)) {
        return defaultInvoke(command);
      }
      if (command === "open_archive") return Promise.resolve(snapshot(state));
      if (command === "poll_payment") return new Promise(() => undefined);
      return Promise.resolve();
    });
    renderApp();
    await openManually();
    await waitFor(() => expect(document.querySelector(".app-shell")).toHaveAttribute("data-viewer-state", state));
    await act(async () => { await Promise.resolve(); });

    const shell = document.querySelector<HTMLElement>(".app-shell");
    const titlebar = document.querySelector<HTMLElement>(".window-titlebar");
    const topbar = document.querySelector<HTMLElement>(".topbar");
    const workspace = document.querySelector<HTMLElement>(".workspace");
    expect(shell && titlebar && topbar && workspace).toBeTruthy();
    if (!shell || !titlebar || !topbar || !workspace) return;

    expect(getComputedStyle(shell).position).toBe("fixed");
    expect(getComputedStyle(shell).overflow).toBe("hidden");
    expect(getComputedStyle(workspace).overflowY).toBe(workspaceOverflow);
    expect(workspace.tabIndex).toBe(tabIndex);
    expect(workspace).not.toContainElement(titlebar);
    expect(workspace).not.toContainElement(topbar);
  });

  it("scrolls Payment content without moving either chrome row", async () => {
    mocks.invoke.mockImplementation((command: string) => {
      if (["get_installer_locale", "startup_archive_pending", "take_startup_archive", "get_device_public_key"].includes(command)) {
        return defaultInvoke(command);
      }
      if (command === "open_archive") return Promise.resolve(snapshot("payment_pending"));
      if (command === "poll_payment") return new Promise(() => undefined);
      return Promise.resolve();
    });
    renderApp();
    await openManually();
    expect(await screen.findByTitle("Solana Pay payment QR code")).toBeInTheDocument();
    await waitFor(() => expect(mocks.appWindow.onResized).toHaveBeenCalled());
    await act(async () => { await new Promise((resolve) => setTimeout(resolve, 0)); });

    const titlebar = document.querySelector<HTMLElement>(".window-titlebar");
    const topbar = document.querySelector<HTMLElement>(".topbar");
    const workspace = document.querySelector<HTMLElement>(".workspace");
    const content = document.querySelector<HTMLElement>(".archive-workspace");
    expect(titlebar && topbar && workspace && content).toBeTruthy();
    if (!titlebar || !topbar || !workspace || !content) return;

    const measuredRect = (element: HTMLElement, baseTop: number) => vi
      .spyOn(element, "getBoundingClientRect")
      .mockImplementation(() => viewportRect(baseTop - (workspace.contains(element) ? workspace.scrollTop : 0)));
    measuredRect(titlebar, 0);
    measuredRect(topbar, 40);
    measuredRect(content, 92);
    const before = {
      titlebar: titlebar.getBoundingClientRect().top,
      topbar: topbar.getBoundingClientRect().top,
      content: content.getBoundingClientRect().top,
    };

    workspace.scrollTop = 320;
    fireEvent.scroll(workspace);

    expect(titlebar.getBoundingClientRect().top).toBe(before.titlebar);
    expect(topbar.getBoundingClientRect().top).toBe(before.topbar);
    expect(content.getBoundingClientRect().top).toBeLessThan(before.content);
    expect(document.documentElement.scrollTop).toBe(0);
  });

  it("uses the compact readable payment composition without document scroll", async () => {
    mocks.invoke.mockImplementation((command: string) => {
      if (["get_installer_locale", "startup_archive_pending", "take_startup_archive", "get_device_public_key"].includes(command)) {
        return defaultInvoke(command);
      }
      if (command === "open_archive") return Promise.resolve(snapshot("payment_pending"));
      if (command === "poll_payment") return new Promise(() => undefined);
      return Promise.resolve();
    });
    renderApp();
    await openManually();
    expect(await screen.findByTitle("Solana Pay payment QR code")).toBeInTheDocument();
    await waitFor(() => expect(mocks.appWindow.onResized).toHaveBeenCalled());
    await act(async () => { await new Promise((resolve) => setTimeout(resolve, 0)); });

    const workspace = document.querySelector<HTMLElement>(".workspace");
    const layout = document.querySelector<HTMLElement>(".archive-layout-payment");
    const metadataValue = document.querySelector<HTMLElement>(".metadata-list dd");
    const helper = document.querySelector<HTMLElement>(".payment-detail");
    const qrFrame = document.querySelector<HTMLElement>(".qr-frame");
    expect(workspace && layout && metadataValue && helper && qrFrame).toBeTruthy();
    if (!workspace || !layout || !metadataValue || !helper || !qrFrame) return;

    expect(getComputedStyle(workspace).paddingBlock).toBe("12px");
    expect(getComputedStyle(layout).minHeight).toBe("0");
    expect(getComputedStyle(metadataValue).fontSize).toBe("14px");
    expect(getComputedStyle(helper).fontSize).toBe("13px");
    expect(getComputedStyle(qrFrame).width).toBe("168px");
    expect(document.documentElement.scrollTop).toBe(0);
  });

  it("opens to trusted Locked metadata with no wallet, export, or device-key controls", async () => {
    renderApp();
    await openManually();
    expect(await screen.findByText("Locked")).toBeInTheDocument();
    await act(async () => { await Promise.resolve(); });
    expect(screen.getByRole("heading", { name: archive.title })).toBeInTheDocument();
    expect(screen.queryByRole("textbox")).not.toBeInTheDocument();
    expect(screen.queryByText(/save as|open external|extract/i)).not.toBeInTheDocument();
    expect(screen.queryByText("public-device-value-that-must-not-render")).not.toBeInTheDocument();
    expect(document.querySelector(".app-shell")).toHaveAttribute("data-viewer-state", "locked");
    expect(document.querySelector(".price-block strong")).toHaveTextContent("10.00 USDC");
    expect(screen.getByRole("button", { name: "Unlock for 10.00 USDC" })).toBeInTheDocument();
    expect(document.body).not.toHaveTextContent("10.000000 USDC");
  });

  it("persists no secret in DOM and renders the exact Rust-validated QR URL", async () => {
    mocks.invoke.mockImplementation((command: string) => {
      if (["get_installer_locale", "startup_archive_pending", "take_startup_archive", "get_device_public_key"].includes(command)) {
        return defaultInvoke(command);
      }
      if (command === "open_archive") return Promise.resolve(snapshot("locked"));
      if (command === "start_payment") return Promise.resolve(snapshot("payment_ready"));
      if (command === "poll_payment") return new Promise(() => undefined);
      return Promise.resolve();
    });
    renderApp();
    await openManually();
    fireEvent.click(await screen.findByRole("button", { name: "Unlock for 10.00 USDC" }));
    expect(await screen.findByTitle("Solana Pay payment QR code")).toBeInTheDocument();
    expect(document.querySelector("[data-qr-value]")).toHaveAttribute("data-qr-value", qr);
    expect(screen.getByText("10.00 USDC")).toBeInTheDocument();
    expect(document.body).not.toHaveTextContent("10.000000 USDC");
    expect(document.body.textContent).not.toMatch(/client_secret|refresh_token|AAECAwQF/);
  });

  it("bounds transient polling retries with exponential backoff", async () => {
    vi.useFakeTimers();
    localStorage.setItem(LOCALE_STORAGE_KEY, "en");
    mocks.invoke.mockImplementation((command: string) => {
      if (command === "startup_archive_pending") return Promise.resolve(false);
      if (command === "get_device_public_key") return Promise.resolve("public-device");
      if (command === "open_archive") return Promise.resolve(snapshot("payment_ready"));
      if (command === "poll_payment") return Promise.reject({
        code: "BACKEND_UNAVAILABLE",
        message_key: "errors.backendUnavailable",
      });
      return Promise.resolve(null);
    });
    renderApp();
    await act(async () => {
      fireEvent.click(screen.getByRole("button", { name: "Open archive" }));
      await Promise.resolve();
    });
    expect(screen.getByTitle("Solana Pay payment QR code")).toBeInTheDocument();

    for (const delay of [1_800, 3_600]) {
      await act(async () => { await vi.advanceTimersByTimeAsync(delay); });
      expect(screen.queryByText("Backend unavailable")).not.toBeInTheDocument();
    }
    await act(async () => { await vi.advanceTimersByTimeAsync(7_200); });
    expect(screen.getByRole("heading", { name: "Backend unavailable" })).toBeInTheDocument();
    expect(mocks.invoke.mock.calls.filter(([command]) => command === "poll_payment")).toHaveLength(3);
  });

  it("continues sequential polling while payment remains pending", async () => {
    vi.useFakeTimers();
    localStorage.setItem(LOCALE_STORAGE_KEY, "en");
    mocks.invoke.mockImplementation((command: string) => {
      if (command === "startup_archive_pending") return Promise.resolve(false);
      if (command === "get_device_public_key") return Promise.resolve("public-device");
      if (command === "open_archive") return Promise.resolve(snapshot("payment_ready"));
      if (command === "poll_payment") return Promise.resolve(snapshot("payment_pending"));
      return Promise.resolve(null);
    });

    renderApp();
    await act(async () => {
      fireEvent.click(screen.getByRole("button", { name: "Open archive" }));
      await Promise.resolve();
    });

    for (const delay of [1_800, 2_600, 2_600, 2_600]) {
      await act(async () => { await vi.advanceTimersByTimeAsync(delay); });
    }
    expect(mocks.invoke.mock.calls.filter(([command]) => command === "poll_payment")).toHaveLength(4);
    expect(screen.getAllByText("Waiting for payment").length).toBeGreaterThan(0);
  });

  it("automatically renders payment expiry returned by a polling request", async () => {
    vi.useFakeTimers();
    localStorage.setItem(LOCALE_STORAGE_KEY, "en");
    mocks.invoke.mockImplementation((command: string) => {
      if (command === "startup_archive_pending") return Promise.resolve(false);
      if (command === "get_device_public_key") return Promise.resolve("public-device");
      if (command === "open_archive") return Promise.resolve(snapshot("payment_pending"));
      if (command === "poll_payment") {
        return Promise.reject({ code: "PAYMENT_EXPIRED", message_key: "errors.paymentExpired" });
      }
      return Promise.resolve(null);
    });

    renderApp();
    await act(async () => {
      fireEvent.click(screen.getByRole("button", { name: "Open archive" }));
      await Promise.resolve();
    });
    expect(screen.getByTitle("Solana Pay payment QR code")).toBeInTheDocument();
    await act(async () => { await vi.advanceTimersByTimeAsync(2_600); });

    expect(screen.getByRole("heading", { name: "Payment expired" })).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Back to payment" })).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Close archive" })).toBeInTheDocument();
  });

  it("stops polling after payment reaches the terminal network state", async () => {
    vi.useFakeTimers();
    localStorage.setItem(LOCALE_STORAGE_KEY, "en");
    mocks.invoke.mockImplementation((command: string) => {
      if (command === "startup_archive_pending") return Promise.resolve(false);
      if (command === "get_device_public_key") return Promise.resolve("public-device");
      if (command === "open_archive") return Promise.resolve(snapshot("payment_pending"));
      if (command === "poll_payment") return Promise.resolve(snapshot("activating"));
      if (command === "activate_payment") return new Promise(() => undefined);
      return Promise.resolve(null);
    });

    renderApp();
    await act(async () => {
      fireEvent.click(screen.getByRole("button", { name: "Open archive" }));
      await Promise.resolve();
    });
    expect(screen.getByTitle("Solana Pay payment QR code")).toBeInTheDocument();
    await act(async () => { await vi.advanceTimersByTimeAsync(2_600); });
    expect(screen.getByText(/Payment confirmed/)).toBeInTheDocument();

    await act(async () => { await vi.advanceTimersByTimeAsync(60_000); });
    expect(mocks.invoke.mock.calls.filter(([command]) => command === "poll_payment")).toHaveLength(1);
  });

  it.each([
    ["payment_pending", "Waiting for payment"],
    ["awaiting_finality", "Awaiting finality"],
    ["backend_unavailable", "Backend unavailable"],
    ["payment_expired", "Payment expired"],
    ["payment_failed", "Payment failed"],
    ["device_limit_reached", "Device limit reached"],
    ["license_revoked", "License revoked"],
    ["refresh_required", "Refresh required"],
    ["archive_blocked", "Archive blocked"],
  ] as const)("renders %s as an explicit state", async (state, label) => {
    mocks.invoke.mockImplementation((command: string) => {
      if (["get_installer_locale", "startup_archive_pending", "take_startup_archive", "get_device_public_key"].includes(command)) {
        return defaultInvoke(command);
      }
      if (command === "open_archive") return Promise.resolve(snapshot(state));
      if (command === "poll_payment") return new Promise(() => undefined);
      return Promise.resolve();
    });
    renderApp();
    await openManually();
    expect((await screen.findAllByText(label)).length).toBeGreaterThan(0);
    if (state === "awaiting_finality") {
      expect(screen.getByText(/still locked/i)).toBeInTheDocument();
      expect(document.querySelector(".status-success")).not.toBeInTheDocument();
    }
  });

  it("returns an expired payment to Locked without closing the archive or starting a new intent", async () => {
    mocks.invoke.mockImplementation((command: string) => {
      if (["get_installer_locale", "startup_archive_pending", "take_startup_archive", "get_device_public_key"].includes(command)) {
        return defaultInvoke(command);
      }
      if (command === "open_archive") return Promise.resolve(snapshot("payment_expired"));
      return Promise.resolve();
    });

    renderApp();
    await openManually();
    expect(await screen.findByRole("heading", { name: "Payment expired" })).toBeInTheDocument();

    fireEvent.click(screen.getByRole("button", { name: "Back to payment" }));

    expect(await screen.findByText("Locked")).toBeInTheDocument();
    expect(screen.getByRole("heading", { name: archive.title })).toBeInTheDocument();
    expect(screen.getByText(archive.archiveId)).toBeInTheDocument();
    expect(screen.getByText(archive.fingerprint)).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Unlock for 10.00 USDC" })).toBeInTheDocument();
    expect(mocks.invoke.mock.calls.filter(([command]) => command === "close_archive")).toHaveLength(0);
    expect(mocks.invoke.mock.calls.filter(([command]) => command === "start_payment")).toHaveLength(0);
  });

  it("shows confirmed activation distinctly without claiming unlocked access", async () => {
    let activate: ((value: ViewerSnapshot) => void) | undefined;
    mocks.invoke.mockImplementation((command: string) => {
      if (["get_installer_locale", "startup_archive_pending", "take_startup_archive", "get_device_public_key"].includes(command)) {
        return defaultInvoke(command);
      }
      if (command === "open_archive") return Promise.resolve(snapshot("activating"));
      if (command === "activate_payment") return new Promise<ViewerSnapshot>((resolve) => { activate = resolve; });
      return Promise.resolve();
    });
    renderApp();
    await openManually();
    expect(await screen.findByText(/Payment confirmed/)).toBeInTheDocument();
    expect(screen.queryByTitle("Solana Pay payment QR code")).not.toBeInTheDocument();
    expect(screen.queryByText("Protected archive unlocked")).not.toBeInTheDocument();
    activate?.(snapshot("unlocked"));
    expect(await screen.findByText("Protected archive unlocked")).toBeInTheDocument();
  });

  it("uses the full-size unlocked shell and lists safe catalog fields in the file navigator", async () => {
    mocks.invoke.mockImplementation((command: string) => {
      if (["get_installer_locale", "startup_archive_pending", "take_startup_archive", "get_device_public_key"].includes(command)) {
        return defaultInvoke(command);
      }
      return Promise.resolve(snapshot("unlocked"));
    });
    renderApp();
    await openManually();
    expect(await screen.findByText("Protected archive unlocked")).toBeInTheDocument();
    expect(document.querySelector(".app-shell")).toHaveAttribute("data-viewer-state", "unlocked");
    expect(screen.getByRole("list", { name: "Protected files" })).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Open internally: a.pdf" })).toHaveAttribute("aria-pressed", "false");
    expect(screen.getByText("a.pdf")).toBeInTheDocument();
    expect(screen.getByText("PDF")).toBeInTheDocument();
    expect(screen.getByText("1.2 KB")).toBeInTheDocument();
    expect(document.body.textContent).not.toMatch(/chunk|offset|content key|ACK/i);
  });

  it("switches with compact RU and EN buttons and preserves creator metadata", async () => {
    renderApp();
    await openManually();
    expect(await screen.findByText("Locked")).toBeInTheDocument();
    const ru = screen.getByRole("button", { name: "RU" });
    const en = screen.getByRole("button", { name: "EN" });
    expect(ru).toHaveAttribute("aria-pressed", "false");
    fireEvent.click(ru);
    expect(screen.getByText("Заблокирован")).toBeInTheDocument();
    expect(screen.getByRole("heading", { name: archive.title })).toBeInTheDocument();
    expect(localStorage.getItem(LOCALE_STORAGE_KEY)).toBe("ru");
    expect(en).toHaveAttribute("aria-pressed", "false");
  });

  it("shows finite preparation progress", async () => {
    let finish: ((value: ViewerSnapshot) => void) | undefined;
    mocks.invoke.mockImplementation((command: string) => {
      if (["get_installer_locale", "startup_archive_pending", "take_startup_archive", "get_device_public_key"].includes(command)) {
        return defaultInvoke(command);
      }
      if (command === "open_archive") return Promise.resolve(snapshot("locked"));
      if (command === "start_payment") return new Promise<ViewerSnapshot>((resolve) => { finish = resolve; });
      return Promise.resolve(snapshot("unlocked"));
    });
    renderApp();
    await openManually();
    fireEvent.click(await screen.findByRole("button", { name: "Unlock for 10.00 USDC" }));
    expect(await screen.findByText("Preparing secure payment")).toBeInTheDocument();
    finish?.(snapshot("unlocked"));
    await waitFor(() => expect(screen.getByText("Protected archive unlocked")).toBeInTheDocument());
  });

  it("opens a startup file without using the manual picker", async () => {
    let finish: ((value: ViewerSnapshot | null) => void) | undefined;
    mocks.invoke.mockImplementation((command: string) => {
      if (command === "get_installer_locale") return Promise.resolve("en");
      if (command === "get_device_public_key") return Promise.resolve("public-device");
      if (command === "startup_archive_pending") return Promise.resolve(true);
      if (command === "take_startup_archive") {
        return new Promise<ViewerSnapshot | null>((resolve) => { finish = resolve; });
      }
      return Promise.resolve();
    });
    renderApp();
    expect(await screen.findByText("Verifying archive")).toBeInTheDocument();
    expect(mocks.open).not.toHaveBeenCalled();
    finish?.(snapshot("locked"));
    expect(await screen.findByRole("heading", { name: archive.title })).toBeInTheDocument();
  });

  it("reuses the existing window event path for another Explorer archive", async () => {
    renderApp();
    await screen.findByRole("button", { name: "Open archive" });
    await waitFor(() => expect(mocks.listeners.size).toBe(3));
    act(() => mocks.listeners.get("viewer://archive-open-requested")?.({ payload: {} as FileOpenEvent }));
    expect(screen.getByText("Verifying archive")).toBeInTheDocument();

    const switched = { ...snapshot("locked"), archive: { ...archive, title: "Second verified archive" } };
    act(() => mocks.listeners.get("viewer://archive-opened")?.({
      payload: { snapshot: switched, error: null },
    }));
    expect(screen.getByRole("heading", { name: "Second verified archive" })).toBeInTheDocument();
    expect(mocks.open).not.toHaveBeenCalled();
  });

  it("removes protected content and watermark immediately on Rust session expiry", async () => {
    mocks.invoke.mockImplementation((command: string) => {
      if (["get_installer_locale", "startup_archive_pending", "take_startup_archive", "get_device_public_key", "protected_session_status"].includes(command)) {
        return defaultInvoke(command);
      }
      if (command === "open_archive") return Promise.resolve(snapshot("unlocked"));
      return Promise.resolve();
    });
    renderApp();
    await openManually();
    expect(await screen.findByText("Protected archive unlocked")).toBeInTheDocument();
    expect(await screen.findByText("a.pdf")).toBeInTheDocument();
    await waitFor(() => expect(mocks.listeners.has("viewer://protected-session-expired")).toBe(true));
    act(() => mocks.listeners.get("viewer://protected-session-expired")?.({ payload: undefined }));
    expect(await screen.findByRole("heading", { name: "Refresh required" })).toBeInTheDocument();
    expect(screen.queryByText("a.pdf")).not.toBeInTheDocument();
    expect(screen.queryByTestId("watermark-overlay")).not.toBeInTheDocument();
  });
});
