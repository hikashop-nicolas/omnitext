# Omnitext Plan Review

A skeptical, prioritized critique. The plan is well written and the prior-art
section is honest. The problems are not in presentation; they are in the load-bearing
assumptions. Findings are grouped by reviewer perspective, then blind spots, then a
factual-verification section, then the Top 10 and verdict.

## A. Staff software engineer (architecture and feasibility)

### A1. The "five standard model shapes" contract will leak immediately. Severity: Critical
Why it matters: The whole design rests on text/tabular/tree/richtext/domain being a
stable interop contract between formats and editors. It is not. tabular is described
as "rows and columns plus trivia (quoting, line endings)." But CSV trivia is not just
quoting and line endings: it includes per-field quote style, mixed quoting, trailing
commas, ragged rows, embedded newlines, comment lines, and a header-row flag. tree is
"a JSON-like value", but JSON5 has comments and trailing commas, YAML has anchors,
aliases, tags, multi-document streams, and block-vs-flow style, TOML has datetime
types and table arrays. None of those survive a generic "JSON-like value." So either
the shapes grow format-specific fields (at which point a tabular editor written for
CSV cannot blindly edit a tabular model produced by, say, a fixed-width or TSV format),
or the shapes stay generic and round-trip fidelity is lost. You cannot have both a
narrow shared shape and lossless round-trip. This is the central contradiction of the
plan.
Suggested fix: Drop the pretense that the model is a small shared shape. Make the
model an opaque, format-owned structure, and have the format ALSO expose a small,
explicitly-lossy "view adapter" (toTabularView / fromTabularView) that a generic
editor consumes. The editor edits the view; the format reconciles edits back into its
own CST. This keeps trivia inside the format where it belongs and makes "which editor
fits" a capability negotiation, not a type-equality check. Accept up front that the
generic table/tree editor is a lossy convenience view, not the source of truth.

### A2. Lossless round-trip ("serialize preserves untouched regions") is hand-waving for the non-text shapes. Severity: Critical
Why it matters: PapaParse parses CSV into arrays of values; it does not retain a
concrete syntax tree mapping each cell back to its exact byte span, quote style, and
surrounding whitespace. fast-xml-parser likewise normalizes; round-tripping XML
byte-for-byte through it is explicitly not its job (attribute order, whitespace,
self-closing style, entities, CDATA, and the XML declaration are all at risk). js-yaml
does not preserve comments or formatting at all. The plan asserts "serialize must
preserve untouched regions (lossless-CST)" as if the chosen libraries provide a CST.
They do not. A real lossless-CST round-trip requires either a different class of parser
(concrete-syntax / rowan-style green trees, or a parser that emits source spans) or a
diff-and-splice strategy where you re-emit only changed regions against the original
text. That is a substantial build, not an adapter over PapaParse.
Suggested fix: Pick ONE format (CSV is the easiest) and actually prototype byte-exact
round-trip of untouched rows in Phase 0, before committing the architecture. Either
adopt a span-preserving parser or implement a region-splice serializer (keep the
original text, track which rows/nodes were touched, re-serialize only those, stitch
the rest verbatim). Demote the lossless claim to "byte-exact for text-model formats;
best-effort, fixture-tested for the rest" and say so prominently rather than burying
it in Risks.

### A3. "The core imports nothing" is aspirational and partly self-contradicted. Severity: Major
Why it matters: The plan says the core "does not even own CodeMirror", yet Phase 0
ships "the CodeMirror editor module" as the universal fallback and the resolution
logic falls back to "the text model plus CodeMirror." A guaranteed fallback that the
resolver names by id is a hard dependency in practice even if it is a separate chunk.
More importantly, the host API, the command palette, keybindings, selection model, and
undo all have to make assumptions that bleed editor semantics into the core (see A4,
A5). "Core imports nothing" is a fine north star but should not be stated as an
achieved property; the resolver's hardcoded codemirror fallback already breaks it.
Suggested fix: Reframe as "core depends on no PARSER and no DOM editor widget directly;
the universal fallback editor is a privileged but swappable module declared by id in
config." Make the fallback editor id a configuration value, not a literal in
resolve-editor.ts, so the claim is at least structurally true.

### A4. Cursor, selection, and undo semantics are per-editor and the plan has no unified model. Severity: Major
Why it matters: CodeMirror selection is character offsets in a text document.
Tabulator/Glide selection is cell/range coordinates. TipTap/ProseMirror selection is
positions in a node tree. A timeline editor's selection is a set of cues over time.
There is no common selectionChanged payload that is meaningful across these, yet the
plan emits a single selectionChanged event and a single command palette that operates
"across heterogeneous editors." Undo is worse: each library owns its own history stack
with its own granularity, and the plan also wants a separate snapshot history tool in
IndexedDB. Two undo systems that do not know about each other (editor-local undo vs
snapshot restore) will fight, and Ctrl+Z behavior will be unpredictable, especially
across an editor switch (A7).
Suggested fix: Define selection as an opaque, editor-owned token that only the owning
editor interprets; commands that need selection must come from that editor's command
contributions, not from generic core commands. Pick ONE undo authority. The cleanest
is: editor-local undo for in-session edits, and the snapshot tool is "restore to
version" (a coarse, explicit action), never wired to Ctrl+Z. Document that undo does
not cross an editor/format switch and enforce a commit-or-discard at the switch
boundary.

### A5. Command palette and keybindings across heterogeneous editors are under-specified and will conflict. Severity: Major
Why it matters: CodeMirror, ProseMirror, and a data grid each register their own key
handlers (Ctrl+B, Tab, arrow keys, Ctrl+Z, Enter). A global command palette plus
global keybindings layered on top will collide with the active editor's bindings, and
the conflict set changes every time the editor switches. The plan mentions
"command contributions" in the interface sketch but never says who wins on conflict,
how scoping works (global vs editor-scoped), or how the palette presents commands that
only make sense in the currently active editor.
Suggested fix: Specify a keybinding precedence model now: active-editor bindings win
over global unless explicitly marked global-priority; the palette filters to
(global commands UNION active-editor contributed commands); contributions are added and
removed on editor mount/dispose. Write this into host-api.ts and resolve-editor.ts in
Phase 0 even though only one editor exists, because retrofitting precedence after three
editors exist is painful.

### A6. Collaboration binding will force a near-total rewrite of every non-text editor. Severity: Major
Why it matters: The plan acknowledges this ("non-text editors need per-editor work")
but understates it. y-codemirror.next works because CodeMirror's document is a
linear sequence that maps cleanly to a Y.Text. A data grid maps to a Y.Array of
Y.Maps, but Tabulator/Glide/RevoGrid do not expose a hook to apply granular remote
mutations without a full re-render or losing local edit state, and conflict resolution
for "two users editing the same cell" or "row inserted while you were typing" is
genuinely hard. ProseMirror has y-prosemirror, but the model the plan defined
(richtext = "an HTML/document model") is NOT the ProseMirror doc model, so the
collaboration layer binds to ProseMirror's internal model, not to the plan's abstract
richtext shape. That means the abstraction (A1) does not survive contact with
collaboration: collab binds to the editor's native model, not to the standard shape,
which undercuts "collaboration binds to the editor's model" as a uniform mechanism.
Suggested fix: Be explicit that collaboration is implemented per editor against the
editor library's native CRDT binding (y-codemirror.next, y-prosemirror), not against
the abstract model. Budget collab for the table editor as its own multi-week effort,
and consider shipping table/tree/richtext collab as "last-writer-wins with presence"
rather than true CRDT first, since per-editor CRDT bindings may not exist or may be
immature for Tabulator/Glide/RevoGrid.

### A7. Editor/format switching with a dirty model is unspecified and is the most likely data-loss bug. Severity: Major
Why it matters: The plan happily says "switch to raw text and back" and "open JSON as
a tree or as text." But switching editor requires Format.serialize(currentModel) to
text, then re-parse for the new editor. If the model is lossy (A1/A2), that round-trip
silently reformats or drops data on every switch. If there are unsaved edits, the
order of operations (serialize dirty model, swap editor, re-parse) can lose the edit
or reformat untouched regions the moment the user toggles views. willChangeEditor and
willChangeFormat hooks are listed but no policy is given.
Suggested fix: Define the switch protocol explicitly: on willChangeEditor, serialize
the current model to text, run the golden round-trip assertion against the last known
text, and if it is not byte-identical in untouched regions, warn the user before
switching. Treat editor switch as a save-point. Add this scenario to Phase 1
verification rather than only "confirm the edit is present."

### A8. Detection ambiguity has no resolution policy. Severity: Minor
Why it matters: detect() returns 0..1 per format, but JSON is valid YAML, .txt could
be CSV or Markdown or INI, and a .json file containing JSON5 comments fails strict
JSON. The plan never says how ties break, what the threshold is, or what the UX is
when confidence is low.
Suggested fix: Define: extension match is a strong prior; content sniff breaks ties;
below a confidence floor, open as text and surface a non-modal "Detected as X, change?"
in the statusbar. Persist the user's override per extension.

## B. Product / market critic

### B1. "One editor for ALL formats" is a focus-killing trap, not the headline strength. Severity: Critical
Why it matters: The plan treats format breadth as the differentiator, but breadth is
exactly what kills small editors. For each format there is an incumbent that is better:
JSON Crack / jsoneditor for JSON, dedicated subtitle editors (Subtitle Edit, Aegisub)
for ASS/SRT with waveform and video preview, Final Draft / Fade In for FDX, real
spreadsheets for CSV. A user editing FDX wants script-specific affordances (scene
numbers, revision colors, dual dialogue) that a generic shell will never match. The
"adapts its editing surface" pitch sounds clever but the honest user reaction is
"why would I edit my screenplay in a JSON tool." Breadth dilutes every editor to the
generic library defaults.
Suggested fix: Reposition around a coherent USER, not a feature. The strongest real
wedge here is "the local-first, no-login, private scratchpad for DEV and DATA formats"
(JSON, YAML, CSV, XML, Markdown, TOML, .env, logs), which is genuinely underserved and
where generic editors are good enough. Cut subtitles and screenplay from the roadmap
entirely (they belong to vertical incumbents and are huge), or relabel them as
"someday, maybe" rather than Phase 5 deliverables.

### B2. Who is the user, and what is the first-100-users story? It is missing. Severity: Major
Why it matters: The plan says extensibility is "mostly for me" yet also builds
collaboration, share links, and a public differentiation pitch, which only matter if
there are other users. These two framings are in tension. If it is genuinely for the
author, collaboration and the privacy marketing are wasted effort. If it is for an
audience, there is no acquisition story, no wedge format, no "the one thing it does
better than the incumbent for that one user."
Suggested fix: Pick one. If "mostly for me": cut Phase 3 collaboration and the privacy
marketing, keep it a great personal multi-format local editor, and stop justifying it
as a market gap. If "for an audience": name the wedge format and the channel (e.g.
"the JSON/YAML editor HN posts about because it is private, instant, and diffable")
and design Phase 0 around making THAT delightful.

### B3. Does anyone want to edit FDX, CSV, and subtitles in the same tool? Almost certainly not. Severity: Major
Why it matters: These belong to disjoint user populations (screenwriters, data folks,
subtitlers). No single person has all three needs regularly. So "all formats in one
tool" optimizes for a user who does not exist. The breadth adds maintenance and
cognitive load without adding value to any one user.
Suggested fix: Same as B1: choose a coherent cluster (dev/data formats) where one
person plausibly touches several of them in a week.

### B4. "Open source + client-side = private" is real but a weak wedge on its own. Severity: Minor
Why it matters: Privacy-as-marketing rarely drives adoption by itself; it is a
tie-breaker, not a reason to switch. Most users will not read the source to verify the
claim, and "client-side" is invisible to them. Worse, the share-link collaboration
feature partly undermines the simplicity of the privacy story (now there are relays,
secrets, and metadata; see Security section).
Suggested fix: Lead with a concrete capability (instant, no-login, diffable,
round-trip-safe, works offline) and let "private by construction" be the supporting
proof point, not the headline.

## C. Security auditor

### C1. Secret in the URL fragment is a weak capability with multiple leak channels and no revocation. Severity: Critical
Why it matters: The fragment is not sent to the static host, which is true and good,
but it leaks elsewhere: browser history (synced across devices via Chrome/Firefox
sync, so the secret lands on other machines and in vendor cloud), shoulder-surfing and
screen-sharing of the URL bar, copy/paste into chat or email (the usual way people
share links, often over plaintext or third-party-readable channels), and any
client-side script or extension that can read location.hash. There is no auth and no
revocation: anyone who ever sees the link is in the room forever, and you cannot evict
them or rotate the secret without minting a new room and migrating the document. There
is also no per-user identity, so you cannot tell collaborators apart or audit who did
what.
Suggested fix: Treat the link as a bearer capability and say so plainly in the UX and
docs ("anyone with this link can read and edit; you cannot revoke it"). Add: a "new
link / rotate secret" action that re-keys the room and forces re-share; optional link
expiry encoded in the fragment; a lightweight passphrase layer so the link alone is
not sufficient; and a visible peer list so the owner at least SEES who is connected.
Do not call this "secure"; call it "no-server, end-to-end-encrypted, link-is-the-key."

### C2. Trystero over public relays: trust, MITM on first contact, and no forward secrecy. Severity: Major
Why it matters: Trystero uses public signaling (Nostr/BitTorrent/MQTT). The relay
operator sees signaling metadata: room id (hash), peer IPs, timing, and connection
graph, even if payloads are E2E encrypted. WebRTC itself leaks IP addresses to peers
(and via STUN), which deanonymizes participants. The key is derived (PBKDF2) from a
secret that is shared out of band in the same link as the room id, so there is no
authenticated key exchange and no forward secrecy: if the secret leaks later, all past
captured ciphertext is decryptable, and a peer who joins with the link is fully trusted
with no verification that they are who the owner intended. There is no protection
against a malicious peer who has the link injecting bad Yjs updates.
Suggested fix: Be explicit in the threat model: this protects content confidentiality
from the page host and passive relay observers, but NOT from anyone with the link,
NOT against traffic-analysis metadata, and NOT against malicious authorized peers, and
provides NO forward secrecy. If forward secrecy or identity matters, that needs a real
key-exchange/identity layer (out of scope, so say so). Document the IP-exposure
property of WebRTC. Provide a self-hostable relay option for users who do not want to
trust public relays.

### C3. localStorage/IndexedDB as the only store is a real data-loss risk, and "client-side = secure" hides a single-device single-point-of-failure. Severity: Major
Why it matters: Browser-local storage is evictable. IndexedDB is cleared by "clear
browsing data", by Safari's 7-day eviction of script-writable storage for sites
without user engagement (ITP), by private/incognito mode (gone on tab close), and by
quota pressure (best-effort storage is evicted under disk pressure). y-indexeddb
"offline persistence" inherits all of this. The plan's whole local-first promise can
silently vaporize a user's only copy. "Client-side = secure" also ignores that
encrypt-at-rest with a key derived from... what? The plan says encrypt-at-rest with a
Web Crypto key, but with no login there is no user secret to derive a stable at-rest
key from, so either the key sits in plaintext localStorage (useless against local
attackers) or the user must enter a passphrase every session (UX the plan never
mentions). At-rest encryption with the key stored next to the data is theater.
Suggested fix: Treat the browser store as a cache, not a vault. Make File System
Access (or download-on-change) the durable copy and nag the user to save to disk.
Request persistent storage (navigator.storage.persist()) and surface quota. Be honest
that Safari will evict. For at-rest encryption, either drop it (it adds no real
protection without a user secret) or require an explicit passphrase and make the UX
cost explicit. Add an export/backup affordance as a first-class feature, not Phase 4.

### C4. No integrity protection against a compromised static host or CDN-loaded library. Severity: Minor
Why it matters: The privacy pitch is "open source so you can trust it", but the running
code is whatever GitHub Pages serves, and lazy-loaded libraries (Yjs, CodeMirror,
pandoc-wasm, etc.) are a supply-chain surface. A compromised dependency or a tampered
deploy can exfiltrate the very content the privacy story promises to protect, and the
user has no way to verify the served bundle matches the source.
Suggested fix: Pin dependencies, use Subresource Integrity for any non-bundled assets,
self-host all libraries (no third-party CDN at runtime), publish a build provenance /
reproducible-build statement, and consider a CSP that blocks unexpected network
egress. Mention this in the privacy claims so they are defensible.

## D. Solo-maintainer sustainability critic

### D1. Seven phases, ~20 libraries, multiple editors, CRDT collab, conversion, custom editors: this is multi-year for one person. Severity: Critical
Why it matters: Each of Phase 1 (multi-editor + 4 formats + switcher), Phase 3
(real-time collab with E2E crypto and relays), and Phase 5 (rich text + two bespoke
custom editors + extending collab to non-text) is independently a large project. The
plan presents them as roughly peer-sized phases. They are not. Phase 3 alone (correct
CRDT integration, cursor presence, relay fallback, crypto, the byte-exact-under-collab
problem) is the kind of thing dedicated teams ship as a whole product.
Suggested fix: Re-scope to a realistic solo arc: Phase 0 + Phase 1-lite (CodeMirror +
JSON/YAML/Markdown/CSV-as-text, ONE alternative table view) as the shippable v1.
Everything else is explicitly "future, maybe." Set a kill criterion: if Phase 0 +
lossless CSV round-trip is not fun and working in N weekends, stop.

### D2. The phases that are secretly 5x bigger than they look. Severity: Major
Why it matters, by phase:
- Phase 1 table editor: lossless CSV round-trip (A2) + editor switching with dirty
  state (A7) is the hard part, not wiring Tabulator. 5x.
- Phase 3 collab: see D1. The "extend to non-text editors" line in Phase 5 hides a
  per-editor CRDT binding that may not exist for the chosen grid (A6). 5x to 10x.
- Phase 4 conversion: "piping formatA.parse -> formatB.serialize through the registry"
  assumes the model shapes are interchange-compatible, which A1 says they are not.
  Generic any-to-any conversion via the abstract model is largely a fantasy; real
  conversion is pairwise and bespoke (Markdown->HTML is easy, CSV->YAML is ambiguous,
  HTML->FDX is nonsense). pandoc-wasm helps for doc formats only and is heavy. 5x.
- Phase 5 custom editors: a subtitle timeline with waveform/video and an FDX
  screenplay editor are each a standalone product. 10x.
Suggested fix: Annotate the roadmap with honest effort multipliers and cut Phase 4's
"generic conversion through the registry" to "a few hardcoded pairwise converters."
Move custom editors out of the plan.

### D3. Maintenance burden of ~20 third-party libs with lazy-load + supply chain. Severity: Major
Why it matters: Twenty dependencies across editors, parsers, CRDT, transport, crypto
helpers, export, and a WASM pandoc is a large, churning surface for one maintainer.
CodeMirror 6, ProseMirror/TipTap, and Yjs each have non-trivial upgrade treadmills and
breaking changes; pandoc-wasm is a research-grade artifact (verified below: easy OOM,
large). Lazy-loading does not reduce maintenance, only first-load size; you still own
every integration when it breaks.
Suggested fix: Aggressively minimize the dependency set for v1 (CodeMirror + Dexie +
PapaParse + js-yaml + ajv is enough to be useful). Add each further library only when
a concrete need forces it. Drop pandoc-wasm unless document conversion is a core use
case for the author.

### D4. Most likely place to stall and die: between Phase 1 and Phase 3. Severity: Major
Why it matters: Phase 0 is achievable and rewarding (a working JSON/MD editor). Phase
1's lossless table round-trip is the first real wall; Phase 3's collaboration is the
second and bigger one. Solo projects typically die at the first feature that is
"weeks of unglamorous correctness work with no visible payoff", which here is the
CST/round-trip plumbing. The collaboration phase, if reached, is where motivation and
free time most often run out before it is solid.
Suggested fix: Sequence the rewarding-but-bounded work first and gate the risky work
behind explicit go/no-go checkpoints. Make Phase 0 genuinely shippable and useful on
its own so the project has value even if it stops there.

## Blind spots (things the plan does not mention but should)

- Accessibility: none mentioned. Swapping editors means swapping ARIA semantics,
  focus management, and keyboard models per editor; a generic shell over heterogeneous
  widgets is an a11y minefield. Severity: Major. Fix: define focus/ARIA expectations in
  the EditorInstance contract.
- Large-file performance: none mentioned. A 200MB CSV or a 50MB JSON will OOM a naive
  parse-into-model approach; CodeMirror handles large text but Tabulator/tree editors
  do not load millions of rows trivially. Severity: Major. Fix: define size thresholds
  that force text/virtualized mode and refuse non-text editors above a limit.
- Encodings, BOM, line endings, binary-ish text: not mentioned. UTF-16, latin-1, BOM
  stripping, CRLF vs LF, and files that are "mostly text" all break byte-exact
  round-trip if mishandled, and File/Blob reads default to UTF-8. Severity: Major (it
  directly contradicts the byte-exact claim). Fix: detect and preserve encoding, BOM,
  and line endings as document metadata; round-trip them.
- Mobile/touch: CodeMirror is "mobile-ok" but data grids, tree editors, and a subtitle
  timeline are poor on touch; the plan claims browser-only as a strength but never
  addresses small screens. Severity: Minor. Fix: declare desktop-first explicitly.
- i18n/RTL: not mentioned at all for a text editor. Severity: Minor.
- Testing strategy: only "golden round-trip fixtures" are mentioned. No unit tests for
  the resolver, no integration tests for editor switch, no collab/CRDT convergence
  tests (the hardest thing to test), no cross-browser matrix. Severity: Major. Fix:
  define a test pyramid, especially convergence tests for collab and switch-protocol
  tests.
- Crash/recovery: what happens if serialize throws mid-save, or the tab crashes with a
  dirty model? No autosave-of-dirty-model-to-IndexedDB-before-serialize story.
  Severity: Major. Fix: persist the raw editor model snapshot on every change,
  independent of serialize, so a crash never loses edits.
- Domain model with no matching editor installed: the plan says any format falls back
  to text+CodeMirror, but a domain-specific (opaque) model is NOT text and has no
  generic editor. The fallback breaks exactly for the custom formats. Severity: Major.
  Fix: require every domain format to also provide a text serialization so the fallback
  is real, or refuse to open it without its editor.
- Conflict between editor-local undo and snapshot history: see A4; not mentioned as a
  conflict.
- What "save" means with no file handle (Safari): every change downloads a file?
  Versioning on disk? Not addressed beyond "download/upload fallback." Severity: Minor.

## Factual verification (searched, not trusted)

- Yjs license: MIT. Confirmed. y-codemirror.next: MIT. Confirmed. The plan's
  "verify Yjs license at integration (MIT expected)" is correct; you can drop the
  hedge.
- Tabulator: MIT. Confirmed. Glide Data Grid: MIT. Confirmed. RevoGrid: the project
  describes itself as "open-core, MIT-licensed", i.e. MIT core with paid/pro pieces.
  The plan calls it plain "MIT"; that is mostly right but the open-core nuance means
  some advanced features may be gated. Verify which features you need are in the MIT
  core. Quill: BSD (as plan states). Reasonable.
- TipTap: MIT core, but historically had PAID "Pro" extensions. As of June 2026 TipTap
  open-sourced 10 formerly-Pro extensions under MIT, but the remaining ones
  (Comments, Snapshots, AI) stay tied to TipTap's paid cloud services. The plan's flat
  "TipTap (MIT)" is true for the core and now most extensions, but do not assume
  collaboration/comments come free; the version-history "Snapshots" extension in
  particular is service-gated, which overlaps your Phase 2 ambitions. Note this.
- Trystero: actively discussed in 2025-2026 and real, but has documented scalability
  limits: full-mesh WebRTC means connection count grows with peers and browsers cap
  RTCPeerConnections ("Cannot create so many PeerConnections"), so rooms must be kept
  small. The plan's "relay reliability" risk is correct but understated; add a hard
  peer-count cap and design for small rooms. Could not confirm a recent commit cadence
  from the search; verify maintenance status on the repo before depending on it.
- File System Access API: confirmed Chromium-only (Chrome/Edge/Opera 86+), absent in
  Firefox and Safari, AND absent on Chrome for Android / mobile (showOpenFilePicker,
  showSaveFilePicker, showDirectoryPicker are not exposed). The plan only calls out
  Safari; it should also exclude Firefox AND all mobile browsers from the "native
  local-disk" experience. Safari/Firefox get only the Origin Private File System (a
  sandboxed store), not real local-disk pickers.
- wasm-pandoc / pandoc-wasm: real and runs in-browser with no server, BUT documented to
  trigger "out of memory" errors easily, has no Lua filters, and is a large/heavy
  artifact. Treating it as a lazy "convert when invoked" tool is fine, but it is
  research-grade, not production-robust; do not promise reliable arbitrary conversion.

## Top 10 things to fix before writing code

1. Resolve the central contradiction (A1/A2): you cannot have a narrow shared model
   shape AND lossless round-trip. Decide now that the model is format-owned and that
   generic editors consume an explicitly-lossy view; prototype byte-exact CSV
   round-trip before committing the architecture.
2. Prove lossless round-trip on ONE real format in Phase 0 using a span-preserving
   parser or region-splice serializer; PapaParse/fast-xml-parser/js-yaml do not give
   you a CST. If you cannot, demote the lossless claim publicly.
3. Pick the user and the wedge (B1/B2): commit to dev/data formats for a real user,
   cut subtitles/screenplay, and decide whether collaboration is even wanted ("mostly
   for me" vs "for an audience").
4. Define the editor/format switch protocol with dirty state (A7): serialize-as-
   save-point, round-trip assertion before switch, and treat switch as a commit-or-
   discard boundary. This is your top data-loss risk.
5. Specify one undo authority and keybinding/command precedence across editors
   (A4/A5): editor-local undo wins, snapshot = explicit restore, active-editor
   bindings beat global; undo does not cross a switch.
6. Make storage durable, not a vault (C3): browser storage is a cache that Safari/quota
   will evict; make disk export/save first-class and request persistent storage; drop
   or honestly gate at-rest encryption (no user secret = no real protection).
7. Write an honest threat model for the share link and Trystero (C1/C2): bearer
   capability, no revocation, no forward secrecy, relay metadata + WebRTC IP exposure,
   malicious-authorized-peer risk. Add re-key, expiry, peer list, and self-host relay
   option; stop calling it "secure".
8. Handle encodings/BOM/line-endings/large files as first-class document metadata
   (blind spots): these directly break the byte-exact claim and will OOM the non-text
   editors.
9. Cut scope to a shippable solo v1 (D1/D2): Phase 0 + CSV-as-text + one table view;
   mark collab, conversion, rich text, and custom editors as "future, maybe", with a
   kill criterion if Phase 0 is not working and fun within a fixed budget.
10. Fix the domain-model-without-editor fallback and add crash recovery (blind spots):
    require domain formats to provide a text serialization so the text fallback is
    real, and snapshot the raw editor model on every change so a crash/serialize-throw
    never loses edits.

## Overall verdict

The plan is well researched and the prior-art and library survey are mostly accurate,
but it is over-scoped and built on one load-bearing assumption that does not hold:
that a small shared set of model shapes can give both clean editor interoperability
AND lossless round-trip. Those two goals are in direct tension, and the chosen parsers
(PapaParse, fast-xml-parser, js-yaml) do not provide the concrete-syntax preservation
the lossless claim requires, so the most-advertised property is the least proven. The
product framing also wavers between "a private multi-format editor for an audience"
and "mostly for me", which matters because the expensive parts (collaboration, the
privacy marketing, breadth into subtitles/screenplay) only pay off for an audience
and are exactly where a solo maintainer will stall. As written it is a multi-year
program dressed as a phased weekend project. It becomes sound if you (a) make the model
format-owned and accept lossy generic views, (b) prove lossless CSV round-trip before
building the abstraction, (c) commit to a single dev/data-format user and cut the rest,
and (d) treat collaboration, conversion, and custom editors as explicitly optional
futures behind go/no-go gates. Trim it to that and Phase 0/1 is a genuinely good,
shippable tool; leave it as is and it is a mis-aimed, over-scoped tech demo that will
likely die at the first round-trip wall.
