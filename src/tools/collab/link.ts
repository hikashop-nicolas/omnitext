// The collaboration link.
//
// Both halves live in the URL fragment, never in the path or the query. A fragment is
// not sent to the server, so the static host never sees which rooms exist, let alone
// their secrets. Everything else about this is a trade-off stated plainly in the plan:
// the link is the key, and anyone who ever sees it is in.

/** Bytes of room id and of secret. The id only has to be unique; the secret has to resist guessing. */
const ID_BYTES = 8;
const SECRET_BYTES = 16;

const KEY = "collab";
/** Not in the base64url alphabet, so it cannot occur inside either half. */
const SEP = ".";

export interface RoomKey {
  roomId: string;
  secret: string;
}

function base64url(bytes: Uint8Array): string {
  let s = "";
  for (const b of bytes) s += String.fromCharCode(b);
  return btoa(s).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
}

function randomToken(size: number): string {
  const bytes = new Uint8Array(size);
  crypto.getRandomValues(bytes);
  return base64url(bytes);
}

export function newRoomKey(): RoomKey {
  return { roomId: randomToken(ID_BYTES), secret: randomToken(SECRET_BYTES) };
}

const VALID = /^[A-Za-z0-9_-]+$/;

/** Parse a fragment such as "#collab=abc.def", tolerating other fragment parameters. */
export function parseRoomKey(hash: string): RoomKey | null {
  const raw = hash.startsWith("#") ? hash.slice(1) : hash;
  if (!raw) return null;
  for (const part of raw.split("&")) {
    const eq = part.indexOf("=");
    if (eq < 0 || part.slice(0, eq) !== KEY) continue;
    const [roomId, secret, ...rest] = part.slice(eq + 1).split(SEP);
    if (rest.length || !roomId || !secret) return null;
    if (!VALID.test(roomId) || !VALID.test(secret)) return null;
    return { roomId, secret };
  }
  return null;
}

/** The link to hand to someone else. Keeps any fragment parameters already present. */
export function roomLink(key: RoomKey, href: string = location.href): string {
  const url = new URL(href);
  const others = (url.hash.startsWith("#") ? url.hash.slice(1) : url.hash)
    .split("&")
    .filter((p) => p && !p.startsWith(`${KEY}=`));
  url.hash = [...others, `${KEY}=${key.roomId}${SEP}${key.secret}`].join("&");
  return url.toString();
}

/**
 * The same URL with the room dropped. Used after joining, so the secret stops sitting in
 * the address bar where a screen share or a synced history would pick it up. It is a
 * mitigation and not a fix: whoever sent the link still has it.
 */
export function withoutRoom(href: string = location.href): string {
  const url = new URL(href);
  const others = (url.hash.startsWith("#") ? url.hash.slice(1) : url.hash)
    .split("&")
    .filter((p) => p && !p.startsWith(`${KEY}=`));
  url.hash = others.join("&");
  return url.toString();
}
