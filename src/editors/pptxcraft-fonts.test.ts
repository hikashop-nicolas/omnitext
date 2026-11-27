// @vitest-environment happy-dom
import { afterEach, describe, expect, it, vi } from "vitest";
import { SlideFonts } from "./pptxcraft-fonts";

/** A one-table sfnt whose name table says `family`. */
function sfnt(family: string): Uint8Array {
  const name = new Uint8Array(6 + 12 + family.length * 2);
  const nv = new DataView(name.buffer);
  nv.setUint16(2, 1);
  nv.setUint16(4, 18);
  nv.setUint16(6, 3);
  nv.setUint16(8, 1);
  nv.setUint16(10, 0x409);
  nv.setUint16(12, 1);
  nv.setUint16(14, family.length * 2);
  for (let i = 0; i < family.length; i++) nv.setUint16(18 + i * 2, family.charCodeAt(i));
  const b = new Uint8Array(12 + 16 + name.length);
  const v = new DataView(b.buffer);
  v.setUint32(0, 0x00010000);
  v.setUint16(4, 1);
  b.set([..."name"].map((c) => c.charCodeAt(0)), 12);
  v.setUint32(12 + 8, 28);
  v.setUint32(12 + 12, name.length);
  b.set(name, 28);
  return b;
}

afterEach(() => { vi.restoreAllMocks(); document.body.replaceChildren(); });

describe("the slide font picker", () => {
  it("loads a font file and hands its bytes to the engine", async () => {
    const root = document.createElement("div");
    document.body.appendChild(root);
    const addFont = vi.fn(async () => true);
    const redraw = vi.fn();
    const fonts = new SlideFonts({ root, addFont, used: async () => [], redraw, confirm: async () => false });
    const apply = vi.fn();
    fonts.sync("Inter", false, false, apply);
    const entry = [...fonts.select.options].find((o) => o.value.endsWith("file"))!;
    expect(entry.textContent).toBe("Load a font file…");
    let input: HTMLInputElement | null = null;
    vi.spyOn(HTMLInputElement.prototype, "click").mockImplementation(function (this: HTMLInputElement) { input = this; });
    fonts.select.value = entry.value;
    fonts.select.dispatchEvent(new Event("change"));
    expect(input!.type).toBe("file");
    const bytes = sfnt("Slide Hand");
    Object.defineProperty(input!, "files", { value: [new File([bytes as BlobPart], "hand.ttf")] });
    input!.dispatchEvent(new Event("change"));
    await vi.waitFor(() => expect(redraw).toHaveBeenCalled());
    expect(apply).toHaveBeenCalledWith("Slide Hand");
    expect(addFont).toHaveBeenCalledWith(bytes);
    expect(fonts.select.value).toBe("Slide Hand");
    fonts.dispose();
  });

  it("hands a loaded font file over for embedding, each face once", async () => {
    const root = document.createElement("div");
    document.body.appendChild(root);
    const fonts = new SlideFonts({ root, addFont: async () => true, used: async () => [], redraw: () => undefined, confirm: async () => false });
    let input: HTMLInputElement | null = null;
    vi.spyOn(HTMLInputElement.prototype, "click").mockImplementation(function (this: HTMLInputElement) { input = this; });
    fonts.sync("Inter", false, false, () => undefined);
    fonts.select.value = [...fonts.select.options].find((o) => o.value.endsWith("file"))!.value;
    fonts.select.dispatchEvent(new Event("change"));
    const bytes = sfnt("Embed Hand");
    Object.defineProperty(input!, "files", { value: [new File([bytes as BlobPart], "embed.ttf")] });
    input!.dispatchEvent(new Event("change"));
    await vi.waitFor(() => expect(fonts.select.value).toBe("Embed Hand"));
    const files = await fonts.embedFiles("Embed Hand");
    // A regular file stands in for no other face.
    expect(Object.keys(files.faces)).toEqual(["regular"]);
    expect(files.faces.regular).toEqual(bytes);
    expect(files.restricted).toBe(false);
    expect(await fonts.embedFiles("No Such Family")).toEqual({ faces: {}, restricted: false });
    fonts.dispose();
  });
});
