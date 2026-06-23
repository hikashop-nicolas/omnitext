import { describe, expect, it } from "vitest";
import { makeTextFormats, TEXT_FORMAT_TABLE } from "./codemirror-formats";

// Extensions/ids owned by the primary formats registered in main.ts; the long-tail table
// must not collide with these (collisions would make resolution ambiguous).
const RESERVED_EXTS = new Set([
  ".json", ".json5", ".md", ".markdown", ".csv", ".tsv", ".yaml", ".yml", ".xml",
  ".toml", ".ini", ".html", ".htm", ".css", ".js", ".mjs", ".cjs", ".jsx", ".ts",
  ".tsx", ".py", ".sql", ".sh", ".bash", ".env", ".properties", ".pdf", ".odt",
  ".docx", ".ods", ".xlsx", ".xls",
]);
const RESERVED_IDS = new Set([
  "json", "json5", "markdown", "csv", "tsv", "yaml", "xml", "toml", "ini", "html",
  "css", "javascript", "typescript", "python", "sql", "shell", "dotenv", "properties",
  "pdf", "odt", "docx", "ods", "xlsx", "xls", "codemirror", "table", "tree", "preview",
]);

describe("codemirror long-tail formats", () => {
  it("has unique ids that do not collide with primary formats", () => {
    const ids = TEXT_FORMAT_TABLE.map((f) => f.id);
    expect(new Set(ids).size).toBe(ids.length); // no internal dupes
    for (const id of ids) expect(RESERVED_IDS.has(id)).toBe(false);
  });

  it("has unique extensions that do not collide with primary formats", () => {
    const seen = new Set<string>();
    for (const f of TEXT_FORMAT_TABLE) {
      for (const ext of f.exts) {
        expect(RESERVED_EXTS.has(ext), `reserved ext ${ext}`).toBe(false);
        expect(seen.has(ext), `duplicate ext ${ext}`).toBe(false);
        seen.add(ext);
      }
    }
  });

  it("builds descriptors that resolve a CodeMirror format module", async () => {
    const byId = new Map(makeTextFormats().map((d) => [d.manifest.id, d]));
    // A highlighted format yields a language() extension.
    const rust = await byId.get("rust")!.load();
    expect(typeof rust.language).toBe("function");
    expect(rust.language!()).toBeTruthy();
    expect(rust.parse("fn main(){}").model).toBe("fn main(){}");
    // A plain format has no language() but still round-trips text.
    const log = await byId.get("log")!.load();
    expect(log.language).toBeUndefined();
    expect(log.serialize("a\nb")).toBe("a\nb");
    // Another highlighted one (the textile markup mode) resolves too.
    const textile = await byId.get("textile")!.load();
    expect(textile.language!()).toBeTruthy();
  });
});
