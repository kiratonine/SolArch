import { StrictMode, type ReactNode } from "react";
import { createRoot } from "react-dom/client";

import App from "./App";
import { I18nProvider } from "./i18n";
import "./styles.css";

const root = document.getElementById("root");
if (!root) throw new Error("Application root is missing");

function render(devPanel: ReactNode = null) {
  createRoot(root!).render(
    <StrictMode>
      <I18nProvider><App /></I18nProvider>
      {devPanel}
    </StrictMode>,
  );
}

// `vite dev` opened in a plain browser has no desktop shell: stand in a mock backend
// so every screen can be previewed. Production builds drop this branch entirely.
if (import.meta.env.DEV && !("__TAURI_INTERNALS__" in window)) {
  void Promise.all([import("./dev/mockDesktop"), import("./dev/DevPanel")]).then(
    ([{ installMockDesktop }, { DevPanel }]) => {
      installMockDesktop();
      render(<DevPanel />);
    },
  );
} else {
  render();
}
