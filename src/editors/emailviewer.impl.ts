import type { EditorInstance, EditorModule, EditorMountContext } from "../core/types";

// Read-only email viewer for .eml (postal-mime) and Outlook .msg (@kenjiuno/msgreader).
// Both parsers run in the browser. The HTML body is rendered inside a sandboxed iframe
// with a strict CSP that blocks remote content, so tracking pixels and external
// resources never load and nothing about the opened file leaves the device.

const STYLE_ID = "omnitext-email-style";

function ensureStyles(): void {
  if (document.getElementById(STYLE_ID)) return;
  const s = document.createElement("style");
  s.id = STYLE_ID;
  s.textContent = `
    .ot-email { height:100%; display:flex; flex-direction:column; overflow:hidden; background:var(--canvas);
      color:var(--text); }
    .ot-email-head { flex:0 0 auto; padding:16px 20px; border-bottom:1px solid var(--border);
      background:var(--chrome); }
    .ot-email-subj { font:600 17px system-ui, sans-serif; margin:0 0 8px; }
    .ot-email-row { font:13px/1.5 system-ui, sans-serif; display:flex; gap:8px; }
    .ot-email-row b { color:var(--muted); font-weight:600; flex:0 0 62px; }
    .ot-email-row span { flex:1 1 auto; word-break:break-word; }
    .ot-email-att { margin-top:8px; display:flex; flex-wrap:wrap; gap:6px; }
    .ot-email-att a { font:12px system-ui, sans-serif; border:1px solid var(--border); border-radius:4px;
      padding:3px 8px; color:var(--accent); text-decoration:none; background:var(--surface); cursor:pointer; }
    .ot-email-body { flex:1 1 auto; overflow:hidden; }
    .ot-email-body iframe { width:100%; height:100%; border:0; background:#fff; }
    .ot-email-text { height:100%; overflow:auto; white-space:pre-wrap; word-break:break-word;
      font:13px/1.6 ui-monospace, monospace; padding:16px 20px; }
    .ot-email-msg { margin:auto; color:var(--muted); font:14px system-ui, sans-serif; padding:24px;
      text-align:center; white-space:pre-wrap; }
  `;
  document.head.appendChild(s);
}

interface NormEmail {
  subject: string;
  from: string;
  to: string[];
  cc: string[];
  date: string;
  html?: string;
  text?: string;
  attachments: { name: string; bytes?: Uint8Array; mime?: string }[];
}

function addr(a?: { name?: string; address?: string } | null): string {
  if (!a) return "";
  return a.name && a.address ? `${a.name} <${a.address}>` : a.address || a.name || "";
}

async function parseEml(bytes: Uint8Array): Promise<NormEmail> {
  const { default: PostalMime } = await import("postal-mime");
  const email = await new PostalMime().parse(bytes);
  return {
    subject: email.subject || "(no subject)",
    from: addr(email.from),
    to: (email.to || []).map(addr).filter(Boolean),
    cc: (email.cc || []).map(addr).filter(Boolean),
    date: email.date ? new Date(email.date).toLocaleString() : "",
    html: email.html || undefined,
    text: email.text || undefined,
    attachments: (email.attachments || []).map((a) => ({
      name: a.filename || "attachment",
      mime: a.mimeType,
      bytes:
        a.content instanceof Uint8Array
          ? a.content
          : a.content instanceof ArrayBuffer
            ? new Uint8Array(a.content)
            : typeof a.content === "string"
              ? new TextEncoder().encode(a.content)
              : undefined,
    })),
  };
}

async function parseMsg(bytes: Uint8Array): Promise<NormEmail> {
  const { default: MsgReader } = await import("@kenjiuno/msgreader");
  const buf = bytes.buffer.slice(bytes.byteOffset, bytes.byteOffset + bytes.byteLength) as ArrayBuffer;
  const data = new MsgReader(buf).getFileData();
  const label = (r: { name?: string; email?: string }) =>
    r.name && r.email ? `${r.name} <${r.email}>` : r.email || r.name || "";
  const recips = data.recipients || [];
  return {
    subject: data.subject || "(no subject)",
    from: data.senderName && data.senderEmail ? `${data.senderName} <${data.senderEmail}>` : data.senderEmail || data.senderName || "",
    to: recips.filter((r) => r.recipType !== "cc" && r.recipType !== "bcc").map(label).filter(Boolean),
    cc: recips.filter((r) => r.recipType === "cc").map(label).filter(Boolean),
    date: "",
    html: data.bodyHtml || undefined,
    text: data.body || undefined,
    attachments: (data.attachments || []).map((a) => ({ name: a.fileName || a.name || "attachment" })),
  };
}

class EmailInstance implements EditorInstance {
  private root: HTMLElement | null = null;
  private urls: string[] = [];

  mount(container: HTMLElement, ctx: EditorMountContext): void {
    ensureStyles();
    const root = document.createElement("div");
    root.className = "ot-email";
    container.appendChild(root);
    this.root = root;
    const msg = document.createElement("div");
    msg.className = "ot-email-msg";
    msg.textContent = "Loading…";
    root.appendChild(msg);
    void this.render(root, ctx.bytes ?? new Uint8Array(), ctx.filename ?? "");
  }

  private async render(root: HTMLElement, bytes: Uint8Array, filename: string): Promise<void> {
    try {
      const email = /\.msg$/i.test(filename) ? await parseMsg(bytes) : await parseEml(bytes);
      root.textContent = "";

      const head = document.createElement("div");
      head.className = "ot-email-head";
      const subj = document.createElement("div");
      subj.className = "ot-email-subj";
      subj.textContent = email.subject;
      head.appendChild(subj);
      const rows: [string, string][] = [
        ["From", email.from],
        ["To", email.to.join(", ")],
        ["Cc", email.cc.join(", ")],
        ["Date", email.date],
      ];
      for (const [label, value] of rows) {
        if (!value) continue;
        const row = document.createElement("div");
        row.className = "ot-email-row";
        const b = document.createElement("b");
        b.textContent = label;
        const span = document.createElement("span");
        span.textContent = value;
        row.append(b, span);
        head.appendChild(row);
      }
      if (email.attachments.length) {
        const att = document.createElement("div");
        att.className = "ot-email-att";
        for (const a of email.attachments) {
          const chip = document.createElement("a");
          chip.textContent = `📎 ${a.name}`;
          if (a.bytes) {
            const url = URL.createObjectURL(new Blob([a.bytes as BlobPart], { type: a.mime || "application/octet-stream" }));
            this.urls.push(url);
            chip.href = url;
            chip.download = a.name;
          }
          att.appendChild(chip);
        }
        head.appendChild(att);
      }
      root.appendChild(head);

      const body = document.createElement("div");
      body.className = "ot-email-body";
      if (email.html) {
        const iframe = document.createElement("iframe");
        iframe.setAttribute("sandbox", "");
        const csp =
          '<meta http-equiv="Content-Security-Policy" content="default-src \'none\'; ' +
          "img-src data:; style-src 'unsafe-inline'; font-src data:; media-src data:\">";
        iframe.srcdoc = `<!doctype html><html><head><meta charset="utf-8">${csp}</head><body>${email.html}</body></html>`;
        body.appendChild(iframe);
      } else {
        const pre = document.createElement("div");
        pre.className = "ot-email-text";
        pre.textContent = email.text || "(empty message)";
        body.appendChild(pre);
      }
      root.appendChild(body);
    } catch (e) {
      root.textContent = "";
      const m = document.createElement("div");
      m.className = "ot-email-msg";
      m.textContent = "This message could not be displayed:\n" + ((e as Error)?.message ?? String(e));
      root.appendChild(m);
    }
  }

  getText(): string {
    return "";
  }
  selection(): unknown {
    return null;
  }
  focus(): void {}
  dispose(): void {
    for (const u of this.urls) URL.revokeObjectURL(u);
    this.urls = [];
    this.root?.remove();
    this.root = null;
  }
}

export const emailViewer: EditorModule = {
  create: () => new EmailInstance(),
};
