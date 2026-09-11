import { fireEvent, render, screen } from "@testing-library/react";
import { vi } from "vitest";

import { en, I18nProvider, LOCALE_STORAGE_KEY, resolveInitialLocale, ru, useI18n } from "./i18n";

const mocks = vi.hoisted(() => ({ invoke: vi.fn() }));
vi.mock("@tauri-apps/api/core", () => ({ invoke: mocks.invoke }));

function Probe() {
  const { locale, setLocale, t } = useI18n();
  return (
    <div>
      <span>{locale}</span>
      <span>{t("idle.title")}</span>
      <button type="button" onClick={() => setLocale("ru")}>switch</button>
    </div>
  );
}

beforeEach(() => {
  localStorage.clear();
  mocks.invoke.mockReset();
  mocks.invoke.mockResolvedValue("en");
});

describe("i18n foundation", () => {
  it("keeps complete RU and EN key parity", () => {
    expect(Object.keys(ru).sort()).toEqual(Object.keys(en).sort());
    for (const key of Object.keys(en) as Array<keyof typeof en>) {
      expect(en[key].trim()).not.toBe("");
      expect(ru[key].trim()).not.toBe("");
    }
  });

  it("switches at runtime and persists the preference", async () => {
    render(<I18nProvider><Probe /></I18nProvider>);
    expect(await screen.findByText("Open a .slr archive")).toBeInTheDocument();
    fireEvent.click(screen.getByRole("button", { name: "switch" }));
    expect(screen.getByText("Откройте архив .slr")).toBeInTheDocument();
    expect(localStorage.getItem(LOCALE_STORAGE_KEY)).toBe("ru");
    expect(document.documentElement.lang).toBe("ru");
  });

  it("uses the NSIS-selected locale on first launch", async () => {
    mocks.invoke.mockResolvedValue("ru");
    render(<I18nProvider><Probe /></I18nProvider>);
    expect(await screen.findByText("Откройте архив .slr")).toBeInTheDocument();
    expect(localStorage.getItem(LOCALE_STORAGE_KEY)).toBe("ru");
    expect(document.documentElement.lang).toBe("ru");
  });

  it("keeps a later Viewer preference independent from the installer locale", () => {
    expect(resolveInitialLocale(null, "ru", "en-US")).toBe("ru");
    expect(resolveInitialLocale("en", "ru", "ru-RU")).toBe("en");
    expect(resolveInitialLocale(null, null, "de-DE")).toBe("en");
  });
});
