import { describe, it, expect } from "vitest";
import { OmnitextEngine } from "./engine";
import { csvFormat } from "../formats/csv/index";
import { csvImpl } from "../formats/csv/impl";
import type { EditorDescriptor, EditorInstance, TableView } from "./types";

// A headless fake editor descriptor (no DOM) so we can test wiring without CodeMirror.
function fakeEditor(id: string, views: string[]): EditorDescriptor {
  return {
    manifest: { kind: "editor", id, consumesViews: views },
    load: async () => ({
      create: (): EditorInstance => ({
        mount() {},
        getText: () => "",
        selection: () => null,
        focus() {},
        dispose() {},
      }),
    }),
  };
}

describe("engine wiring", () => {
  it("detects by extension with a strong prior", () => {
    const e = new OmnitextEngine({ fallbackEditorId: "text" });
    e.registerFormat(csvFormat);
    const hit = e.detect({ filename: "data.csv", sample: "irrelevant" });
    expect(hit?.descriptor.manifest.id).toBe("csv");
    expect(hit!.confidence).toBeGreaterThanOrEqual(0.95);
  });

  it("detects by content when no filename is given", () => {
    const e = new OmnitextEngine({ fallbackEditorId: "text" });
    e.registerFormat(csvFormat);
    const hit = e.detect({ sample: "a,b\nc,d\n" });
    expect(hit?.descriptor.manifest.id).toBe("csv");
  });

  it("resolves CSV to a generic table editor when one is registered", () => {
    const e = new OmnitextEngine({ fallbackEditorId: "text" });
    e.registerEditor(fakeEditor("text", ["text"]));
    e.registerEditor(fakeEditor("table", ["table"]));
    e.registerFormat(csvFormat);
    const r = e.resolve(csvFormat);
    expect(r.editor.manifest.id).toBe("table");
    expect(r.view).toBe("table");
    expect(r.reason).toBe("view");
  });

  it("falls back to the text editor when no view editor exists", () => {
    const e = new OmnitextEngine({ fallbackEditorId: "text" });
    e.registerEditor(fakeEditor("text", ["text"]));
    e.registerFormat(csvFormat);
    const r = e.resolve(csvFormat);
    expect(r.editor.manifest.id).toBe("text");
    expect(r.reason).toBe("fallback");
  });

  it("a user override beats native/view resolution", () => {
    const e = new OmnitextEngine({
      fallbackEditorId: "text",
      preferredByFormat: { csv: "text" },
    });
    e.registerEditor(fakeEditor("text", ["text"]));
    e.registerEditor(fakeEditor("table", ["table"]));
    e.registerFormat(csvFormat);
    expect(e.resolve(csvFormat).editor.manifest.id).toBe("text");
  });

  it("editorChoices lists every compatible editor, best fidelity first", () => {
    const e = new OmnitextEngine({ fallbackEditorId: "text" });
    e.registerEditor(fakeEditor("text", ["text"]));
    e.registerEditor(fakeEditor("table", ["table"]));
    e.registerFormat(csvFormat);
    const ids = e.editorChoices(csvFormat).map((c) => c.editor.manifest.id);
    expect(ids).toEqual(["table", "text"]); // view adapter first, text fallback last
  });
});

describe("CSV format behavior (the lazy impl)", () => {
  it("round-trips an unedited CSV byte-for-byte", () => {
    const text = "id,name\r\n1,alice\r\n2,bob\r\n";
    expect(csvImpl.serialize(csvImpl.parse(text).model)).toBe(text);
  });

  it("projects to a table view and reconciles a cell edit, untouched rows intact", () => {
    const text = "id,name\n1,alice\n2,bob\n";
    const model = csvImpl.parse(text).model;
    const view = csvImpl.toView!(model, "table") as TableView;
    expect(view.rows).toEqual([
      ["id", "name"],
      ["1", "alice"],
      ["2", "bob"],
    ]);
    const edited = csvImpl.applyViewEdit!(model, { type: "cell", row: 1, col: 1, value: "ALICE" });
    expect(csvImpl.serialize(edited)).toBe("id,name\n1,ALICE\n2,bob\n");
  });
});
