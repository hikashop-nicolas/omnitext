import { describe, expect, it } from "vitest";
import { printDocument, type PrintHost } from "./print";

function host(printImpl?: () => Promise<void>): PrintHost & { log: string[] } {
  const log: string[] = [];
  return {
    log,
    fill: (sheet) => log.push(sheet ? "fill" : "clear"),
    useSheet: (on) => log.push(on ? "useSheet" : "useEditor"),
    print: async () => {
      log.push("print");
      if (printImpl) await printImpl();
    },
  };
}

const sheet = (): HTMLElement => ({ tagName: "PRE" }) as HTMLElement;

describe("printDocument", () => {
  it("prints the live surface when the editor renders the whole document", async () => {
    const h = host();
    await printDocument(null, h);
    expect(h.log).toEqual(["print"]);
  });

  it("swaps in the full rendering, then takes it back out", async () => {
    const h = host();
    await printDocument(sheet(), h);
    expect(h.log).toEqual(["fill", "useSheet", "print", "clear", "useEditor"]);
  });

  // The sheet has to outlive the print call itself. Android reads the page after the call
  // returns, so clearing early would print an empty document.
  it("keeps the rendering up until printing says it is finished", async () => {
    let finish!: () => void;
    const h = host(() => new Promise<void>((res) => (finish = res)));
    const done = printDocument(sheet(), h);
    await Promise.resolve();
    expect(h.log).toEqual(["fill", "useSheet", "print"]); // not cleared yet
    finish();
    await done;
    expect(h.log).toEqual(["fill", "useSheet", "print", "clear", "useEditor"]);
  });

  // A cancelled print still has to put the editor back, or the next one shows the old copy.
  it("takes the rendering back out even when printing fails", async () => {
    const h = host(() => Promise.reject(new Error("cancelled")));
    await expect(printDocument(sheet(), h)).rejects.toThrow("cancelled");
    expect(h.log).toEqual(["fill", "useSheet", "print", "clear", "useEditor"]);
  });
});
