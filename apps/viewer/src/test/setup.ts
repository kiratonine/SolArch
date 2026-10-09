import "@testing-library/jest-dom/vitest";
import { afterEach } from "vitest";

afterEach(() => {
  document.documentElement.removeAttribute("lang");
  document.documentElement.removeAttribute("data-installer-locale");
  localStorage.clear();
});
