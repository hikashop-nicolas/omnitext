// A relay server, supplied by whoever is using the app.
//
// Two peers whose networks cannot be joined directly never connect, and this app runs no
// relay for them: there is nobody to pay for one, and routing everyone's document through
// a server we operate would undo the point of the thing. So the relay is the user's own,
// and most people will never need one.
//
// Trystero takes these through `turnConfig` rather than `rtcConfig`, which matters: a
// custom `rtcConfig.iceServers` REPLACES its default STUN servers, so adding a relay that
// way would remove the discovery that makes most connections work. `turnConfig` adds to
// them instead.

export interface TurnSettings {
  /** One or more turn:/turns: URLs, separated by commas or whitespace. */
  url: string;
  username: string;
  credential: string;
}

export type TurnProblem =
  /** Nothing entered. Not an error: no relay is the normal case. */
  | "empty"
  /** A URL that is not turn: or turns:. A stun: URL here would do nothing. */
  | "scheme"
  /** A relay needs both, and a half-filled one fails at connection time instead. */
  | "credentials";

export interface TurnResult {
  /** Ready for Trystero's turnConfig. Empty unless everything checks out. */
  servers: RTCIceServer[];
  /** Why nothing is being used, or null when the servers are good. */
  problem: TurnProblem | null;
}

const SCHEME = /^turns?:/i;

/**
 * Read what the user typed into something usable, or say why it is not.
 *
 * Deliberately strict about the scheme. A stun: URL pasted in here is the likely mistake,
 * and it would be accepted by the browser, do nothing for the case the field exists for,
 * and leave the person believing they had configured a relay.
 */
export function turnServers(settings: TurnSettings | null | undefined): TurnResult {
  const urls = (settings?.url ?? "")
    .split(/[\s,]+/)
    .map((u) => u.trim())
    .filter(Boolean);
  if (!urls.length) return { servers: [], problem: "empty" };
  if (!urls.every((u) => SCHEME.test(u))) return { servers: [], problem: "scheme" };

  const username = (settings?.username ?? "").trim();
  const credential = (settings?.credential ?? "").trim();
  // Almost every relay needs both. One without the other is a typo, and letting it through
  // turns a fixable mistake into a connection that fails for no stated reason.
  if (!username || !credential) return { servers: [], problem: "credentials" };

  return { servers: [{ urls, username, credential }], problem: null };
}
