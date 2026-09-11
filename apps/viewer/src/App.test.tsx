import { act, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { vi } from "vitest";

import App from "./App";
import { I18nProvider, LOCALE_STORAGE_KEY } from "./i18n";
import type { FileOpenEvent, ViewerSnapshot, ViewerState } from "./ipc";

type EventCallback = (event: { payload: FileOpenEvent }) => void;
const mocks = vi.hoisted(() => ({
  invoke: vi.fn(),
  open: vi.fn(),
  listeners: new Map<string, EventCallback>(),
}));

vi.mock("@tauri-apps/api/core", () => ({ invoke: mocks.invoke }));
vi.mock("@tauri-apps/api/event", () => ({
  listen: vi.fn((name: string, callback: EventCallback) => {
    mocks.listeners.set(name, callback);
    return Promise.resolve(() => mocks.listeners.delete(name));
  }),
}));
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

const qr = "solana:https://api.solarch.example/v1/solana-pay/payment-intents/pi_test_01/transaction";
const payment = {
  state: "payment_ready" as const,
  paymentIntentId: "pi_test_01",
  amount: "10.00",
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
  if (command === "open_archive") return Promise.resolve(snapshot("locked"));
  return Promise.reject(new Error(`unexpected command ${command}`));
}

beforeEach(() => {
  localStorage.clear();
  mocks.invoke.mockReset();
  mocks.open.mockReset();
  mocks.listeners.clear();
  mocks.invoke.mockImplementation(defaultInvoke);
  mocks.open.mockResolvedValue("C:\\fixtures\\vector.slr");
});

afterEach(() => {
  vi.useRealTimers();
});

describe("Viewer Part 03 state machine and desktop shell", () => {
  it("opens to trusted Locked metadata with no wallet, export, or device-key controls", async () => {
    renderApp();
    await openManually();
    expect(await screen.findByText("Locked")).toBeInTheDocument();
    expect(screen.getByRole("heading", { name: archive.title })).toBeInTheDocument();
    expect(screen.queryByRole("textbox")).not.toBeInTheDocument();
    expect(screen.queryByText(/save as|open external|extract/i)).not.toBeInTheDocument();
    expect(screen.queryByText("public-device-value-that-must-not-render")).not.toBeInTheDocument();
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
    fireEvent.click(await screen.findByRole("button", { name: "Unlock for 10.000000 USDC" }));
    expect(await screen.findByTitle("Solana Pay payment QR code")).toBeInTheDocument();
    expect(document.querySelector("[data-qr-value]")).toHaveAttribute("data-qr-value", qr);
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

  it("lists safe catalog fields in a file table after durable unlock", async () => {
    mocks.invoke.mockImplementation((command: string) => {
      if (["get_installer_locale", "startup_archive_pending", "take_startup_archive", "get_device_public_key"].includes(command)) {
        return defaultInvoke(command);
      }
      return Promise.resolve(snapshot("unlocked"));
    });
    renderApp();
    await openManually();
    expect(await screen.findByText("Protected archive unlocked")).toBeInTheDocument();
    expect(screen.getByRole("columnheader", { name: "Name" })).toBeInTheDocument();
    expect(screen.getByRole("columnheader", { name: "Type" })).toBeInTheDocument();
    expect(screen.getByRole("columnheader", { name: "Size" })).toBeInTheDocument();
    expect(screen.getByText("a.pdf")).toBeInTheDocument();
    expect(screen.getByText("PDF")).toBeInTheDocument();
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
    fireEvent.click(await screen.findByRole("button", { name: "Unlock for 10.000000 USDC" }));
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
    await waitFor(() => expect(mocks.listeners.size).toBe(2));
    act(() => mocks.listeners.get("viewer://archive-open-requested")?.({ payload: {} as FileOpenEvent }));
    expect(screen.getByText("Verifying archive")).toBeInTheDocument();

    const switched = { ...snapshot("locked"), archive: { ...archive, title: "Second verified archive" } };
    act(() => mocks.listeners.get("viewer://archive-opened")?.({
      payload: { snapshot: switched, error: null },
    }));
    expect(screen.getByRole("heading", { name: "Second verified archive" })).toBeInTheDocument();
    expect(mocks.open).not.toHaveBeenCalled();
  });
});
