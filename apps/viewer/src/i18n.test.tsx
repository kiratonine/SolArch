import { fireEvent, render, screen } from "@testing-library/react";

import { en, I18nProvider, LOCALE_STORAGE_KEY, resolveInitialLocale, ru, useI18n } from "./i18n";

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

describe("i18n foundation", () => {
  it("keeps complete RU and EN key parity", () => {
    expect(Object.keys(ru).sort()).toEqual(Object.keys(en).sort());
    for (const key of Object.keys(en) as Array<keyof typeof en>) {
      expect(en[key].trim()).not.toBe("");
      expect(ru[key].trim()).not.toBe("");
    }
  });

  it("switches at runtime and persists the preference", () => {
    render(<I18nProvider><Probe /></I18nProvider>);
    expect(screen.getByText("Open a SolArch archive")).toBeInTheDocument();
    fireEvent.click(screen.getByRole("button", { name: "switch" }));
    expect(screen.getByText("Откройте архив SolArch")).toBeInTheDocument();
    expect(localStorage.getItem(LOCALE_STORAGE_KEY)).toBe("ru");
    expect(document.documentElement.lang).toBe("ru");
  });

  it("supports a future installer locale without redesign", () => {
    expect(resolveInitialLocale(null, "ru", "en-US")).toBe("ru");
    expect(resolveInitialLocale("en", "ru", "ru-RU")).toBe("en");
    expect(resolveInitialLocale(null, null, "de-DE")).toBe("en");
  });
});
