// @vitest-environment happy-dom
import { beforeEach, describe, expect, it, vi } from "vitest";
import { saveSettings } from "./settings";
import { applyDocumentCanvas } from "./settings-dialog";

const osDark = (on: boolean) => vi.stubGlobal("matchMedia", (q: string) => ({ matches: on && q.includes("dark"), addEventListener() {}, removeEventListener() {} }));
const marks = () => [document.documentElement.dataset.docCanvas, document.documentElement.dataset.sheetCanvas];

describe("dark document pages", () => {
  beforeEach(() => { localStorage.clear(); osDark(false); applyDocumentCanvas(); });

  it("shows documents as authored by default, even in dark mode", () => {
    saveSettings({ theme: "dark" });
    applyDocumentCanvas();
    expect(marks()).toEqual([undefined, undefined]);
  });

  it("darkens document pages and the sheet grid when asked, while the app is dark", () => {
    saveSettings({ theme: "dark", darkDocuments: true });
    applyDocumentCanvas();
    expect(marks()).toEqual(["dark", "dark"]);
    saveSettings({ theme: "light" });
    applyDocumentCanvas();
    expect(marks()).toEqual([undefined, undefined]); // a light app keeps pages light
  });

  it("follows the system theme", () => {
    saveSettings({ theme: "system", darkDocuments: true });
    osDark(true);
    applyDocumentCanvas();
    expect(marks()).toEqual(["dark", "dark"]);
    osDark(false);
    applyDocumentCanvas();
    expect(marks()).toEqual([undefined, undefined]);
  });
});
