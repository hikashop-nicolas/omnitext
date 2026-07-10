import { info, files as torrentFiles } from "@ctrl/torrent-file";
import type { EditorInstance, EditorModule, EditorMountContext } from "../core/types";

// Read-only viewer for .torrent metadata files (@ctrl/torrent-file, a Buffer-free
// bencode decoder that runs in the browser). It shows the torrent's name, size, tracker
// list, file tree and info-hash. A .torrent holds only metadata, so there is nothing to
// download and nothing leaves the device.
//
// The library's own hash helpers use Node's crypto, which is absent in the browser, so
// we compute the v1 info-hash ourselves: SHA-1 (via Web Crypto) over the raw bencoded
// "info" dictionary, whose byte span we locate with a tiny bencode scanner.

const STYLE_ID = "omnitext-torrent-style";

function ensureStyles(): void {
  if (document.getElementById(STYLE_ID)) return;
  const s = document.createElement("style");
  s.id = STYLE_ID;
  s.textContent = `
    .ot-torrent { height:100%; overflow:auto; background:var(--canvas); color:var(--text); }
    .ot-torrent-doc { max-width:820px; margin:0 auto; padding:24px 24px 40px; }
    .ot-torrent-name { font:600 20px system-ui, sans-serif; margin:0 0 4px; word-break:break-word; }
    .ot-torrent-sub { font:13px system-ui, sans-serif; color:var(--muted); margin:0 0 20px; }
    .ot-torrent-h { font:600 12px system-ui, sans-serif; text-transform:uppercase; letter-spacing:.04em;
      color:var(--muted); margin:22px 0 8px; }
    .ot-torrent-meta { font:13px/1.6 system-ui, sans-serif; }
    .ot-torrent-meta div { display:flex; gap:10px; margin:2px 0; }
    .ot-torrent-meta b { color:var(--muted); font-weight:600; flex:0 0 120px; }
    .ot-torrent-meta span { flex:1 1 auto; word-break:break-word; }
    .ot-torrent-mono { font-family:ui-monospace, SFMono-Regular, monospace; font-size:12px; }
    .ot-torrent-files { border:1px solid var(--border); border-radius:6px; overflow:hidden; }
    .ot-torrent-file { display:flex; justify-content:space-between; gap:12px; padding:5px 12px;
      font:12.5px/1.4 system-ui, sans-serif; border-top:1px solid var(--border); }
    .ot-torrent-file:first-child { border-top:0; }
    .ot-torrent-file span:first-child { word-break:break-all; }
    .ot-torrent-file span:last-child { color:var(--muted); white-space:nowrap; }
    .ot-torrent-msg { margin:24px auto; color:var(--muted); font:14px system-ui, sans-serif; padding:24px;
      text-align:center; white-space:pre-wrap; max-width:640px; }
  `;
  document.head.appendChild(s);
}

function fmtSize(bytes: number): string {
  const units = ["B", "KB", "MB", "GB", "TB"];
  let n = bytes;
  let u = 0;
  while (n >= 1024 && u < units.length - 1) {
    n /= 1024;
    u++;
  }
  return `${u === 0 ? n : n.toFixed(2)} ${units[u]}`;
}

// Advance past one bencoded value starting at pos, returning the index just after it.
function skipValue(b: Uint8Array, pos: number): number {
  const c = b[pos];
  if (c === 0x69) {
    // "i<int>e"
    while (b[pos] !== 0x65) pos++;
    return pos + 1;
  }
  if (c === 0x6c || c === 0x64) {
    // list "l...e" / dict "d...e"
    pos++;
    while (b[pos] !== 0x65) pos = skipValue(b, pos);
    return pos + 1;
  }
  // byte string "<len>:<bytes>"
  let len = 0;
  while (b[pos] >= 0x30 && b[pos] <= 0x39) {
    len = len * 10 + (b[pos] - 0x30);
    pos++;
  }
  return pos + 1 + len; // skip ':' then len bytes
}

// Locate the raw bencoded span of the top-level "info" dictionary.
function infoSpan(b: Uint8Array): [number, number] | null {
  if (b[0] !== 0x64) return null; // not a dict
  let pos = 1;
  while (pos < b.length && b[pos] !== 0x65) {
    // read key (byte string)
    let len = 0;
    let p = pos;
    while (b[p] >= 0x30 && b[p] <= 0x39) {
      len = len * 10 + (b[p] - 0x30);
      p++;
    }
    const keyStart = p + 1;
    const key = new TextDecoder().decode(b.subarray(keyStart, keyStart + len));
    const valStart = keyStart + len;
    const valEnd = skipValue(b, valStart);
    if (key === "info") return [valStart, valEnd];
    pos = valEnd;
  }
  return null;
}

async function infoHash(b: Uint8Array): Promise<string | null> {
  try {
    const span = infoSpan(b);
    if (!span) return null;
    const digest = await crypto.subtle.digest("SHA-1", new Uint8Array(b.subarray(span[0], span[1])));
    return Array.from(new Uint8Array(digest))
      .map((x) => x.toString(16).padStart(2, "0"))
      .join("");
  } catch {
    return null;
  }
}

class TorrentInstance implements EditorInstance {
  private root: HTMLElement | null = null;

  mount(container: HTMLElement, ctx: EditorMountContext): void {
    ensureStyles();
    const root = document.createElement("div");
    root.className = "ot-torrent";
    container.appendChild(root);
    this.root = root;
    try {
      const bytes = ctx.bytes ?? new Uint8Array();
      const meta = info(bytes);
      const fileData = torrentFiles(bytes);
      const { doc, setHash } = this.renderDoc(meta, fileData);
      root.appendChild(doc);
      // Fill in the info-hash asynchronously (Web Crypto SHA-1).
      void infoHash(bytes).then((h) => h && setHash(h));
    } catch (e) {
      const m = document.createElement("div");
      m.className = "ot-torrent-msg";
      m.textContent = "This torrent could not be read:\n" + ((e as Error)?.message ?? String(e));
      root.appendChild(m);
    }
  }

  private renderDoc(
    meta: ReturnType<typeof info>,
    fileData: ReturnType<typeof torrentFiles>,
  ): { doc: HTMLElement; setHash: (hex: string) => void } {
    const doc = document.createElement("div");
    doc.className = "ot-torrent-doc";

    const name = document.createElement("h1");
    name.className = "ot-torrent-name";
    name.textContent = meta.name || "(unnamed torrent)";
    doc.appendChild(name);

    const total = fileData.length;
    const sub = document.createElement("p");
    sub.className = "ot-torrent-sub";
    sub.textContent = [
      fmtSize(total),
      `${fileData.files.length} file${fileData.files.length === 1 ? "" : "s"}`,
      meta.version,
    ]
      .filter(Boolean)
      .join(" · ");
    doc.appendChild(sub);

    const metaBox = document.createElement("div");
    metaBox.className = "ot-torrent-meta";
    // The info-hash row is created empty and populated once SHA-1 resolves.
    const hashSpan = document.createElement("span");
    hashSpan.className = "ot-torrent-mono";
    hashSpan.textContent = "…";
    const hashRow = document.createElement("div");
    const hashLabel = document.createElement("b");
    hashLabel.textContent = "Info hash";
    hashRow.append(hashLabel, hashSpan);
    metaBox.appendChild(hashRow);

    const rows: [string, string][] = [
      ["Piece length", fileData.pieceLength ? fmtSize(fileData.pieceLength) : ""],
      ["Created", meta.created ? new Date(meta.created).toLocaleString() : ""],
      ["Created by", meta.createdBy || ""],
      ["Comment", meta.comment || ""],
      ["Private", meta.private ? "yes" : ""],
    ];
    for (const [label, value] of rows) {
      if (!value) continue;
      const row = document.createElement("div");
      const b = document.createElement("b");
      b.textContent = label;
      const span = document.createElement("span");
      span.textContent = value;
      row.append(b, span);
      metaBox.appendChild(row);
    }
    doc.appendChild(metaBox);

    const trackers = meta.announce || [];
    if (trackers.length) {
      doc.appendChild(this.heading(`Trackers (${trackers.length})`));
      const box = document.createElement("div");
      box.className = "ot-torrent-meta ot-torrent-mono";
      for (const tr of trackers) {
        const row = document.createElement("div");
        const span = document.createElement("span");
        span.textContent = tr;
        row.appendChild(span);
        box.appendChild(row);
      }
      doc.appendChild(box);
    }

    doc.appendChild(this.heading(`Files (${fileData.files.length})`));
    const list = document.createElement("div");
    list.className = "ot-torrent-files";
    const shown = fileData.files.slice(0, 2000);
    for (const f of shown) {
      const row = document.createElement("div");
      row.className = "ot-torrent-file";
      const path = document.createElement("span");
      // @ctrl/torrent-file joins path components with commas; show them as a path.
      path.textContent = f.path.replace(/,/g, "/");
      const size = document.createElement("span");
      size.textContent = fmtSize(f.length);
      row.append(path, size);
      list.appendChild(row);
    }
    doc.appendChild(list);
    if (fileData.files.length > shown.length) {
      doc.appendChild(this.heading(`Showing the first ${shown.length} files.`));
    }
    return { doc, setHash: (hex) => (hashSpan.textContent = hex) };
  }

  private heading(text: string): HTMLElement {
    const h = document.createElement("p");
    h.className = "ot-torrent-h";
    h.textContent = text;
    return h;
  }

  getText(): string {
    return "";
  }
  selection(): unknown {
    return null;
  }
  focus(): void {}
  dispose(): void {
    this.root?.remove();
    this.root = null;
  }
}

export const torrentViewer: EditorModule = {
  create: () => new TorrentInstance(),
};
