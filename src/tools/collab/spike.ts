import * as Y from "yjs";
import { CollabProvider, type Peer } from "./provider";
import { newRoomKey, parseRoomKey, roomLink } from "./link";
import { trysteroTransport } from "./transport";

// Phase 0 of the collaboration plan: prove the transport, not the product.
//
// Served by the dev server only. Vite's build takes index.html alone, so nothing here
// ships. The textarea binding below is deliberately throwaway: Phase 1 binds CodeMirror
// with y-codemirror.next and this goes away.

const $ = <T extends HTMLElement>(id: string): T => document.getElementById(id) as T;
const linkBox = $<HTMLInputElement>("link");
const pad = $<HTMLTextAreaElement>("pad");
const peerList = $<HTMLUListElement>("peers");
const state = $<HTMLElement>("state");
const logBox = $<HTMLElement>("log");

const started = Date.now();
function log(message: string): void {
  const at = ((Date.now() - started) / 1000).toFixed(1).padStart(5);
  logBox.textContent += `${at}s  ${message}\n`;
  logBox.scrollTop = logBox.scrollHeight;
}

const NAMES = ["Ada", "Grace", "Alan", "Edsger", "Barbara", "Ken", "Radia", "Margaret"];
const COLOURS = ["#e5484d", "#3fb950", "#4c8dff", "#d29922", "#a371f7", "#00b3a4"];
const pick = <T>(xs: T[]): T => xs[Math.floor(Math.random() * xs.length)];

/**
 * A minimal textarea binding: turn "the value changed" into the smallest insert and
 * delete that explains it, so two people typing in different places actually merge
 * instead of overwriting each other with whole-value replacements.
 */
function bindTextarea(ta: HTMLTextAreaElement, ytext: Y.Text): void {
  let local = false;

  const render = (): void => {
    const next = ytext.toString();
    if (ta.value === next) return;
    const { selectionStart, selectionEnd } = ta;
    ta.value = next;
    // Good enough for a spike: a remote edit before the caret will nudge it.
    ta.setSelectionRange(Math.min(selectionStart, next.length), Math.min(selectionEnd, next.length));
  };

  ytext.observe(() => {
    if (!local) render();
  });

  ta.addEventListener("input", () => {
    const next = ta.value;
    const prev = ytext.toString();
    if (next === prev) return;

    let start = 0;
    while (start < prev.length && start < next.length && prev[start] === next[start]) start++;
    let endPrev = prev.length;
    let endNext = next.length;
    while (endPrev > start && endNext > start && prev[endPrev - 1] === next[endNext - 1]) {
      endPrev--;
      endNext--;
    }

    local = true;
    ytext.doc?.transact(() => {
      if (endPrev > start) ytext.delete(start, endPrev - start);
      if (endNext > start) ytext.insert(start, next.slice(start, endNext));
    });
    local = false;
  });

  render();
}

/**
 * A cheap fingerprint of the shared text (FNV-1a). Each peer publishes its own through
 * presence, so any one browser can tell whether the others have actually converged on
 * the same content. Proving that is the entire point of the spike, and checking it from
 * one side is the only way when the second browser cannot be scripted.
 */
function digest(s: string): string {
  let h = 0x811c9dc5;
  for (let i = 0; i < s.length; i++) {
    h ^= s.charCodeAt(i);
    h = Math.imul(h, 0x01000193) >>> 0;
  }
  return `${s.length}:${h.toString(16)}`;
}

function renderPeers(peers: Peer[], mine: string): void {
  peerList.textContent = "";
  if (!peers.length) {
    const li = document.createElement("li");
    li.className = "empty";
    li.textContent = "nobody else yet";
    peerList.appendChild(li);
    return;
  }
  for (const peer of peers) {
    const li = document.createElement("li");
    const dot = document.createElement("span");
    dot.className = "dot";
    dot.style.background = peer.colour;
    const theirs = typeof peer.selection === "string" ? peer.selection : "?";
    const agrees = theirs === mine;
    li.dataset.digest = theirs;
    li.dataset.agrees = String(agrees);
    li.append(dot, document.createTextNode(`${peer.name} ${agrees ? "in sync" : "differs"}`));
    peerList.appendChild(li);
  }
}

// A link already in the fragment means we were invited; otherwise start a room.
const invited = parseRoomKey(location.hash);
const key = invited ?? newRoomKey();
if (!invited) location.hash = new URL(roomLink(key)).hash;
linkBox.value = roomLink(key);
log(invited ? `joining room ${key.roomId}` : `started room ${key.roomId}`);

const transport = trysteroTransport({ roomId: key.roomId, secret: key.secret });
const provider = new CollabProvider(transport);
const shared = provider.doc.getText("spike");

const me = { name: pick(NAMES), colour: pick(COLOURS) };
const announce = (): void => provider.setPresence({ ...me, selection: digest(shared.toString()) });
announce();
bindTextarea(pad, shared);

state.textContent = "waiting for a peer ...";
const paint = (peers: Peer[]): void => {
  renderPeers(peers, digest(shared.toString()));
  state.textContent = peers.length
    ? `connected to ${peers.length} peer${peers.length > 1 ? "s" : ""}`
    : "waiting for a peer ...";
};
provider.onPeersChanged(paint);
shared.observe(() => {
  announce(); // republish our fingerprint, which repaints both sides' verdicts
  paint(provider.peers());
});

transport.onPeerJoin((id) => log(`peer joined: ${id}`));
transport.onPeerLeave((id) => log(`peer left: ${id}`));

$("copy").addEventListener("click", () => {
  void navigator.clipboard.writeText(linkBox.value).then(() => log("link copied"));
});
$("fresh").addEventListener("click", () => {
  location.hash = new URL(roomLink(newRoomKey())).hash;
  location.reload();
});

window.addEventListener("pagehide", () => void provider.destroy());

// Handy from the console during the two-browser run.
Object.assign(window, { provider, transport, Y });
