import ICAL from "ical.js";
import type { EditorInstance, EditorModule, EditorMountContext } from "../core/types";

// Read-only viewer for iCalendar (.ics) events and vCard (.vcf) contacts, parsed with
// ical.js. It lays out each event or contact as a card. Editing stays available by
// switching to the raw text editor (these are line-based text formats).

const STYLE_ID = "omnitext-pim-style";

function ensureStyles(): void {
  if (document.getElementById(STYLE_ID)) return;
  const s = document.createElement("style");
  s.id = STYLE_ID;
  s.textContent = `
    .ot-pim { height:100%; overflow:auto; background:var(--canvas); color:var(--text); }
    .ot-pim-list { max-width:760px; margin:0 auto; padding:22px 20px; display:flex; flex-direction:column; gap:14px; }
    .ot-pim-h { font:600 12px system-ui, sans-serif; text-transform:uppercase; letter-spacing:.04em;
      color:var(--muted); margin:0; }
    .ot-pim-card { border:1px solid var(--border); border-radius:8px; background:var(--surface); padding:14px 16px; }
    .ot-pim-title { font:600 16px system-ui, sans-serif; margin:0 0 8px; }
    .ot-pim-row { font:13px/1.5 system-ui, sans-serif; display:flex; gap:8px; margin:2px 0; }
    .ot-pim-row b { color:var(--muted); font-weight:600; flex:0 0 84px; }
    .ot-pim-row span { flex:1 1 auto; word-break:break-word; white-space:pre-wrap; }
    .ot-pim-msg { margin:24px auto; color:var(--muted); font:14px system-ui, sans-serif; padding:24px;
      text-align:center; white-space:pre-wrap; max-width:640px; }
  `;
  document.head.appendChild(s);
}

interface Card {
  title: string;
  rows: [string, string][];
}

// ICAL.parse returns one jCal component, or an array of them (e.g. multiple vCards).
function topComponents(text: string): ICAL.Component[] {
  const parsed = ICAL.parse(text) as unknown;
  const arr = Array.isArray(parsed) && typeof parsed[0] !== "string" ? parsed : [parsed];
  return (arr as unknown[]).map((j) => new ICAL.Component(j as never));
}

function fmtTime(t: ICAL.Time | null): string {
  if (!t) return "";
  const d = t.toJSDate();
  return t.isDate ? d.toLocaleDateString() : d.toLocaleString();
}

function eventCards(comp: ICAL.Component): Card[] {
  return comp.getAllSubcomponents("vevent").map((ve) => {
    const ev = new ICAL.Event(ve);
    const when = [fmtTime(ev.startDate), fmtTime(ev.endDate)].filter(Boolean).join(" → ");
    const rows: [string, string][] = [];
    if (when) rows.push(["When", when]);
    const loc = ve.getFirstPropertyValue("location");
    if (loc) rows.push(["Where", String(loc)]);
    if (ev.organizer) rows.push(["Organizer", String(ev.organizer).replace(/^mailto:/i, "")]);
    const attendees = ev.attendees?.map((a) => String(a.getFirstValue()).replace(/^mailto:/i, "")) ?? [];
    if (attendees.length) rows.push(["Attendees", attendees.join(", ")]);
    const desc = ve.getFirstPropertyValue("description");
    if (desc) rows.push(["Notes", String(desc)]);
    return { title: ev.summary || "(untitled event)", rows };
  });
}

function contactCard(comp: ICAL.Component): Card {
  const val = (name: string) => {
    const v = comp.getFirstPropertyValue(name);
    return v == null ? "" : String(v);
  };
  const all = (name: string) =>
    comp.getAllProperties(name).map((p) => String(p.getFirstValue())).filter(Boolean);
  const rows: [string, string][] = [];
  const org = comp.getFirstPropertyValue("org");
  const orgStr = Array.isArray(org) ? org.filter(Boolean).join(", ") : org ? String(org) : "";
  if (orgStr || val("title")) rows.push(["Role", [val("title"), orgStr].filter(Boolean).join(" · ")]);
  const emails = all("email");
  if (emails.length) rows.push(["Email", emails.join(", ")]);
  const tels = all("tel");
  if (tels.length) rows.push(["Phone", tels.join(", ")]);
  for (const adr of comp.getAllProperties("adr")) {
    const parts = adr.getFirstValue();
    const str = Array.isArray(parts) ? parts.filter(Boolean).join(", ") : String(parts);
    if (str) rows.push(["Address", str]);
  }
  if (val("note")) rows.push(["Note", val("note")]);
  if (val("url")) rows.push(["URL", val("url")]);
  return { title: val("fn") || val("n") || "(unnamed contact)", rows };
}

class PimInstance implements EditorInstance {
  private root: HTMLElement | null = null;

  mount(container: HTMLElement, ctx: EditorMountContext): void {
    ensureStyles();
    const root = document.createElement("div");
    root.className = "ot-pim";
    container.appendChild(root);
    this.root = root;
    try {
      const comps = topComponents(ctx.text);
      const cards: Card[] = [];
      let heading = "";
      for (const comp of comps) {
        if (comp.name === "vcalendar") {
          cards.push(...eventCards(comp));
          heading = "Calendar";
        } else if (comp.name === "vcard") {
          cards.push(contactCard(comp));
          heading = "Contacts";
        }
      }
      const list = document.createElement("div");
      list.className = "ot-pim-list";
      if (heading) {
        const h = document.createElement("p");
        h.className = "ot-pim-h";
        h.textContent = `${heading} · ${cards.length} item${cards.length === 1 ? "" : "s"}`;
        list.appendChild(h);
      }
      if (!cards.length) {
        const m = document.createElement("div");
        m.className = "ot-pim-msg";
        m.textContent = "No events or contacts found. Switch to the text editor to view the source.";
        list.appendChild(m);
      }
      for (const card of cards) list.appendChild(renderCard(card));
      root.appendChild(list);
    } catch (e) {
      const m = document.createElement("div");
      m.className = "ot-pim-msg";
      m.textContent = "This file could not be displayed:\n" + ((e as Error)?.message ?? String(e));
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
    this.root?.remove();
    this.root = null;
  }
}

function renderCard(card: Card): HTMLElement {
  const el = document.createElement("div");
  el.className = "ot-pim-card";
  const t = document.createElement("div");
  t.className = "ot-pim-title";
  t.textContent = card.title;
  el.appendChild(t);
  for (const [label, value] of card.rows) {
    const row = document.createElement("div");
    row.className = "ot-pim-row";
    const b = document.createElement("b");
    b.textContent = label;
    const span = document.createElement("span");
    span.textContent = value;
    row.append(b, span);
    el.appendChild(row);
  }
  return el;
}

export const pimViewer: EditorModule = {
  create: () => new PimInstance(),
};
