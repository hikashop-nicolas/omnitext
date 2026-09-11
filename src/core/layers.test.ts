import { describe, expect, it } from "vitest";
import { readFileSync, readdirSync, statSync } from "node:fs";
import { join } from "node:path";

// The app's own dialogs have to come out on top of whatever the editor underneath is showing. They
// did not: the modal sat at z-index 10 while sheetedit's cell float bar is at 40 and richdoc's
// dialogs at 1000, so opening Settings over a spreadsheet left a cell toolbar lying across it.
// This reads the numbers rather than trusting them: an editor that ships a higher layer in a future
// version fails here instead of quietly climbing over the settings dialog.

const zOf = (css: string, selector: string): number => {
  const at = css.indexOf(selector);
  expect(at, `${selector} is in app.css`).toBeGreaterThan(-1);
  const block = css.slice(at, css.indexOf("}", at));
  const m = /z-index:\s*(\d+)/.exec(block);
  expect(m, `${selector} sets a z-index`).toBeTruthy();
  return Number(m![1]);
};

/** Every z-index any bundled editor ships, from its CSS files and its inlined style strings. */
function editorLayers(): { file: string; z: number }[] {
  const out: { file: string; z: number }[] = [];
  const walk = (dir: string): void => {
    for (const name of readdirSync(dir)) {
      const p = join(dir, name);
      if (statSync(p).isDirectory()) {
        walk(p);
        continue;
      }
      if (!/\.(css|js)$/.test(name)) continue;
      const text = readFileSync(p, "utf8");
      for (const m of text.matchAll(/z-index:\s*(\d+)/g)) out.push({ file: p, z: Number(m[1]) });
    }
  };
  for (const lib of ["sheetedit", "richdoc", "pdfedit", "geoedit", "mediaplay", "subedit", "imageview"]) {
    const dist = join("node_modules", lib, "dist");
    try {
      if (statSync(dist).isDirectory()) walk(dist);
    } catch {
      /* a lib that is not installed in this checkout is not a failure */
    }
  }
  return out;
}

describe("what the app draws over the editor", () => {
  const css = readFileSync("src/app.css", "utf8");

  it("puts its dialogs above every layer the editors ship", () => {
    const layers = editorLayers();
    expect(layers.length, "the editor libs were found and read").toBeGreaterThan(10);
    const top = layers.reduce((a, b) => (b.z > a.z ? b : a));
    expect(zOf(css, ".modal {"), `above ${top.z} in ${top.file}`).toBeGreaterThan(top.z);
  });

  it("keeps the toast readable over its own dialogs", () => {
    expect(zOf(css, ".toast {")).toBeGreaterThan(zOf(css, ".modal {"));
  });

  it("keeps the side panel under the dialogs", () => {
    expect(zOf(css, ".panel {")).toBeLessThan(zOf(css, ".modal {"));
  });
});
