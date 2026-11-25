// @vitest-environment happy-dom
import { describe, expect, it, vi } from "vitest";

// The spreadsheet takes its regional conventions (decimal comma, French function names) from
// the app's language, so the grid reads the way the rest of Omnitext does.
const calls = vi.hoisted(() => ({ locale: [] as string[] }));
vi.mock("sheetedit", () => ({
  createSheetEditorAsync: () => new Promise(() => {}),
  setLocale: (code: string) => calls.locale.push(code),
}));
vi.mock("../i18n", async (orig) => ({ ...(await orig<typeof import("../i18n")>()), getLocale: () => "fr" }));

describe("the sheet editor", () => {
  it("hands the app's language to sheetedit before the workbook opens", async () => {
    const { sheetEditor } = await import("./sheet.impl");
    const inst = sheetEditor.create({} as never);
    inst.mount(document.createElement("div"), {
      text: "",
      bytes: new Uint8Array(),
      binary: true,
      filename: "a.xlsx",
      model: null,
      format: null,
      view: "sheet",
      onChange: () => {},
    } as never);
    expect(calls.locale).toEqual(["fr"]);
  });
});
