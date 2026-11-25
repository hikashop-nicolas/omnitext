// @vitest-environment happy-dom
import { beforeEach, describe, expect, it, vi } from "vitest";

// The spreadsheet takes its regional conventions (decimal comma, French function names) from
// the app's language, so the grid reads the way the rest of Omnitext does, unless the settings
// keep formulas and numbers English.
const calls = vi.hoisted(() => ({ locale: [] as string[], regional: [] as (string | null)[] }));
vi.mock("sheetedit", () => ({
  createSheetEditorAsync: () => new Promise(() => {}),
  setLocale: (code: string) => calls.locale.push(code),
  setRegionalLocale: (code: string | null) => calls.regional.push(code),
}));
vi.mock("../i18n", async (orig) => ({ ...(await orig<typeof import("../i18n")>()), getLocale: () => "fr" }));

const mount = async () => {
  const { sheetEditor } = await import("./sheet.impl");
  sheetEditor.create({} as never).mount(document.createElement("div"), {
    text: "", bytes: new Uint8Array(), binary: true, filename: "a.xlsx", model: null, format: null, view: "sheet", onChange: () => {},
  } as never);
};

describe("the sheet editor", () => {
  beforeEach(() => {
    calls.locale.length = 0;
    calls.regional.length = 0;
    localStorage.clear();
  });

  it("hands the app's language to sheetedit before the workbook opens", async () => {
    await mount();
    expect(calls.locale).toEqual(["fr"]);
    expect(calls.regional).toEqual([null]); // conventions follow that language
  });

  it("keeps English formulas and numbers when the settings say so", async () => {
    const { saveSettings } = await import("../settings");
    saveSettings({ sheetFormulas: "en" });
    await mount();
    expect(calls.locale).toEqual(["fr"]); // the editor's own words stay French
    expect(calls.regional).toEqual(["en"]);
  });
});
