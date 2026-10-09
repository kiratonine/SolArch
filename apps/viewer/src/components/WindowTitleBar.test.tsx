import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { vi } from "vitest";

import { I18nProvider, LOCALE_STORAGE_KEY } from "../i18n";
import { WindowTitleBar } from "./WindowTitleBar";

const mocks = vi.hoisted(() => ({
  isMaximized: vi.fn(),
  onResized: vi.fn(),
  minimize: vi.fn(),
  toggleMaximize: vi.fn(),
  close: vi.fn(),
  unlisten: vi.fn(),
}));

vi.mock("@tauri-apps/api/window", () => ({
  getCurrentWindow: () => ({
    isMaximized: mocks.isMaximized,
    onResized: mocks.onResized,
    minimize: mocks.minimize,
    toggleMaximize: mocks.toggleMaximize,
    close: mocks.close,
  }),
}));

beforeEach(() => {
  localStorage.setItem(LOCALE_STORAGE_KEY, "en");
  vi.clearAllMocks();
  mocks.isMaximized.mockResolvedValue(false);
  mocks.onResized.mockResolvedValue(mocks.unlisten);
  mocks.minimize.mockResolvedValue(undefined);
  mocks.toggleMaximize.mockResolvedValue(undefined);
  mocks.close.mockResolvedValue(undefined);
});

it("exposes a noninteractive drag region and calls the exact Tauri window actions", async () => {
  const view = render(<I18nProvider><WindowTitleBar /></I18nProvider>);
  expect(await screen.findByRole("banner", { name: "Application window" })).toBeInTheDocument();
  expect(document.querySelector(".window-titlebar-drag")).toHaveAttribute("data-tauri-drag-region");
  expect(screen.getByRole("button", { name: "Minimize window" })).not.toHaveAttribute("data-tauri-drag-region");

  fireEvent.click(screen.getByRole("button", { name: "Minimize window" }));
  fireEvent.click(screen.getByRole("button", { name: "Maximize window" }));
  fireEvent.click(screen.getByRole("button", { name: "Close window" }));

  expect(mocks.minimize).toHaveBeenCalledTimes(1);
  expect(mocks.toggleMaximize).toHaveBeenCalledTimes(1);
  expect(mocks.close).toHaveBeenCalledTimes(1);
  view.unmount();
  await waitFor(() => expect(mocks.unlisten).toHaveBeenCalledTimes(1));
});

it("updates maximize state, localizes labels, and contains rejected window promises", async () => {
  localStorage.setItem(LOCALE_STORAGE_KEY, "ru");
  mocks.isMaximized.mockResolvedValue(true);
  mocks.minimize.mockRejectedValue(new Error("unavailable"));
  mocks.toggleMaximize.mockRejectedValue(new Error("unavailable"));
  mocks.close.mockRejectedValue(new Error("unavailable"));

  render(<I18nProvider><WindowTitleBar /></I18nProvider>);
  const restore = await screen.findByRole("button", { name: "Восстановить окно" });
  fireEvent.click(screen.getByRole("button", { name: "Свернуть окно" }));
  fireEvent.click(restore);
  fireEvent.click(screen.getByRole("button", { name: "Закрыть окно" }));
  await waitFor(() => expect(mocks.close).toHaveBeenCalledTimes(1));
});
