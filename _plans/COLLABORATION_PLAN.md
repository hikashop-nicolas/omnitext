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
- ActiveX controls, Power Query, pivots, slicers and the like are **out of scope**: they
  are file features, not concurrent editing surfaces. They travel in the base file and
  are not shared state.

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

## 7. Phases and gates

| Phase | Work | Gate before starting |
|---|---|---|
| 0 | **Done.** Transport spike: Yjs + WebRTC provider, room from fragment, no editor | Provider confirmed maintained, and the answer inverted the review's guess (7b) |
| 1 | Core Tool: session, presence, peer list, base transfer, share UI, CodeMirror binding | Phase 0 syncs reliably between two different browsers (see below) |
| 2 | subedit binding, plus its per-cue mutation API and scoped undo | Phase 1 survives a real two-person editing session |
| 3 | sheetedit binding, cell content only; structural edits disabled for guests | Phase 2 shipped and used |
| 4 | sheetedit structural operations, host-arbitrated | Phase 3 shows people actually hit the limitation |
| 5 | richdoc: block ids, per-block change reporting, operation-based undo, binding | Phases 2 and 3 shipped; this is the largest piece and should not be first |

Phases 3 and 5 each carry a prerequisite body of work in another repository. Those are
not incidental; budget them as their own tasks.

## 7a. How to test two peers

Two different browsers on one machine, not two tabs and not two machines.

Two browsers exercise what the spike is for: the signalling path through the real relay,
the data channel, the base-file transfer, presence, and two separate IndexedDB stores.
Chrome and Firefox together also test interop between two WebRTC implementations, which is
where this usually breaks. Two tabs in one browser share too much to prove anything.

What one machine cannot test is NAT traversal: both peers connect over loopback and never
need a STUN or relay candidate. That is a deployment risk rather than an architectural one,
so it gates shipping to users, not the spike. The cheap version is a laptop on wifi and a
phone on cellular, which is a genuinely different network path.

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

**What was not proven, and still gates shipping rather than Phase 1:** NAT traversal. Both
peers were on loopback and never needed a STUN or relay candidate. The cheap real test
stays what section 7a says: a laptop on wifi and a phone on cellular.

**One correction fell out of this**, in section 6: the draft claimed payloads are
encrypted with a key derived from the link secret. They are not, and the honest version
is now written there.

## 8. What this will not do

- Merge two divergent *files*. Collaboration is live, on one agreed base. Reconciling two
  separately edited copies of a workbook is a different feature and is not planned.
- Guarantee byte-identical saves across peers. Equivalent content, yes.
- Collaborate on the viewers, on PDF, or on the format-specific surfaces (ActiveX, Power
  Query, pivot layout). Those travel in the base file.
- Provide identity, permissions or an audit trail. There are no accounts, by design.
