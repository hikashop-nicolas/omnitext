# Collaboration plan

Drafted 2026-07-28. **Phase 0 done 2026-07-30** (see section 7b); phases 1 to 5 open.

Goal: two or more people editing the same document at the same time, with no server,
no accounts, and no loss of the round-trip fidelity every format in this project is
built around. The targets are **sheetedit, richdoc and subedit**, not text alone.

## 1. The two honest constraints

**Collaboration binds per editor, not to the core.** The founding plan assumed a
uniform mechanism and its review (`archive/plan-review.md`, A6) showed why there
cannot be one: a CRDT binds to the editing surface's own model, and our four surfaces
have nothing in common. CodeMirror is a character sequence, subedit is a list of cues,
sheetedit is an address-keyed grid whose cells hold live pointers into the source XML,
richdoc is a contenteditable projection of a docx body. So the core provides a session,
a transport and a presence channel, and each editor provides a binding. Four bindings,
four separate bodies of work, shipped one at a time.

**Collaboration shares the edits, not the document.** This is the part the founding
plan never faced, because it only ever considered text. For text the CRDT state *is*
the document. For xlsx, docx and (partly) subtitles it cannot be: the model holds
element references into the parsed source and the fidelity of the save depends on the
original bytes. `Cell.el` in sheetedit is a live `Element` in the worksheet DOM; richdoc
carries the original XML in `data-docx-xml` attributes. None of that is serialisable
into a CRDT and none of it should be.

So a session is: **one immutable base file, agreed at the start, plus a CRDT of logical
edits.** Every peer holds its own copy of the base and its own parsed model, and applies
remote edits through the same public mutators it uses for local ones. Convergence comes
from the CRDT ordering the edits, not from shipping state around.

That gives a consequence worth stating up front: peers converge on *content*, and their
saved files will be equivalent but are not guaranteed byte-identical. Anyone can save,
and what they save is correct. Nobody's save is authoritative over anyone else's.

## 2. Architecture

### Core: one Tool module, editor-agnostic

`src/tools/collab.ts`, activated like `history.ts`, owning:

- **Session lifecycle.** Start a session (become host), join one from a link, leave.
  One session at a time, tied to the active document.
- **Transport.** Yjs `Y.Doc` + a WebRTC provider (Trystero; see section 7b for why, and
  `src/tools/collab/`). Room id and secret live in the URL fragment, so the static host
  never sees either. What the secret protects is stated precisely in section 6.
- **Base transfer.** On join, the host sends the base bytes over the data channel,
  chunked, with a hash. See section 4.
- **Presence.** Yjs awareness: peer name (self-chosen, no identity), colour, and an
  opaque per-editor selection token.
- **UI.** Share button, peer list, connection state, a leave action, and the honest
  warnings from section 6.

Nothing in this layer knows what a cue or a cell is.

### Per editor: a binding

Added to `EditorInstance` as an optional capability, replacing the dead `applyRemote`
hook (which assumed the core could describe a change generically; it cannot):

```ts
interface CollabBinding {
  /** Mirror local edits into the shared doc, and remote ones back into the editor. */
  bind(shared: Y.Doc, ctx: { seed: boolean; readOnly: boolean }): void;
  /** This peer's selection, to publish through awareness. Opaque to the core. */
  localSelection(): unknown;
  /** Draw the other peers' selections. */
  renderPeers(peers: { id: string; name: string; colour: string; selection: unknown }[]): void;
  unbind(): void;
}

interface EditorInstance {
  collab?(): CollabBinding | null;   // null: this editor cannot collaborate yet
}
```

`seed` is true for exactly one peer, the one that started the session. It populates the
shared doc from the local model. Joiners must never seed, or the document doubles.

An editor without a binding degrades to a clear message rather than a broken session.
That is most of the forty editors, and that is fine: the viewers have nothing to share.

## 3. The four bindings

Ordered by how much they cost, which is also the order to build them.

### 3.1 CodeMirror (the spike)

`y-codemirror.next` exists and is mature. A `Y.Text` mirrors the document; remote cursors
come free. This is perhaps a day of work once the core layer is up.

Its purpose is not the feature. It is to prove the session, transport, base transfer,
presence and UI against the easiest possible binding, so that when subedit's binding is
wrong we know it is subedit's binding that is wrong.

### 3.2 subedit

The best-fitting of the three, and the right first real target.

Shared shape:

- `Y.Array` of cue entries, each a `Y.Map` with `startMs`, `endMs`, `text`,
  `identifier`, `settings`, `notesBefore`, `assKind`, `assFields`.
- `Y.Map` for document-level state: ASS styles, script info, format.
- Cue text as a `Y.Text` if we want two people inside one cue to merge character by
  character. Probably not worth it in v1: cues are short and people work on different
  ones. Start with last-writer-wins per cue field and revisit.

Why it fits: cues are independent records with a stable `Cue.id` already used for list
keys and selection, timings are scalars, and the failure mode of a conflict is a wrong
line in one cue, not a corrupt file.

Presence is genuinely useful here: highlight the cue each peer has selected, and show
their playhead.

Prerequisites in `~/dev/subedit`:

- An edit path that is not "replace the whole doc": today edits go through full-model
  operations and a whole-model undo stack (`HistorySnap` deep-clones everything). The
  binding needs a per-cue mutation API and a change signal that says which cue changed.
- `Cue.id` is ephemeral and not persisted, which is correct and stays correct: only the
  seeder's ids ever enter the shared doc, and joiners adopt them with the cue list.
- Interaction with the local undo stack: undoing must produce CRDT operations, not
  reinstate a whole model behind the CRDT's back. Yjs `UndoManager` scoped to this
  peer's own origin is the standard answer.

### 3.3 sheetedit

Shared shape:

- `Y.Map` keyed by `"SheetName!R1C1"`, value = the cell's raw input (the string
  `setCellInput` takes) plus its format. Each peer applies remote entries through
  `setCellInput` and recalculates locally.
- Sheet list, names and order in a small `Y.Array`.

Sharing the *input* rather than the computed value is the key choice: the formula engine
is deterministic, so every peer recalculates to the same result from the same inputs, and
the shared doc stays tiny. The exceptions are the volatile functions (NOW, TODAY, RAND),
which already differ per peer today and will keep differing. That is acceptable and
should be said in the docs, not hidden.

Cell-level last-writer-wins is the right granularity. Two people typing into the same
cell is a genuine conflict with no good automatic answer, and it is rare; two people
typing into different cells must both survive, and with an address-keyed map they do.

**The hard part is structural operations.** Insert a row and every address below it
shifts, so a concurrent cell edit keyed by address lands in the wrong place. A row-identity
`Y.Array` would solve it in theory and fights sheetedit's model everywhere: the grid,
the formulas and the XML elements are all index-addressed.

Proposal: **host-arbitrated structure, CRDT-merged content.** Content edits merge freely
through the CRDT. Structural operations (insert/delete row or column, add/remove/reorder
sheet) are requested, serialised by the host, and applied by everyone in the host's order,
with content edits briefly paused. One writer for structure removes the concurrency
entirely, at the cost of a visible half-second pause and a dependency on the host being
present. Phase one may simply disable structural edits for guests, which is honest and
much less work; see the go/no-go in section 7.

Prerequisites in `~/dev/sheetedit`:

- A change signal carrying the address and the new input, rather than "something changed".
- A public "apply this input at this address without emitting a change event" path, so
  applying a remote edit does not echo back into the shared doc.
- ~~ActiveX controls, Power Query, pivots, slicers and the like are **out of scope**: they
  are file features, not concurrent editing surfaces. They travel in the base file and
  are not shared state.~~ **Reversed 2026-08-01** at the user's direction: anything a
  person can change during a session has to be shared, whatever kind of thing it is. See
  section 8, the coverage audit.

### 3.4 richdoc

The hardest, and the one to do last.

richdoc's undo is whole-body HTML snapshots (`src/core/feature/history.ts`), and the body
has no stable node identity: a paragraph is just a position in the cleaned body. Both have
to change before there is anything to bind to.

Shared shape:

- `Y.Array` of block ids, giving the body order.
- `Y.Map` from block id to block content. For a plain paragraph, a `Y.Text` of its inline
  HTML so two people can type in the same paragraph and merge. For tables, images,
  fields, comment markers and anything carrying `data-docx-xml`, last-writer-wins on the
  whole block: they are structured payloads where a character-level merge produces
  nonsense.

That "text merges, structure replaces" split is the standard compromise and it is the
honest one for a format whose fidelity lives in opaque XML attributes.

Prerequisites in `~/dev/richdoc`:

- Stable block ids: a `data-rdoc-bid` on each logical block, generated on parse,
  preserved through pagination reflow, and stripped by `cleanBody` on save.
- A mutation observer or an explicit commit path that reports *which block* changed
  rather than handing back the whole body.
- Undo reworked to produce operations for the changed blocks. This is the largest single
  piece of work in the plan.
- Pagination is a local view concern and must stay out of the shared doc entirely.

## 4. The base file

On join:

1. The joiner announces the hash of the document it has open, or nothing if it has none.
2. If the hashes match, no transfer: both peers already hold the same base.
3. Otherwise the host sends the base bytes, chunked over the data channel, with a hash
   the joiner verifies.
4. If the joiner has a *different* document open and unsaved, it refuses and says so.
   Never silently replace someone's work with the host's.

The base is immutable for the life of the session. Changing it (opening another file)
ends the session rather than renegotiating.

Size is a real limit: a 40 MB workbook over WebRTC to five peers is 200 MB of upload from
one browser. Cap the base at something defensible, warn above it, and refuse above a hard
ceiling.

## 5. Interaction with history

The history tool and the collaboration tool are independent, and the recent history work
is what makes collaboration tolerable to ship.

- Snapshot on joining and on leaving a session, as deliberate labels. Once a remote peer
  can change your document, the ability to see the state before they arrived and restore
  it is the safety net.
- Remote edits are real edits: they must mark dirty and drive autosave exactly as local
  ones do. Crash recovery must not care where a change came from.
- The automatic snapshot deadline now fires during continuous editing, which a busy room
  looks like. The per-key cap and the content dedupe bound the result, but watch it: if a
  four-person room fills a document's history with automatic snapshots, the fix is an
  origin filter on the deadline, not a bigger cap.

## 6. Security, stated plainly

The threat model in `archive/plan.md` still holds and still applies; it is not repeated
here. The essentials, which must appear in the UI and not only in the docs:

- **What the secret actually does**, corrected from the first draft, which said payloads
  are encrypted with a key derived from it. They are not. The secret is Trystero's room
  password: it encrypts the session descriptions passing through the relay (AES-GCM), so
  someone who learns the room id but not the secret cannot complete a handshake. Document
  traffic is then encrypted by WebRTC's own DTLS, peer to peer. The end-to-end claim
  holds and no relay ever sees content, but it is DTLS doing that work, not the link.
- The link is the key. Anyone who ever sees it is in, forever. There is no identity, no
  revocation and no forward secrecy.
- The fragment leaks through synced browser history, copy and paste, screen sharing, and
  any extension that reads `location.hash`.
- Relays see metadata; WebRTC exposes peer IP addresses to the other peers.
- An authorised peer can wreck the document. Presence and history are the only defence.

Call it "no server, end-to-end encrypted, the link is the key". Never call it secure.

Two mitigations worth building in from the start rather than bolting on: a **view-only
link** (the binding simply does not write), and **rotate the link**, which re-keys the
room and drops everyone who has not been given the new one.

## 6a. Removing someone (built 2026-07-30)

"Rotate the link" turned out to be most useful shaped as "remove this person", so that is
what it is. The distinction that matters:

- **Closing their connection would be theatre.** They still hold the link, and a Trystero
  identity is fresh on every page load, so there is nothing to blocklist them by.
- **Re-keying is enforceable.** Everyone else is told the new room over the connections
  that already exist. The removed peer is not, and is left holding a key to a room nobody
  is in. A test asserts exactly this: a squatter who ignores the eviction and sits in the
  old room sees nothing further.

The new key travels **hop by hop**, each peer forwarding to its own peers except the sender
and except the one being removed. That is not gold-plating: the mesh is not complete, so a
peer the host cannot see still gets the key from whoever can see it. Where no path avoids
the removed peer, `remove()` reports who was stranded so they can be re-invited, instead of
losing them silently.

**Their copy also closes**, and the crash-recovery snapshot is deleted so a reload does not
bring it back. This is a courtesy, not a boundary: a modified app could ignore it, and the
UI says so. It costs nothing to be wrong about, because nothing is lost to the group -
every other peer still holds the edits that side contributed. History from before the
session is that person's own earlier data and is left alone.

**What removal cannot do**, and the panel says this rather than implying otherwise: recall
what they have already seen. If they saved a copy, it is theirs.

## 7. Phases and gates

| Phase | Work | Gate before starting |
|---|---|---|
| 0 | **Done.** Transport spike: Yjs + WebRTC provider, room from fragment, no editor | Provider confirmed maintained, and the answer inverted the review's guess (7b) |
| 1 | **Done.** Core Tool: session, presence, peer list, base transfer, share UI, CodeMirror binding, chat, removal | Phase 0 synced Chrome/Safari, and laptop-to-phone across NAT (7b) |
| 2 | subedit binding, plus its per-cue mutation API and scoped undo | **Met.** Two people edited one text file end to end (7c) |
| 3 | **Done.** sheetedit binding, cell content only; structural edits refused during a session | Phase 2 shipped and used |
| 4 | **Done and verified in two tabs.** sheetedit structural operations, host-arbitrated | Phase 3 refused them outright, so everyone hit it |
| 5 | **Done, presence included.** richdoc: block ids, per-block change reporting, operation-based undo, binding | Phases 2 and 3 shipped; this is the largest piece and should not be first |

Phases 3 and 5 each carry a prerequisite body of work in another repository. Those are
not incidental; budget them as their own tasks.

### What phase 5 came out as (2026-07-31)

Built as designed in 3.4, with three things worth writing down.

**Block reporting is a subscription, not an option.** Working out which blocks changed
walks every block on every keystroke. As a constructor option that was paid by every
document, including the overwhelming majority nobody shares; `setBlockReporter` also fixes
the diff baseline at the moment of subscribing, which is the correct instant.

**Structured blocks are stored as a plain string, not a Y.Text.** The plan said last writer
wins for tables, images and `data-docx-xml` passthroughs, and a Y.Text cannot express that:
two peers who each clear one and insert their own version converge on both versions, one
after the other, which is exactly the nonsense being avoided. A Y.Map entry set to a string
resolves to one of the two. A block changes type when it changes kind, so pasting an image
into a paragraph stops it merging and deleting one starts it again. A test found this; the
first implementation was wrong in the way the plan's own reasoning warned about.

**Presence is a block id and an offset into that block**, the same pair the history module
already records to restore a caret. Nothing else survives: a DOM node does not outlive a
repagination, and a document-wide offset moves whenever anyone types above it. Peers'
carets are drawn in an overlay, never inserted into the body, or they would land in the
undo history, in the saved file, and in the next per-block diff.

**Two bugs here were only findable in a browser**, and both made the feature useless while
every test passed:

1. A joiner never bound at all. richdoc's editor is inflated off the main thread, so it
   does not exist when the base file arrives, which is exactly when a joiner binds. `bind`
   found no editor and returned. The pair test's mock resolved immediately, which is the
   one timing the real app never has; it now takes 30ms.
2. Every remote edit threw the local caret to the top of the document. Replacing a block's
   element breaks a selection inside it, and Chrome collapses the selection to the start of
   the body even when the caret was elsewhere. `applyRemoteBlocks` now saves and restores
   the caret. jsdom does not reproduce Chrome's collapse, so the test covers only the
   narrower case and says so.

Blocks added, removed or moved still rebuild the body, and the caret survives that too.
The scroll position was lost at first and is now restored by anchoring to a block rather
than to a scrollTop, which a repagination invalidates.

### Pair tests, added before phase 5

Every phase up to here shipped with each side tested and the join between them not. That
is where the bugs were, without exception: a veto naming no sheet, a joiner that never
bound, a peer marker whose ids could not match. So each repository now has a test that
runs two of the thing at once.

- subedit and sheetedit: two editors on one page, wired as a host wires them. No network.
- Omnitext: two whole sessions over the real BroadcastChannel transport with the real
  bindings, in `session-pair.test.ts` and `sheet-pair.test.ts`. Only the editor widget is
  stubbed, because it needs a browser and belongs to the other repository anyway.

Writing the Omnitext pair found that view-only was not enforced for either the subtitle or
the sheet editor. `readOnly` reached the bindings and was used only to skip the undo
manager, so anyone given a view-only link could edit the shared document and everyone saw
it. Both bindings now drop their own edits while view-only, and the sheet also refuses
structural edits outright rather than applying them locally. Neither editor library has a
read-only mode, so the binding is the only place this can be enforced.

## 7a. How to test two peers

Two different browsers on one machine, not two tabs and not two machines.

Two browsers exercise what the spike is for: the signalling path through the real relay,
the data channel, the base-file transfer, presence, and two separate IndexedDB stores.
Chrome and Firefox together also test interop between two WebRTC implementations, which is
where this usually breaks. Two tabs in one browser share too much to prove anything.

What one machine cannot test is NAT traversal: both peers connect over loopback and never
need a STUN or relay candidate. The laptop-on-wifi / phone-on-cellular version was run on
2026-07-30 and passed; section 7b has the method and the caveat. Serve the page over
`adb reverse` rather than the LAN, otherwise the HTTP path hands the two peers a shared
network and the test proves nothing.

## 7b. Phase 0 result (2026-07-30)

**The provider gate resolved the other way round.** The founding review flagged Trystero
as the maintenance risk. The registry says the opposite, and it is not close:

| | last release | releases in 24 months | repo last pushed |
|---|---|---|---|
| y-webrtc | 2023-12 | 0 of 34 | 2024-04 |
| simple-peer (y-webrtc's transport) | 2022-02 | 0 | 2024-06, 128 open issues |
| Trystero | 2026-07 | 20 of 78 | 2026-07, 7 open issues |

So the spike is built on **Trystero** (nostr strategy, 42 KB), and the y-webrtc route was
declined: it is two years dormant on top of a four-year-dormant WebRTC wrapper. Trystero
is not a Yjs provider, so we write that layer, which turns out to be a feature rather than
a cost. `src/tools/collab/`:

- `transport.ts` - the `CollabTransport` interface plus the Trystero adapter. The provider
  is written against the interface, never against Trystero. That is what lets the tests
  run with no network, and it means changing strategy (nostr to mqtt, or a self-hosted
  relay) touches one file.
- `provider.ts` - Yjs sync + awareness over a transport, and nothing else.
- `link.ts` - room id and secret, generated and parsed, fragment only.
- `spike.ts` + `/collab-spike.html` - the probe. Dev-server only: Vite's build takes
  `index.html` alone, so this ships nowhere, and the shipped bundle gained zero bytes
  (nothing in the app imports any of it yet).

**What was proven.** 33 tests, and each one checked by breaking the thing it guards:
removing the origin check, dropping the sync handshake, skipping the departure notice and
reverting the peer-hook fan-out each failed exactly the test meant to catch it. The suite
includes a partition test that asserts peers do *not* converge when sync is dropped, so
the convergence assertions cannot pass vacuously against two empty documents.

Then the real gate, Chrome and Safari on one machine, which is a sterner pairing than the
Chrome/Firefox the plan asked for since WebKit's WebRTC is the most divergent of the
three: connected through the public relay in a few seconds and synced **both ways**. The
spike publishes a digest of its own text through awareness, so either browser shows
whether the other has genuinely converged rather than merely staying quiet.

**NAT traversal, then tested for real the same day, and it works.** Mac on home wifi behind
the household NAT, Android phone with wifi switched off so cellular was its only route.
The page itself was served over the USB cable (`adb reverse tcp:5173`), which keeps the
HTTP path from quietly giving the two a shared network: the only thing they had in common
was the public internet.

The phone's sole address was `100.114.200.62`, inside `100.64.0.0/10`, so it was behind
**carrier-grade NAT** - the awkward case, and usually symmetric. They connected in **2
seconds** and synced both ways, verified by typing on each end and reading the other.

That result is stronger than it looks, because Trystero's default `rtcConfig` carries only
STUN (Cloudflare and Google) and no TURN at all. With no relay configured, a relayed path
was not available: the connection was necessarily direct, through STUN-discovered
candidates, straight through CGNAT.

**The remaining risk is the inverse of the good news.** One carrier, one NAT, one moment
is not every carrier, and some symmetric NATs genuinely cannot be traversed. Because there
is no TURN configured, such a pair does not fall back, it simply fails. Trystero accepts a
`turnConfig`, so before this ships widely the choice is to offer a TURN server or to detect
the failure and say plainly that these two networks cannot be joined. Silently spinning on
"connecting" is the one outcome to avoid.

**Done, as the second of those two (2026-07-31).** A joiner's panel says it is still
connecting after 20 seconds, and after 60 says plainly that the two could not be reached,
that some networks cannot be joined directly, and that this app runs no relay for the
document. Inferred from time passing, because Trystero cannot report an ICE failure to us;
the comment in `session.ts` says so rather than implying the app knows more than it does.
A host is never told anything of the kind: it is waiting on a person, and no length of
time makes that a failure.

**TURN is the user's own, entered in Settings (2026-07-31).** The app runs no relay and
should not: someone has to pay for one, and routing everyone's document through a server we
operate would undo the point of the thing. So the field takes a relay you already have, and
most people will never fill it in.

Passed to Trystero as `turnConfig`, not folded into `rtcConfig.iceServers`. That matters: a
custom `iceServers` REPLACES Trystero's default STUN list, so configuring a relay that way
would remove the discovery that makes most connections work without one.

A relay that would not be used does not save. A `stun:` URL in that field is the likely
mistake and the browser would accept it, so it is refused by name; so is a relay missing
half its credentials. Both otherwise fail at connection time, minutes later, with nothing
pointing at the field that was wrong. The credentials sit in localStorage in plain text
like every other setting, and the panel says so rather than leaving it to be discovered.

**Verified end to end against a real relay.** A local coturn (loopback, throwaway
credentials, `allow-loopback-peers` since both peers were tabs on one machine), and both
browsers patched from the test side to force `iceTransportPolicy: "relay"`, so no direct
path was available and a session that worked could only have gone through the relay. It
worked: both ends chose `typ relay` candidates in coturn's configured port range, the docx
transferred, and an edit crossed. coturn's own log agreed, with 41 authenticated
allocations and about 390 kB relayed.

Two checks made that result mean something. A deliberately wrong password produced `401
Unauthorized` and no candidate at all, so a relay candidate proves an authenticated
allocation rather than a server that accepts anything. And the config the app handed to
`RTCPeerConnection` carried four default STUN servers **plus** the relay, which is the
`turnConfig` decision above holding in practice: configuring a relay adds to the discovery
that makes most connections work rather than replacing it.

**One correction fell out of this**, in section 6: the draft claimed payloads are
encrypted with a key derived from the link secret. They are not, and the honest version
is now written there.

### The mesh is not complete, and the provider no longer assumes it is

Trystero issues [#161](https://github.com/dmotz/trystero/issues/161) (peer-assisted
signalling) and [#151](https://github.com/dmotz/trystero/issues/151) both report the same
thing from different users: in a room of three or more, some pairs never connect. A sees C,
B sees C, A and B never see each other.

The first version of the provider assumed a full mesh and therefore did not relay anything
it received. A test with one pair unlinked showed what that costs: **A's edits never
reached B, and the two diverged in silence.** That is the worst failure this system can
have, since both peers look connected and both look correct.

Two mechanisms now guard it, and each was verified by removing it and watching the right
tests fail:

1. **Relay.** A remote update that genuinely changed our document is passed on to every
   peer except the sender. Yjs discards an update it already holds, so this dies out
   instead of circulating. In a two-peer room it sends nothing at all.
2. **Periodic state-vector exchange**, every 15s and on demand via `requestResync()`.
   Relaying cannot fix a message lost on a *working* link, because Yjs updates are deltas
   and nobody notices a gap. Comparing state vectors heals it whatever the cause: a
   dropped frame, a reconnection, a peer that was briefly unreachable. Note it is a pull,
   so it repairs the peer that asks; every peer running the same timer is what makes it
   symmetric.

**On issue #161 specifically:** it would help, but not with NAT. Peer-assisted signalling
carries *signalling* through a third peer so two peers can complete a handshake they would
otherwise miss. It cannot help two peers whose networks cannot be joined; that is what TURN
is for. It is worth having, and worth watching, but it is an open issue with no
implementation, and the two mechanisms above make the Yjs layer converge regardless of
topology. We do not depend on it.

## 7c. Phase 1 result (2026-07-30)

Two people edit one text file in Omnitext: `src/tools/collab.ts` (the Tool) and
`src/tools/collab/session.ts` (the lifecycle). The session takes what it needs through a
`SessionHost` interface rather than `HostAPI`, so the whole lifecycle is tested with no
browser, no network and no editor.

**Where this departed from the draft, and why.**

- **The binding interface is two methods, not four.** The draft had `bind`, `unbind`,
  `localSelection` and `renderPeers`. Handing the binding the *awareness* object makes the
  last two unnecessary: y-codemirror.next draws remote cursors from it directly, and an
  editor that wants to render presence itself can read the same object. So `CollabContext`
  carries the document, awareness, `seed` and `readOnly`, and that is all.
- **Presence relays**, like document updates. Without it a partial mesh leaves people
  invisible to each other, and you cannot remove someone you cannot see.
- **Chat**, not in the draft at all. It rides in the shared document as a `Y.Array`, which
  buys ordering, history for late joiners and the partial-mesh handling for nothing. Its
  order is CRDT order: the same for everyone, and NOT sorted by timestamp, because peers'
  clocks are not synchronised and sorting by them would show different people a different
  conversation.
- **"Rotate the link" became "remove someone"**, which is the useful shape of it. See
  section 6a.

**Four bugs came out of running it in the app, none of which the tests would have found.**
They are recorded because they are all the same shape: the seams between the session and
the application.

1. A joiner already holding the same file transferred nothing and so never bound, because
   "nothing to do" had no signal.
2. `openFile` mounts the editor asynchronously, so `openBase` returned early and the
   session bound to the editor being *replaced*. For a recovered document that editor may
   not collaborate at all, which is exactly what happened.
3. Pasting an invitation into a tab that already has Omnitext open changes only the
   fragment, which does not reload the page, so the commonest way to accept an invitation
   did nothing.
4. Presence lacked the `user.name` / `user.color` field every off-the-shelf Yjs binding
   reads, so every remote cursor was labelled "Anonymous".

**One thing CI caught that local runs did not:** an assertion that chat messages appear in
send order. Yjs orders concurrent inserts by client id, so two people typing at the same
moment can land either way round. It passed locally only because the first message had
already propagated.

**Worth knowing for the next live test.** The public nostr relays take between roughly 13
and 26 seconds to pair two peers, and it varies. A 25-second timeout looked like a
transport regression until the unchanged spike page connected in 26. Bisect against the
spike before believing a regression.

## 7d. Phase 3 (sheetedit), and the gap it exposed

The shape and the library API are built and tested. Cells are keyed by `"r,c!Sheet"` in a
`Y.Map` of the **inputs people typed**, never the computed values: the formula engine is
deterministic, so every peer recalculates the same results, and the shared state stays
small. Volatile functions (NOW, TODAY, RAND) already differ between peers and will keep
differing; that is stated rather than hidden. sheetedit gained `cellInputs`,
`onCellsChanged` and `applyRemoteCells`, with 8 e2e tests; the shared shape has 13.

**Two things the live run found that no test would have.**

1. **An untitled document travelled under a name with no extension**, so the receiving
   side's format detection made a shared spreadsheet into plain text and the grid was
   never offered. Fixed: an unnamed base now travels as `untitled` plus its format's
   extension.

2. **A binding belongs to an editor, and nothing checks that two peers are using the same
   one.** A CSV opens in the text editor by default and in the grid on request. If one
   person is in the grid and the other in the text view, one binds `sheet.cells` and the
   other binds `codemirror`, so they sit in a session that reports itself connected while
   neither ever sees the other's edits. This is the worst failure mode available: it looks
   exactly like working.

   **Fixed, in two parts.** The seeder records its editor in a core-owned `collab.meta`
   map, and a joiner whose editor differs refuses to bind, saying which view the session is
   being shared through.

   The second part corrects a wrong first attempt. Switching view mid-session was made to
   re-attach the binding to whatever the person switched to, which is obliging and unsafe:
   the shared shape belongs to the editor, so the new binding finds its own shape empty.
   A seeder would write a second shape into the same document while everyone else stayed
   on the first and saw nothing; a joiner would adopt an empty shape and blank its own
   screen. Neither announces itself. **A running session now pins the editor** and the
   switch is refused through the existing `willChangeEditor` hook, with leaving the session
   as the way to change view.

## 7e. Presence, names, and structural edits (2026-07-31)

**Presence.** Each binding publishes where this peer is through awareness and draws the
others. CodeMirror had it already through y-codemirror.next; subedit marks the cue and
sheetedit outlines the cell, in the peer's colour. Several people on one cue or cell share
a single border, since a border can only be one colour, and get a name badge each in their
own colour, because otherwise two peers in the same place are indistinguishable.

Two things only visible with real tabs side by side: a peer was invisible until they
happened to move, because a position was published only on change and never on binding;
and the same-browser transport below made both findable in a minute rather than twenty.

**Names.** Collaboration invented a pseudonym per session and ignored the Settings name,
which fed only comment authorship: two names for one person, and no way to set the one the
others saw. There is one name now, editable in the panel, and unnamed people are "Guest n"
rather than a plausible first name, which was a small lie about who was in the room.
Numbering is the fiddly part: taking the lowest free number on every change had two peers
swap numbers forever, so a peer moves only on a real clash and only the higher client id
moves.

**Structural edits are refused during a session.** Cells are shared by address, so
inserting a row shifts everything below it on one side only and the two workbooks drift
apart unannounced: the same silent class as two peers bound to different editors.
sheetedit asks the host through `allowStructuralEdit`, and the host explains why. Phase 4
is to have the host order these for everyone instead.

**A testing transport.** `?collab=local` pairs tabs of one browser over BroadcastChannel,
instantly, satisfying the same transport contract so everything above it runs unchanged.
Opt-in rather than automatic on localhost, because it does not exercise WebRTC and would
otherwise hide the failures the real transport exists to surface.

## 8. What this will not do

- Merge two divergent *files*. Collaboration is live, on one agreed base. Reconciling two
  separately edited copies of a workbook is a different feature and is not planned.
- Guarantee byte-identical saves across peers. Equivalent content, yes.
- Collaborate on the viewers. Those documents are read, not edited.
- ~~Collaborate on PDF, or on the format-specific surfaces (Power Query, pivot layout).~~
  **Superseded by the coverage audit below.** PDF has its own binding, and Power Query
  definitions, pivots, charts, drawings and table definitions all travel. What remains
  deliberately unshared is running someone else's work: a query is never refreshed on a
  peer's behalf, and a macro is never run on one. ActiveX is still base-file only.
- Provide identity, permissions or an audit trail. There are no accounts, by design.
  Approving newcomers (section 12) is a courtesy on top of that, not an exception to it.

## 9. Coverage audit (2026-08-01)

The goal is now full coverage: **anything a person can change during a session is shared.**
Not "the main thing" per editor, which is what phases 1 to 5 delivered.

The test for whether something belongs here is not what kind of thing it is, but whether a
session can change it. A pivot table nobody touches needs no sharing: it is in the base
file and every peer already has it. A pivot table someone reconfigures does.

The rule this audit exists to enforce: **a gap must be visible.** Two people editing what
they believe is one document, where some of what they do silently fails to travel, is worse
than an editor that refuses to collaborate at all. Every row below is either shared, or
listed as a known gap that the panel says out loud.

### What is shared today

| Editor | Shared | Mechanism |
|---|---|---|
| CodeMirror (text) | the whole document | one `Y.Text`; text *is* the document, so this is complete by construction |
| subedit | cue content, cue order | `Y.Map` by cue id + `Y.Array` of ids |
| sheetedit | cell inputs, row/column insert and delete | `Y.Map` by address + host-ordered structural ops |
| richdoc | block content, block order | `Y.Map` by block id + `Y.Array` of ids |
| pdfedit | paragraph edits, added boxes, whiteouts, images | position keys, object ids, blobs (in progress) |

### Known gaps, by editor

Everything below is editable in a session today and does **not** travel. Ordered roughly by
how likely a user is to hit it.

**sheetedit** (the largest gap by far)

- ~~Sheets themselves: add, rename, delete, reorder, hide/show~~ **Done 2026-08-01**, keyed
  by an id rather than a name, so a rename moves nothing.
- ~~Images~~ **Done 2026-08-01**: insert, delete, move, resize and replace, payloads in the
  blob store. Inserting and deleting did not exist in the editor at all and were built for
  this.
- ~~Shapes and form controls~~ **Done 2026-08-01.** A control's state is not shared and does
  not need to be: it writes into its linked cell, and cells already travel.
- ~~Charts (creation, data range, configuration)~~ **Done 2026-08-01**, whole definition per chart, last writer wins.
- ~~Pivot tables~~ **Done 2026-08-01**: definitions travel, output does not need to (it is
  cells, already shared). Identified by id, because every pivot authored in the app is
  called "PivotTable".
- ~~Power Query: queries, their steps, refresh~~ **Definitions done 2026-08-01; refresh
  deliberately not shared.** A refresh reaches the network, so running a peer's definition
  automatically would let anyone in a session choose what everyone else's browser fetches,
  including addresses on a private network only that peer can reach. The rows a refresh
  produces travel as cells instead, published by whoever ran it, so nothing is lost.
~~Data validation, protection, outline/grouping~~ **Done 2026-08-01** as sheet settings, one entry per group.
- ~~Named ranges~~ **Done 2026-08-01.** Table definitions remain.
- ~~Cell formatting beyond the input (rich text in cells, number formats)~~ **Done 2026-08-01**, in its own map beside the inputs.
- ~~Print setup, frozen panes and split panes, filters and sort~~ **Done 2026-08-01**, with row/column sizes, hidden rows and columns, merges and conditional formats, as sheet settings carried one entry per group.
- ~~VBA macros~~ **Source done 2026-08-01; running deliberately not shared**, for the same
  reason as a query refresh but more so: a macro is arbitrary code with the whole workbook
  in reach.
- ~~Table definitions~~ **Done 2026-08-01.** The gap was not really a sharing problem: they
  could not be authored at all, which is why they lived in file parts rather than the model
  and looked like they needed a mechanism of their own. Given authoring and an id, they
  share like every other object. ODF named database ranges are the same idea in the other
  format and are covered by the same model.

**sheetedit is complete.** Everything a session can change now travels, with two deliberate
exceptions, both recorded above: a query is never refreshed on a peer's behalf, and a macro
is never run on one.

**richdoc**

- ~~Images: currently *technically* shared, but wrongly.~~ **Fixed 2026-08-01.** Payloads
  are lifted into the blob store and the markup keeps a short `rdoc-blob:` reference, so
  the bytes are out of the CRDT and a paragraph holding a picture merges as prose again.
  The whole `data:` URL is what gets stored, not the decoded bytes, so restoring it is
  exact rather than reassembled: richdoc claims an untouched part comes back byte for
  byte, and an image put back together slightly differently would quietly break that.
- ~~Headers and footers, footnotes and endnotes~~ **Done 2026-08-01**, with page geometry and added styles, as one "document beside its body" channel keyed per entry.
- ~~Comments~~ **Done 2026-08-01**, keyed per reaction / reply / resolution / deletion so
  two people's replies both survive. ~~**One limit:** the cards on screen are not rebuilt.~~ **Fixed 2026-08-01:** a reply,
  reaction, resolution, rewrite or deletion now changes the card as it arrives, in the same
  place the pending state changes and only for an entry that was new, so a repeated
  delivery cannot append the same reply twice. The cards are updated rather than rebuilt: a
  rebuild would discard a reply someone is halfway through typing.
- ~~Tracked changes~~ **Done 2026-08-01**, and they needed less than expected. A block is
  reported as its outerHTML, so an ins, a del, an rPrChange and a paragraph-mark record all
  ride along with the block that carries them, and accept and reject arrive as the ordinary
  block edits they are. Two peers resolving the same change converge, because a block is
  last-writer-wins. What was actually broken was attribution: richdoc reads the author from
  the host's settings once, at mount, and a session hands out deduplicated names, so two
  peers who set none were both "Author". A suggested insertion merges into an adjacent one
  by the same author, so the second person's words were absorbed into the first person's
  change, accepted or rejected as one and credited to them. `setAuthor` on the editor,
  `ctx.me` on the binding.
- ~~Named styles, page geometry~~ **Done 2026-08-01** (see above).
- Tables: inside block HTML, so carried, but last-writer-wins for the whole block

**subedit is complete.** ~~ASS style definitions, tracks, document-level fields~~ **Done
2026-08-01** as one keyed "document beside its cues" channel: the style table one entry per
style, the verbatim script-info and styles tail, both ASS field orders, line endings, BOM,
final newline, frame rate, and each track's label and language. Two deliberate limits: a
track carries its label only, since its cues are a document of their own, and a field a
peer no longer has is left alone rather than deleted, since a peer holding an SRT reports
no styles at all and absence is not agreement.

**pdfedit is complete.** The remaining three turned out to need nothing built. A link is
made by running createLink inside the paragraph, so the anchor is part of that paragraph's
html and travels with the edit that carries it; the same is true of every inline mark, and
of glyph-level edits, which are that html. Page rotation is read from the file to lay text
out upright and is not an operation a user can perform, so there is nothing to share. The
link case has a pair test, since it is the reason the others need no work and a snapshot
that ever carried text instead of html would silently drop all of them.

**CodeMirror**: none. The document is its text.

### Approach

1. Finish the pdfedit thread, since half-built is worse than either end.
2. richdoc images onto the blob store: fixes a live bloat problem and restores merging.
3. sheetedit, largest first: sheets, then images/shapes, then charts, then pivots and
   Power Query.
4. ~~subedit: styles, tracks, document fields.~~ Done.
5. Whatever is still not shared when the work stops gets said in the panel, per editor,
   rather than left for a user to discover by losing work.

Each of these is its own body of work with the same shape as a phase: an identity scheme
where things are added, a report/apply pair in the library, a shared type, a binding, a
pair test. They are not small, and there are a lot of them.

## 10. Where this stands (2026-08-01)

Every editor shares everything a session can reach. The audit above is closed, phases 0 to
5 are done, and each binding has a pair test that fails when its mechanism is broken.

What is deliberately not shared, and should stay that way:

- **Refreshing a Power Query.** The definition travels; running it does not. A refresh
  reaches the network from whichever machine runs it, including addresses only that peer
  can see, so a definition arriving from someone else must be run by a person who chose to.
- **Running a macro.** The source travels. Running it is arbitrary code from a peer.
- **ActiveX and other format-specific payloads** that no editor exposes: they ride in the
  base file and come back out unchanged.

What is known and accepted:

- **A cell is last-writer-wins within itself, deliberately.** Merging two people's
  character edits inside `=SUM(A1:A20)*1.2` can produce a formula neither wrote, which then
  computes a wrong number quietly. Losing an edit is visible; inventing one is not, and a
  cell is too small for the merge to be worth that risk. Formatting is a separate write, so
  one person styling a column while another types into it already keeps both.
- **A paragraph and a cue merge within themselves**, since 2026-08-01. See section 11.
- **No identity, permissions or audit trail.** By design; there are no accounts.
- **Names are a display convenience, not proof.** A peer picks their own, and the session
  only deduplicates it. Attribution on a tracked change means "who said they were this",
  which is the right guarantee for a link-shared session and not one to build on.
- **Approving newcomers is a courtesy, not a boundary.** See section 12.

What is untested rather than unbuilt: no session has been run on real hardware with three
people at once. The trio tests below cover the logic; the transport with three real peers
across three networks is a different question and has not been asked.

## 11. Merging inside one paragraph (2026-08-01)

The audit's closing note said a block, a cue and a cell were each last-writer-wins within
themselves. That was wrong about the first and out of date about the second.

**A paragraph already merged.** A block is held as a `Y.Text`, and a local change is written
as the smallest edit that explains it: the shared prefix and suffix are trimmed, leaving an
insert or a delete at the point that actually moved. Two people typing at different points
in one paragraph therefore both keep their words, and a deletion survives the other person
typing elsewhere in the same paragraph. It is only last-writer-wins when the edits genuinely
overlap. What was missing was tests, and they are there now, including a sabotage check that
replacing the whole string instead of diffing breaks exactly the two that should break.

**A cue did not, and now does.** It was one value, and the realistic collision is not two
typists racing: it is one person retiming a track while another proofreads it. Those two do
not overlap at all and one of them was being thrown away. A cue is now a `Y.Map` of fields
with the text as a `Y.Text`, so retiming and rewording are separate writes and both survive,
and two people inside one line merge as they do inside a paragraph.

That change moved where an edit happens. A cue's text is two levels down now, and the
session's shallow `observe` never heard it, which showed up as a session that carried
nothing at all. `observeDeep` is not an optimisation here; it is the difference between
working and not.

**A cell stays as it is**, for the reason recorded above.

**Structured blocks stay as strings.** A table, an image or a run of opaque .docx XML is a
payload, not prose, and a `Y.Text` cannot express last-writer-wins anyway: two peers who
each clear it and insert their own version converge on both versions, one after the other.

## 12. Approving newcomers (2026-08-01)

Optional, off unless asked for, and only the peer that started the room can do it.

**What it is.** A link gets forwarded. The person who shared it is the only one who knows
whether the fourth arrival was meant to be there, so they can hold newcomers until they say
otherwise. A newcomer waits, is announced by name, and gets the document the moment they are
let in, or is told plainly and closes their copy if they are not.

**What it is not, stated in the UI and not only here.** It gates the document, not the room.
Anyone with the link is already in: they can see who is present and be seen. Hiding them
would defeat the point, because a knock with no name on it is not a decision anyone can
make. There is no identity in a session, so this is a courtesy between people who mostly
know each other, not a boundary that holds against someone who does not want it to.

**Every peer applies the host's ruling**, which is the part that needs three peers to get
right at all. While the host decides about the third arrival, the second is already in and
holds the whole document; a gate only the host keeps is not a gate. The host publishes its
decisions in presence and the others follow it. With no host present nobody holds the door,
which keeps the property that a room outlives the peer who opened it.

**The joiner has to ask again once admitted.** A sync exchange begins with the peer that
wants the document asking for it, and theirs was asked and refused before admission. Without
noticing the change and asking again, the door opens onto silence.

## 13. Three peers (2026-08-01)

Everything below the editors was written for any number of people and had never met more
than two. Two is the number at which a whole class of mistake is invisible: a reply sent to
"the other peer" rather than to everyone, a request answered without thought for a second
holder answering as well, a name clash resolved pairwise so the third arrival lands on a
name someone already moved to.

**What the tests found.** Only the peer that started a session offered the base file. Once
they closed their tab the invitation link was useless to anyone who had not already used it,
and it failed in the worst way available: the newcomer connected, saw everyone present, and
sat looking at an empty document, while the people already in noticed nothing at all.

Any peer holding the session's document now serves it, gated on being bound, which is
precisely "this document is the session's": a joiner still waiting for the base would
otherwise offer whatever it happened to have open and hand a newcomer the wrong file.

Several peers offering means several offers arriving. Taking each would fetch the same
document once per peer, so the others are kept as somewhere to ask if the one chosen goes
quiet, which is exactly what happens when the peer mid-transfer is the one that just left.

**What held up.** Fan-out to both peers, joiner-to-joiner edits, three simultaneous edits in
different places, a joiner arriving into work already done, name deduplication against
everyone rather than pairwise, one peer leaving without disturbing the other two, and the
blob channel when more than one peer holds the bytes, including a fourth arrival fetching an
image from a peer that did not create it.

## 14. Three peers on real hardware (2026-08-01)

Two Chrome tabs and an Android phone, all on the same production build served over
`adb reverse` so the phone reached it at `localhost` (a secure context, which `crypto.subtle`
needs), talking over the actual nostr relay and WebRTC. Not the local transport: the point
was to exercise the layer the local transport deliberately does not.

**What held.** The three found each other and named themselves Guest 1, 2 and 3, so the
deduplication works against everyone rather than pairwise. An edit made on the phone reached
both tabs; an edit on a tab reached the phone and the other tab. A retiming on the desktop
and a rewording on the phone, issued within the same round trip on the same cue, both
survived on all three: the field-level cue merge, over a real network, between a phone and a
laptop. Peer markers appeared on the right rows in the right colours. The founder left and a
newcomer joining afterwards was let in and received live edits, which is the three-peer bug
fixed above, confirmed in the wild.

**What it found.** Turning the approval door on partway through a session put the people
already inside into the waiting queue and stopped their edits reaching anyone until the host
approved people who were already there. The unit tests covered turning the door off and
never turning it on mid-session. Fixed: both directions admit everyone currently present,
and the door applies to arrivals from then on.

**Two things about the setup, not the app.** Four peers in one browser profile share one
IndexedDB, so a peer held at the door still *displays* a document: it is the local
autosave, restored at load, not the session's. The proof that the gate holds is that a live
edit made while they waited did not reach them, and arrived the instant they were let in. A
phone, with its own storage, showed the honest empty state. Separately, the phone's
"Leave site?" prompt blocks automation entirely, so a page with unsaved work has to be
dismissed through adb before it will navigate.

## 15. Browser pass on the other bindings (2026-08-01)

**Spreadsheet: verified.** Two tabs over the real transport. The joiner received the
workbook including the computed total, cells travelled in both directions, and a change to
an input on one peer recalculated the SUM on the peer that had not typed. Presence draws
each peer's cell cursor. The row-insert control did nothing on either peer, but it does
nothing in a solo tab either, so it wants a selection and is not a session matter.

**Rich text: found a serious bug.** A three-paragraph document reached a peer as one
paragraph. The cause was not in the binding at all: pressing Enter makes the browser clone
the element it splits, attributes and all, so the new half arrives wearing the old half's
`data-rdoc-bid`, and `assignBlockIds` only ever filled in a *missing* id. Every paragraph
after the first therefore answered to the same name, the map keyed by that name held one of
them, and the rest were invisible to everyone else and to the saved file.

Every test passed throughout. The pair tests insert blocks through a stub that hands out
fresh ids, so they never produce a clone: the single most ordinary act in a text editor was
the one thing nothing exercised. Fixed in richdoc (23ef899) with two tests, one of which
passed at first with the bug still in place, because the snapshot is keyed by id and two
blocks sharing one collapse into a single entry.

**Confirmed after the fix:** three paragraphs typed in a browser now carry three distinct
ids. **Not confirmed:** the two-peer round trip after the fix. The phone did not pair
through the relay on that attempt and the second tab locked behind a "Leave site?" prompt.
The unit tests cover the mechanism; the end-to-end confirmation is still owed.

**PDF: not exercised.** Still owed.

**On the rig.** Peers in one browser profile share an IndexedDB, and the app's own crash
recovery restores a sibling tab's document, so a tab can look like it received something it
did not. Anything about "did this reach the peer" has to be settled with a live edit made
after the join, or with a device that has its own storage.

## 16. An invitation link does nothing on a device with nothing open (2026-08-02)

Found while trying to confirm the block-identity fix phone-to-desktop, which is still not
confirmed because of this.

**The repro.** Open Omnitext on a device where no document is open, then follow an
invitation link. The room is taken out of the address bar, and nothing else happens. The
collaboration panel says the document is not shared. Nothing tells the person that an
invitation was seen, that it is being held, or what to do about it.

**Why.** `accept()` starts the session only when `host.workspace.getActiveDocument()` is
truthy, and otherwise parks the invite for the next `documentOpened`. Silently. In my
attempts, creating a document afterwards did not fire it either, though I drove that dialog
synthetically and that half needs confirming by hand before it is called a second bug.

**Why it was invisible until now.** Every earlier successful join in this rig had a
document already open, restored by crash recovery from the browser's own storage. The one
peer that arrives with nothing open is precisely the newcomer: someone opening Omnitext for
the first time because a colleague sent them a link. That is the single most important path
into the feature and it is the one that fails.

**A view on the fix, for the owner to settle.** Requiring the joiner to have a document open
is backwards. The session hands them the host's file: that is what the base transfer is for,
and a joiner who already has something open is the case that needs care (it is why the
transfer can be declined as dirty), not the case that should be mandatory. The smallest
honest fix is to say the invitation is waiting; the better one is to let a joiner with
nothing open join and receive the document. The second changes what `localState()` returns
for an empty workspace, so it wants deciding rather than assuming.
