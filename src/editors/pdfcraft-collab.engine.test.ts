// Two real engines, one log: the same edits in the same order must give the same document. Runs
// only when CRAFTBRIDGE_DIR points at craftbridge with its wasm built (see vite.config.ts).
import { describe, expect, it } from "vitest";
import fs from "node:fs";
import * as Y from "yjs";
import type { EditCall } from "craftbridge/pdf";
import { PdfLog } from "./pdfcraft-collab";

const dir = process.env.CRAFTBRIDGE_DIR;
const built = !!dir && fs.existsSync(`${dir}/wasm/pdf/pdfcraft_wasm_bg.wasm`);

function fixture(n: number): Uint8Array {
  const objs: string[] = ["<< /Type /Catalog /Pages 2 0 R >>"];
  const kids = Array.from({ length: n }, (_, i) => `${4 + 2 * i} 0 R`);
  objs.push(`<< /Type /Pages /Kids [${kids.join(" ")}] /Count ${n} /MediaBox [0 0 200 300] >>`);
  objs.push("<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica >>");
  for (let i = 0; i < n; i++) {
    objs.push(`<< /Type /Page /Parent 2 0 R /Contents ${5 + 2 * i} 0 R /Resources << /Font << /F1 3 0 R >> >> >>`);
    const body = `BT /F1 24 Tf 20 150 Td (Page ${i + 1}) Tj ET`;
    objs.push(`<< /Length ${body.length} >>\nstream\n${body}\nendstream`);
  }
  let out = "%PDF-1.7\n";
  const offsets: number[] = [];
  objs.forEach((o, i) => {
    offsets.push(out.length);
    out += `${i + 1} 0 obj\n${o}\nendobj\n`;
  });
  const xref = out.length;
  out += `xref\n0 ${objs.length + 1}\n0000000000 65535 f \n${offsets.map((o) => `${String(o).padStart(10, "0")} 00000 n \n`).join("")}`;
  out += `trailer\n<< /Size ${objs.length + 1} /Root 1 0 R >>\nstartxref\n${xref}\n%%EOF\n`;
  return new TextEncoder().encode(out);
}

describe.skipIf(!built)("two real engines on one log", () => {
  // one instance of the module for the whole file: each is tens of MB, and a second one has run a CI runner out of memory
  let loaded: Promise<(typeof import("craftbridge/pdf"))> | null = null;
  const load = () =>
    (loaded ??= (async () => {
      const glue = await import(/* @vite-ignore */ `${dir}/wasm/pdf/pdfcraft_wasm.js`);
      glue.initSync({ module: fs.readFileSync(`${dir}/wasm/pdf/pdfcraft_wasm_bg.wasm`) });
      const { Engine } = await import(/* @vite-ignore */ `${dir}/src/pdf/engine.ts`);
      return { glue, Engine } as never;
    })());

  async function engines() {
    const { glue, Engine } = (await load()) as unknown as { glue: { Pdf: new (b: Uint8Array, p?: string) => unknown }; Engine: new (m: unknown) => unknown };
    const make = () => {
      const engine = new Engine({ open: (bytes: Uint8Array, password?: string) => new glue.Pdf(bytes, password) });
      (engine as { handle(call: unknown): unknown }).handle({ op: "open", bytes: fixture(2) });
      return engine as { handle(call: unknown): { value: unknown } };
    };
    return make;
  }

  const wire = (a: Y.Doc, b: Y.Doc) => {
    let online = true;
    const queue: Array<() => void> = [];
    const link = (from: Y.Doc, to: Y.Doc) =>
      from.on("update", (u: Uint8Array, origin: unknown) => {
        if (origin === "remote") return;
        const send = () => Y.applyUpdate(to, u, "remote");
        if (online) send();
        else queue.push(send);
      });
    link(a, b);
    link(b, a);
    return {
      offline: () => (online = false),
      online: () => {
        online = true;
        while (queue.length) queue.shift()!();
      },
    };
  };

  /** What a person would see of a document: its pages and each page's objects and pixels. */
  const look = (engine: { handle(call: unknown): { value: unknown } }) => {
    const info = engine.handle({ op: "info" }).value as { pageCount: number };
    const pages = [];
    for (let i = 0; i < info.pageCount; i++) {
      const objects = engine.handle({ op: "objects", page: i }).value;
      const size = engine.handle({ op: "pageSize", page: i }).value;
      const px = engine.handle({ op: "render", page: i, scale: 1 }).value as { rgba: Uint8Array };
      pages.push({ objects, size, pixels: Array.from(px.rgba.subarray(0, 8000)).join(",") });
    }
    return { count: info.pageCount, pages };
  };

  async function twoPeers() {
    const make = await engines();
    const a = new Y.Doc();
    const b = new Y.Doc();
    const link = wire(a, b);
    const mk = (doc: Y.Doc) => {
      const engine = make();
      const log = new PdfLog({ doc, readOnly: false }, { run: async (call: EditCall) => void engine.handle(call), undo: async () => void engine.handle({ op: "undo" }) }, () => {});
      return { engine, log };
    };
    const p = mk(a);
    const q = mk(b);
    await p.log.start();
    await q.log.start();
    return { p, q, link };
  }

  it("gives both peers the same document after concurrent text and page edits", async () => {
    const { p, q, link } = await twoPeers();
    link.offline();
    await p.log.perform({ op: "addText", page: 0, view: [20, 40, 180, 70], text: "from p" });
    await p.log.perform({ op: "rotatePages", pages: [1], degrees: 90 });
    await q.log.perform({ op: "addText", page: 0, view: [20, 120, 180, 150], text: "from q" });
    await q.log.perform({ op: "insertBlankPage", at: 1, width: 200, height: 300 });
    link.online();
    await p.log.settled();
    await q.log.settled();
    const lp = look(p.engine);
    const lq = look(q.engine);
    expect(lp).toEqual(lq);
    expect(lp.count).toBe(3);
    const texts = (lp.pages[0]!.objects as { text: string | null }[]).map((o) => o.text);
    expect(texts).toEqual(expect.arrayContaining(["from p", "from q"]));
  });

  it("keeps them together through moves, restyling, marks and one peer's undo", async () => {
    const { p, q, link } = await twoPeers();
    await p.log.perform({ op: "moveObjects", page: 0, targets: [{ kind: "text", index: 0 }], dx: 0, dy: 30 });
    link.offline();
    await p.log.perform({ op: "setText", page: 0, target: { kind: "text", index: 0 }, style: { bold: true, size: 30 } });
    await q.log.perform({ op: "cover", page: 1, view: [0, 0, 100, 100] });
    await q.log.perform({ op: "addLink", page: 0, view: [10, 10, 80, 30], target: "https://example.com" });
    link.online();
    await p.log.settled();
    await q.log.settled();
    expect(look(p.engine)).toEqual(look(q.engine));
    await p.log.undo();
    await q.log.settled();
    await p.log.settled();
    expect(look(p.engine)).toEqual(look(q.engine));
    await q.log.undo();
    await p.log.settled();
    await q.log.settled();
    expect(look(p.engine)).toEqual(look(q.engine));
  });
});
