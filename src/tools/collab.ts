import type { Disposable, HostAPI, ToolModule } from "../core/types";
import { t } from "../i18n";
import { VersionStore } from "./version-store";
import { snapshot } from "./history";
import { hashBytes, type BaseDoc } from "./collab/base";
import { newRoomKey, parseInvite, roomLink, withoutRoom } from "./collab/link";
import { CollabSession, type SessionHost } from "./collab/session";
import type { Peer } from "./collab/provider";

// Live collaboration. One session at a time, tied to the open document.
//
// The honest summary, which the panel repeats rather than hiding in the docs: no server,
// end-to-end encrypted, and the link is the key. Anyone who ever sees the link is in, for
// as long as the room lasts.

const STYLE_ID = "omnitext-collab-style";

const NAMES = ["Ada", "Grace", "Alan", "Edsger", "Barbara", "Ken", "Radia", "Margaret", "Linus", "Hedy"];
const COLOURS = ["#e5484d", "#3fb950", "#4c8dff", "#d29922", "#a371f7", "#00b3a4", "#f778ba"];
const pick = <T>(xs: T[]): T => xs[Math.floor(Math.random() * xs.length)];

function ensureStyles(): void {
  if (document.getElementById(STYLE_ID)) return;
  const s = document.createElement("style");
  s.id = STYLE_ID;
  s.textContent = `
    .ot-collab { font: 13px/1.55 system-ui, -apple-system, sans-serif; }
    .ot-collab h4 { margin: 0 0 6px; font-size: 12px; text-transform: uppercase;
      letter-spacing: .06em; color: var(--muted); font-weight: 600; }
    .ot-collab section { margin-bottom: 14px; }
    .ot-collab-state { font-weight: 600; }
    .ot-collab-link { width: 100%; box-sizing: border-box; font: 12px ui-monospace, Menlo, monospace;
      padding: 6px 7px; border: 1px solid var(--border); border-radius: 6px;
      background: var(--surface); color: var(--text); }
    .ot-collab-row { display: flex; gap: 6px; margin-top: 7px; flex-wrap: wrap; }
    .ot-collab-peers { list-style: none; margin: 0; padding: 0; display: flex; flex-wrap: wrap; gap: 6px; }
    .ot-collab-peers li { display: flex; align-items: center; gap: 6px; border: 1px solid var(--border);
      border-radius: 999px; padding: 2px 10px; }
    .ot-collab-dot { width: 9px; height: 9px; border-radius: 50%; flex: none; }
    .ot-collab-kick {
      border: none; background: none; color: var(--muted); cursor: pointer; padding: 0 0 0 2px;
      font: inherit; line-height: 1; margin-left: 2px;
    }
    .ot-collab-kick:hover { color: #e5484d; }
    .ot-collab-muted { color: var(--muted); }
    .ot-collab-warn { border: 1px solid var(--border); border-left: 3px solid #d29922;
      border-radius: 6px; padding: 8px 10px; color: var(--muted); font-size: 12px; }
    .ot-collab-warn ul { margin: 5px 0 0; padding-left: 17px; }
    .ot-collab-viewonly { display: flex; align-items: center; gap: 6px; margin-top: 8px; }
    .ot-collab-about summary { cursor: pointer; color: var(--muted); font-size: 12px; }
    .ot-collab-about[open] summary { margin-bottom: 6px; }

    /* Chat fills the rest of the panel, with the composer pinned under it. */
    .ot-collab { display: flex; flex-direction: column; height: 100%; }
    .ot-collab-chat { display: flex; flex-direction: column; flex: 1; min-height: 140px; }
    .ot-collab-log {
      flex: 1; overflow-y: auto; display: flex; flex-direction: column; gap: 7px;
      border: 1px solid var(--border); border-radius: 7px; padding: 8px; min-height: 90px;
    }
    .ot-collab-msg { display: flex; flex-direction: column; gap: 1px; }
    .ot-collab-who { font-size: 11px; font-weight: 600; }
    .ot-collab-body { white-space: pre-wrap; overflow-wrap: anywhere; }
    .ot-collab-compose { display: flex; gap: 6px; margin-top: 7px; }
    .ot-collab-compose input {
      flex: 1; min-width: 0; font: inherit; padding: 5px 8px; border: 1px solid var(--border);
      border-radius: 6px; background: var(--surface); color: var(--text);
    }
    /* Unread count on the toolbar button. */
    #toolbtn-collab { position: relative; }
    .ot-collab-badge {
      position: absolute; top: 1px; right: 1px; min-width: 15px; height: 15px; padding: 0 3px;
      border-radius: 999px; background: #e5484d; color: #fff; font: 600 10px/15px system-ui, sans-serif;
      text-align: center; pointer-events: none;
    }
  `;
  document.head.appendChild(s);
}

const el = (tag: string, cls?: string, text?: string): HTMLElement => {
  const e = document.createElement(tag);
  if (cls) e.className = cls;
  if (text !== undefined) e.textContent = text;
  return e;
};

const button = (label: string, primary = false): HTMLButtonElement => {
  const b = document.createElement("button");
  b.className = primary ? "ot-mini primary" : "ot-mini";
  b.textContent = label;
  return b;
};

/** State the tool keeps between panel openings. */
interface ToolState {
  session: CollabSession | null;
  me: { name: string; colour: string };
  repaint: (() => void) | null;
  /** Open, so the toolbar button can toggle rather than always open. */
  panelOpen: boolean;
  /** Messages already seen, so the badge counts only what arrived while closed. */
  readCount: number;
  chatSub: { dispose(): void } | null;
  /** Show the view-only variant of the invitation. Host-side display choice only. */
  offerViewOnly: boolean;
}

/** Unread count on the toolbar button; the tool owns the badge inside its own button. */
function paintBadge(unread: number): void {
  const button = document.getElementById("toolbtn-collab");
  if (!button) return;
  let badge = button.querySelector<HTMLElement>(".ot-collab-badge");
  if (!unread) {
    badge?.remove();
    return;
  }
  if (!badge) {
    badge = el("span", "ot-collab-badge");
    button.appendChild(badge);
  }
  badge.textContent = unread > 9 ? "9+" : String(unread);
  badge.title = t("collab.unread", { n: unread, count: unread });
}

function refreshBadge(state: ToolState): void {
  const total = state.session?.messages().length ?? 0;
  if (state.panelOpen) {
    state.readCount = total;
    paintBadge(0);
    return;
  }
  paintBadge(Math.max(0, total - state.readCount));
}

/**
 * What to call the file we send. An untitled document has no name, and sending it as
 * "document" strips the extension, which is how the other side decides what it is: a
 * shared spreadsheet arrived as plain text and opened in the text editor, with no way to
 * reach the grid. So an unnamed document travels under its format's extension.
 */
function baseName(host: HostAPI, filename: string | null, formatId: string | null): string {
  if (filename) return filename;
  const ext = formatId ? host.formats.byId(formatId)?.manifest.extensions?.[0] : undefined;
  return ext ? `untitled${ext.startsWith(".") ? ext : `.${ext}`}` : "document";
}

function sessionHostFor(host: HostAPI, state: ToolState, store: VersionStore): SessionHost {
  return {
    async currentDoc(): Promise<BaseDoc | null> {
      const doc = host.workspace.getActiveDocument();
      if (!doc) return null;
      const bytes = doc.binary
        ? await host.workspace.getActiveBytes()
        : new TextEncoder().encode(doc.text);
      if (!bytes) return null;
      return { name: baseName(host, doc.filename, doc.formatId), bytes, hash: await hashBytes(bytes) };
    },

    localState() {
      const doc = host.workspace.getActiveDocument();
      if (!doc) return null;
      // The hash is unknown without reading the bytes, and the decision that matters
      // (never discard unsaved work) only needs the dirty flag. A clean document is
      // reported with a hash that cannot match, so it is replaced rather than assumed.
      return { hash: doc.dirty ? "dirty" : "clean-unknown", dirty: doc.dirty };
    },

    async openBase(doc: BaseDoc) {
      // The original is snapshotted first: once a remote peer can change your document,
      // being able to get back to what you had is the whole safety net.
      await snapshot(host, store, "BeforeJoin").catch(() => undefined);

      // openFile mounts the new editor asynchronously, so this must not resolve until it
      // has. Returning early binds the session to the editor being replaced, which for a
      // recovered document is an editor that may not collaborate at all.
      await new Promise<void>((resolve) => {
        let done = false;
        const finish = (): void => {
          if (done) return;
          done = true;
          sub.dispose();
          clearTimeout(timer);
          resolve();
        };
        const sub = host.events.on("documentOpened", finish);
        const timer = setTimeout(finish, 15_000); // never hang if the open fails
        host.workspace.openFile?.(doc.name, doc.bytes);
      });
    },

    binding() {
      return host.workspace.activeCollabBinding?.() ?? null;
    },

    notify(message) {
      host.notifications.warn(message);
    },

    /**
     * Removed from the session: the document closes, leaving nothing of the shared copy
     * behind. Nothing is lost to the group, since every other peer still holds the edits
     * this side contributed. History from before the session is that person's own earlier
     * data and is left alone.
     */
    onEvicted() {
      state.session = null;
      state.repaint?.();
      host.workspace.closeActive?.();
    },

    onChange() {
      state.repaint?.();
    },
  };
}

async function startSession(
  host: HostAPI,
  state: ToolState,
  store: VersionStore,
  key?: { roomId: string; secret: string },
  readOnly = false,
): Promise<void> {
  if (state.session) return;
  const doc = host.workspace.getActiveDocument();
  if (!doc) {
    host.notifications.warn(t("collab.openDocFirst"));
    return;
  }
  await snapshot(host, store, key ? "BeforeJoin" : "BeforeShare").catch(() => undefined);
  const session = new CollabSession(sessionHostFor(host, state, store), {
    ...state.me,
    key,
    readOnly,
  });
  state.session = session;
  await session.start();
  state.repaint?.();
}

async function leaveSession(host: HostAPI, state: ToolState, store: VersionStore): Promise<void> {
  const session = state.session;
  if (!session) return;
  state.session = null;
  await session.leave();
  await snapshot(host, store, "AfterCollab").catch(() => undefined);
  state.repaint?.();
}

function renderPeers(into: HTMLElement, peers: Peer[], onRemove: (peer: Peer) => void): void {
  into.textContent = "";
  if (!peers.length) {
    into.appendChild(el("li", "ot-collab-muted", t("collab.nobodyElse")));
    return;
  }
  for (const peer of peers) {
    const li = el("li");
    const dot = el("span", "ot-collab-dot");
    dot.style.background = peer.colour;
    li.append(dot, document.createTextNode(peer.name));
    if (peer.peerId) {
      const kick = el("button", "ot-collab-kick", "×");
      const label = t("collab.remove", { name: peer.name });
      kick.title = label;
      kick.setAttribute("aria-label", label);
      kick.addEventListener("click", () => onRemove(peer));
      li.appendChild(kick);
    }
    into.appendChild(li);
  }
}

async function removePeer(host: HostAPI, state: ToolState, peer: Peer): Promise<void> {
  const session = state.session;
  if (!session || !peer.peerId) return;
  const { stranded } = await session.remove(peer.peerId);
  host.notifications.info(t("collab.removed", { name: peer.name }));
  if (stranded.length) {
    host.notifications.warn(
      t("collab.stranded", { names: stranded.map((p) => p.name).join(", "), name: peer.name }),
    );
  }
  state.repaint?.();
}

const clock = (at: number): string =>
  new Date(at).toLocaleTimeString(undefined, { hour: "2-digit", minute: "2-digit" });

/** The chat: a scrolling log and a composer. */
function renderChat(session: CollabSession, state: ToolState): HTMLElement {
  const chat = el("section", "ot-collab-chat");
  chat.appendChild(el("h4", undefined, t("collab.chat")));

  const log = el("div", "ot-collab-log");
  const draw = (): void => {
    const messages = session.messages();
    log.textContent = "";
    if (!messages.length) {
      log.appendChild(el("div", "ot-collab-muted", t("collab.noMessages")));
    }
    for (const m of messages) {
      const row = el("div", "ot-collab-msg");
      const who = el("div", "ot-collab-who", `${m.author} · ${clock(m.at)}`);
      who.style.color = m.colour;
      row.append(who, el("div", "ot-collab-body", m.text));
      log.appendChild(row);
    }
    log.scrollTop = log.scrollHeight; // newest is what you want to see
  };
  draw();
  chat.appendChild(log);

  const compose = el("div", "ot-collab-compose");
  const input = document.createElement("input");
  input.placeholder = t("collab.messagePlaceholder");
  input.setAttribute("aria-label", t("collab.chatLabel"));
  const send = button(t("collab.send"), true);
  const submit = (): void => {
    if (!input.value.trim()) return;
    session.sendMessage(input.value);
    input.value = "";
  };
  send.onclick = submit;
  input.addEventListener("keydown", (e) => {
    if (e.key === "Enter") {
      e.preventDefault();
      submit();
    }
  });
  compose.append(input, send);
  chat.appendChild(compose);

  // Redraw on any change without repainting the whole panel, so typing is not interrupted.
  state.chatSub?.dispose();
  state.chatSub = session.onMessages(() => {
    draw();
    refreshBadge(state);
  });
  return chat;
}

function openPanel(host: HostAPI, state: ToolState, store: VersionStore): void {
  ensureStyles();
  host.ui.openPanel({
    title: t("collab.title"),
    render(container) {
      const root = el("div", "ot-collab");
      container.appendChild(root);

      const paint = (): void => {
        root.textContent = "";
        const session = state.session;

        const status = el("section");
        status.appendChild(el("h4", undefined, t("collab.session")));
        if (!session) {
          status.appendChild(el("div", "ot-collab-muted", t("collab.notSharing")));
          const row = el("div", "ot-collab-row");
          const share = button(t("collab.share"), true);
          share.onclick = () => void startSession(host, state, store);
          row.appendChild(share);
          status.appendChild(row);
        } else {
          const peers = session.peers();
          status.appendChild(
            el(
              "div",
              "ot-collab-state",
              peers.length
                ? t("collab.connected", { n: peers.length, count: peers.length })
                : t("collab.waiting"),
            ),
          );
          if (session.readOnly) {
            status.appendChild(el("div", "ot-collab-muted", t("collab.readOnlyHere")));
          }
          if (session.status === "unsupported") {
            status.appendChild(
              el("div", "ot-collab-muted", t("collab.unsupported")),
            );
          } else if (session.status === "waiting") {
            status.appendChild(
              el("div", "ot-collab-muted", t("collab.waitingDoc")),
            );
          }
        }
        root.appendChild(status);

        if (session) {
          const link = el("section");
          link.appendChild(el("h4", undefined, t("collab.invitation")));
          const input = document.createElement("input");
          input.className = "ot-collab-link";
          input.readOnly = true;
          input.value = roomLink(session.key, location.href, { viewOnly: state.offerViewOnly });
          link.appendChild(input);

          const row = el("div", "ot-collab-row");
          const copy = button(t("collab.copyLink"), true);
          copy.onclick = () => {
            void navigator.clipboard.writeText(input.value).then(
              () => host.notifications.info(t("collab.linkCopied")),
              () => input.select(),
            );
          };
          const leave = button(t("collab.leave"));
          leave.onclick = () => void leaveSession(host, state, store);
          row.append(copy, leave);
          link.appendChild(row);

          const viewRow = el("label", "ot-collab-viewonly");
          const box = document.createElement("input");
          box.type = "checkbox";
          box.checked = state.offerViewOnly;
          box.addEventListener("change", () => {
            state.offerViewOnly = box.checked;
            input.value = roomLink(session.key, location.href, { viewOnly: box.checked });
          });
          viewRow.append(box, document.createTextNode(t("collab.viewOnly")));
          link.appendChild(viewRow);
          link.appendChild(el("div", "ot-collab-muted", t("collab.viewOnlyHint")));
          root.appendChild(link);

          const who = el("section");
          who.appendChild(el("h4", undefined, t("collab.people")));
          const list = el("ul", "ot-collab-peers");
          renderPeers(list, session.peers(), (peer) => void removePeer(host, state, peer));
          who.appendChild(list);
          who.appendChild(
            el("div", "ot-collab-muted", t("collab.removeHint")),
          );
          root.appendChild(who);
        }

        if (session) root.appendChild(renderChat(session, state));

        // The warnings still have to be here: they are the honest description of what a
        // link is. Folded away rather than dropped, so the panel is mostly chat.
        const about = document.createElement("details");
        about.className = "ot-collab-about";
        const summary = document.createElement("summary");
        summary.textContent = t("collab.aboutSummary");
        about.appendChild(summary);
        const box = el("div", "ot-collab-warn");
        box.appendChild(document.createTextNode(t("collab.aboutIntro")));
        const points = el("ul");
        for (const key of ["aboutLink", "aboutLeak", "aboutPeers", "aboutChat"]) {
          const line = t(`collab.${key}`);
          points.appendChild(el("li", undefined, line));
        }
        box.appendChild(points);
        about.appendChild(box);
        root.appendChild(about);
      };

      state.panelOpen = true;
      state.repaint = paint;
      paint();
      refreshBadge(state); // opening the panel is reading the chat
      return () => {
        state.panelOpen = false;
        state.repaint = null;
        state.chatSub?.dispose();
        state.chatSub = null;
        // Keep watching while closed, or the badge would never light up.
        if (state.session) {
          state.chatSub = state.session.onMessages(() => refreshBadge(state));
        }
      };
    },
  });
}

export const collabTool: ToolModule = {
  manifest: { kind: "tool", id: "collab", capabilities: ["collaboration", "presence"] },
  activate(host: HostAPI): Disposable {
    const store = new VersionStore();
    const state: ToolState = {
      session: null,
      me: { name: pick(NAMES), colour: pick(COLOURS) },
      repaint: null,
      panelOpen: false,
      readCount: 0,
      chatSub: null,
      offerViewOnly: false,
    };

    /** Slide the panel in or out, rather than only ever opening it. */
    const toggle = (): void => {
      if (state.panelOpen) host.ui.closePanels();
      else openPanel(host, state, store);
    };

    // Arriving on a link. The room comes out of the address bar at once, so the secret
    // stops sitting where a screen share or a synced browser history would pick it up.
    let invited: { key: { roomId: string; secret: string }; viewOnly: boolean } | null = null;

    const takeInvite = (): typeof invited => {
      const invite = parseInvite(location.hash);
      if (invite) history.replaceState(null, "", withoutRoom());
      return invite;
    };

    /** Join now if a document is open, otherwise as soon as the first one is. */
    const accept = (invite: typeof invited): void => {
      if (!invite || state.session) return;
      if (host.workspace.getActiveDocument()) {
        void startSession(host, state, store, invite.key, invite.viewOnly);
      } else invited = invite;
    };

    // Pasting a link into a tab that already has Omnitext open changes only the fragment,
    // which does not reload the page. Without this, the commonest way to accept an
    // invitation does nothing at all.
    const onHashChange = (): void => accept(takeInvite());
    window.addEventListener("hashchange", onHashChange);
    accept(takeInvite());

    const disposables = [
      host.events.on("documentOpened", () => {
        const invite = invited;
        invited = null;
        accept(invite);
      }),
      host.commands.register({
        id: "collab.share",
        title: t("app.collaborate"),
        run: toggle,
      }),
      host.ui.addToolbarButton({
        id: "collab",
        title: t("app.collaborate"),
        hideWhenReadOnly: true, // nothing to share on a surface that cannot be edited
        icon: `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M16 21v-2a4 4 0 0 0-4-4H6a4 4 0 0 0-4 4v2"/><circle cx="9" cy="7" r="4"/><path d="M22 21v-2a4 4 0 0 0-3-3.87"/><path d="M16 3.13a4 4 0 0 1 0 7.75"/></svg>`,
        onClick: toggle,
      }),
    ];

    return {
      dispose() {
        window.removeEventListener("hashchange", onHashChange);
        state.chatSub?.dispose();
        void state.session?.leave();
        for (const d of disposables) d.dispose();
      },
    };
  },
};

/** Exposed for the tests: a fresh room key, as the share button mints one. */
export { newRoomKey };
