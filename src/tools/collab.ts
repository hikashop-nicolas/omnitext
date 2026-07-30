import type { Disposable, HostAPI, ToolModule } from "../core/types";
import { VersionStore } from "./version-store";
import { snapshot } from "./history";
import { hashBytes, type BaseDoc } from "./collab/base";
import { newRoomKey, parseRoomKey, roomLink, withoutRoom } from "./collab/link";
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
    .ot-collab-muted { color: var(--muted); }
    .ot-collab-warn { border: 1px solid var(--border); border-left: 3px solid #d29922;
      border-radius: 6px; padding: 8px 10px; color: var(--muted); font-size: 12px; }
    .ot-collab-warn ul { margin: 5px 0 0; padding-left: 17px; }
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
      return { name: doc.filename ?? "document", bytes, hash: await hashBytes(bytes) };
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
): Promise<void> {
  if (state.session) return;
  const doc = host.workspace.getActiveDocument();
  if (!doc) {
    host.notifications.warn("Open a document before starting a session.");
    return;
  }
  await snapshot(host, store, key ? "BeforeJoin" : "BeforeShare").catch(() => undefined);
  const session = new CollabSession(sessionHostFor(host, state, store), { ...state.me, key });
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

function renderPeers(into: HTMLElement, peers: Peer[]): void {
  into.textContent = "";
  if (!peers.length) {
    into.appendChild(el("li", "ot-collab-muted", "nobody else yet"));
    return;
  }
  for (const peer of peers) {
    const li = el("li");
    const dot = el("span", "ot-collab-dot");
    dot.style.background = peer.colour;
    li.append(dot, document.createTextNode(peer.name));
    into.appendChild(li);
  }
}

function openPanel(host: HostAPI, state: ToolState, store: VersionStore): void {
  ensureStyles();
  host.ui.openPanel({
    title: "Collaborate",
    render(container) {
      const root = el("div", "ot-collab");
      container.appendChild(root);

      const paint = (): void => {
        root.textContent = "";
        const session = state.session;

        const status = el("section");
        status.appendChild(el("h4", undefined, "Session"));
        if (!session) {
          status.appendChild(el("div", "ot-collab-muted", "Not sharing this document."));
          const row = el("div", "ot-collab-row");
          const share = button("Share this document", true);
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
                ? `Connected to ${peers.length} ${peers.length === 1 ? "person" : "people"}`
                : "Waiting for someone to join",
            ),
          );
          if (session.status === "unsupported") {
            status.appendChild(
              el(
                "div",
                "ot-collab-muted",
                "This editor cannot edit together yet, so others see the document but your" +
                  " changes stay local. Plain text files work today.",
              ),
            );
          } else if (session.status === "waiting") {
            status.appendChild(
              el("div", "ot-collab-muted", "Not editing together yet: waiting for the document."),
            );
          }
        }
        root.appendChild(status);

        if (session) {
          const link = el("section");
          link.appendChild(el("h4", undefined, "Invitation link"));
          const input = document.createElement("input");
          input.className = "ot-collab-link";
          input.readOnly = true;
          input.value = roomLink(session.key);
          link.appendChild(input);

          const row = el("div", "ot-collab-row");
          const copy = button("Copy link", true);
          copy.onclick = () => {
            void navigator.clipboard.writeText(input.value).then(
              () => host.notifications.info("Link copied."),
              () => input.select(),
            );
          };
          const leave = button("Leave session");
          leave.onclick = () => void leaveSession(host, state, store);
          row.append(copy, leave);
          link.appendChild(row);
          root.appendChild(link);

          const who = el("section");
          who.appendChild(el("h4", undefined, "People"));
          const list = el("ul", "ot-collab-peers");
          renderPeers(list, session.peers());
          who.appendChild(list);
          root.appendChild(who);
        }

        const warn = el("section");
        warn.appendChild(el("h4", undefined, "What this is"));
        const box = el("div", "ot-collab-warn");
        box.appendChild(
          document.createTextNode(
            "No server, and the traffic is encrypted between browsers. It is not secure, though:",
          ),
        );
        const points = el("ul");
        for (const line of [
          "The link is the key. Anyone who ever sees it can join, and there is no way to remove them.",
          "Links leak: through synced browser history, screen sharing, and copy and paste.",
          "The others can see your IP address, and anyone you invite can change the document.",
        ]) {
          points.appendChild(el("li", undefined, line));
        }
        box.appendChild(points);
        warn.appendChild(box);
        root.appendChild(warn);
      };

      state.repaint = paint;
      paint();
      return () => {
        state.repaint = null;
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
    };

    // Arriving on a link. The room comes out of the address bar at once, so the secret
    // stops sitting where a screen share or a synced browser history would pick it up.
    let invited: { roomId: string; secret: string } | null = null;

    const takeInvite = (): { roomId: string; secret: string } | null => {
      const key = parseRoomKey(location.hash);
      if (key) history.replaceState(null, "", withoutRoom());
      return key;
    };

    /** Join now if a document is open, otherwise as soon as the first one is. */
    const accept = (key: { roomId: string; secret: string } | null): void => {
      if (!key || state.session) return;
      if (host.workspace.getActiveDocument()) void startSession(host, state, store, key);
      else invited = key;
    };

    // Pasting a link into a tab that already has Omnitext open changes only the fragment,
    // which does not reload the page. Without this, the commonest way to accept an
    // invitation does nothing at all.
    const onHashChange = (): void => accept(takeInvite());
    window.addEventListener("hashchange", onHashChange);
    accept(takeInvite());

    const disposables = [
      host.events.on("documentOpened", () => {
        const key = invited;
        invited = null;
        accept(key);
      }),
      host.commands.register({
        id: "collab.share",
        title: "Collaborate",
        run: () => openPanel(host, state, store),
      }),
      host.ui.addToolbarButton({
        id: "collab",
        title: "Collaborate",
        hideWhenReadOnly: true, // nothing to share on a surface that cannot be edited
        icon: `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M16 21v-2a4 4 0 0 0-4-4H6a4 4 0 0 0-4 4v2"/><circle cx="9" cy="7" r="4"/><path d="M22 21v-2a4 4 0 0 0-3-3.87"/><path d="M16 3.13a4 4 0 0 1 0 7.75"/></svg>`,
        onClick: () => openPanel(host, state, store),
      }),
    ];

    return {
      dispose() {
        window.removeEventListener("hashchange", onHashChange);
        void state.session?.leave();
        for (const d of disposables) d.dispose();
      },
    };
  },
};

/** Exposed for the tests: a fresh room key, as the share button mints one. */
export { newRoomKey };
