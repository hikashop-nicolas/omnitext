import { describe, expect, it } from "vitest";
import { printDocument, type PrintHost } from "./print";

function host(): PrintHost & { log: string[]; finish(): void } {
  const log: string[] = [];
  let after: (() => void) | null = null;
  return {
    log,
    fill: (sheet) => log.push(sheet ? "fill" : "clear"),
    useSheet: (on) => log.push(on ? "useSheet" : "useEditor"),
    print: () => log.push("print"),
    onceAfterPrint: (cb) => void (after = cb),
    finish: () => after?.(),
  };
}

const sheet = (): HTMLElement => ({ tagName: "PRE" }) as HTMLElement;

describe("printDocument", () => {
  it("prints the live surface when the editor renders the whole document", () => {
    const h = host();
    printDocument(null, h);
    expect(h.log).toEqual(["print"]);
  });

  it("swaps in the full rendering before printing", () => {
    const h = host();
    printDocument(sheet(), h);
    expect(h.log).toEqual(["fill", "useSheet", "print"]);
  });

  // Left in place, the sheet is a copy of the document as it was at the last print, shown
  // instead of the editor the next time. Clearing it is the whole reason for the callback.
  it("takes the rendering back out once printing is over", () => {
    const h = host();
    printDocument(sheet(), h);
    h.finish();
    expect(h.log).toEqual(["fill", "useSheet", "print", "clear", "useEditor"]);
  });

  it("registers no cleanup when there was nothing to swap in", () => {
    const h = host();
    printDocument(null, h);
    h.finish();
    expect(h.log).toEqual(["print"]);
  });
});
