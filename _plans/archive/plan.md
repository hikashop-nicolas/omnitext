# Omnitext: browser-only, format-agnostic, extensible text editor

> Revised after an adversarial review (see plan-review.md). Key changes: the
> document model is now format-owned (not a rigid shared shape); round-trip claims
> are honest and proven by a Phase 0 spike; the editor-switch / undo / keybinding
> protocol is specified; the share-link threat model and storage durability are
> stated plainly; the committed v1 scope is tightened and later phases are gated.

## Context

A new open-source project: a text editor that runs entirely in the user's browser,
published as a static site on GitHub Pages, with a small core JS engine that surfaces
events and helper APIs so JavaScript modules extend it. The architecture is meant to
support any text-based format over time (JSON, CSV, YAML, XML, Markdown, INI, TOML,
and later subtitles, screenplay, HTML, etc) through plugins. Because the code is open
source and runs only on the user's machine, privacy is a supporting property.

The editing surface must adapt to the file format: JSON wants a code editor, CSV wants
a table editor, HTML wants rich text, subtitles/FDX want custom editors. So "editor"
is its own module type: format modules ask the system for a suitable editor and the
system serves one, falling back to a plain code/text editor when nothing better fits.

### What we are actually building (scope discipline)

- North star (the architecture): one private, serverless, extensible editor whose
  editing surface adapts per format, open to new formats and editors via plugins.
- Committed v1 (what gets shipped first): a local-first, no-login, instant, diffable
  editor for DEV and DATA formats (JSON/JSON5, YAML, Markdown, CSV, XML, TOML, INI,
  .env, logs). This is a coherent user who plausibly touches several of these in a
  week, and where generic editors are good enough that we can win on privacy, speed,
  and round-trip safety.
- Explicitly deferred ("future, maybe", behind go/no-go gates): real-time
  collaboration, format conversion, rich-text/WYSIWYG, and bespoke custom editors
  (subtitle timeline, FDX screenplay). The plugin architecture is designed so these
  CAN be added later, but they are not v1 commitments. Subtitles and screenplay in
  particular have strong vertical incumbents (Aegisub, Subtitle Edit, Final Draft)
  and are each their own product; treat them as long-term possibilities, not roadmap.

### Decisions taken during planning

- Three module kinds: Editor (an editing surface), Format (convert a file type to/from
  a model an editor can edit, plus optional lossy view adapters), Tool (diff, history,
  export, storage, and later collaboration/conversion). The core depends on no parser
  and no DOM editor widget directly.
- No login, no accounts, no OAuth. On first visit a random session id is generated;
  data lives in IndexedDB and (durably) on the user's disk. The app can generate a
  share link so chosen people can collaborate. This removes the hardest constraint we
  found (GitHub OAuth cannot complete client-side), so any cloud sync is an optional
  far-future module.
- Audience framing: a personal and small-group tool, not a mass-market product. The
  share link is for sharing with specific people you choose, not for acquiring an
  audience. Collaboration is therefore a "nice to have later", not a launch feature.
- Extensibility is mostly for the author; untrusted third-party plugin sandboxing is
  deferred. Design the host API now as if it were public so a sandbox can be added
  later without breaking the contract.
- Working name: Omnitext (alternatives at the end).

## Does this already exist? (prior art)

No single existing tool combines: fully client-side / static-hosted, an editing
surface that swaps per format, format-agnostic via plugins, no-login instant use with
optional share-link collaboration, and open source. The closest tools each give up an
axis: StackEdit (Markdown only, single editor, dated); TiddlyWiki (single-file, no
standard format/editor plugin model); Obsidian/Logseq (desktop-first; Obsidian not
OSS); Decap/Sveltia CMS (need a git host + auth); HackMD/HedgeDoc/Etherpad (need a
server); format-specific browser editors (single format, not extensible). The gap is
real for the dev/data wedge specifically; for subtitles/screenplay the incumbents are
strong, which is another reason those stay out of v1.

## The central architectural correction: the model is format-owned

The original design assumed a small shared set of model shapes (text, tabular, tree,
richtext, domain) that would give BOTH clean editor interoperability AND lossless
round-trip. Those two goals are in direct tension and cannot both hold: a narrow
shared shape cannot carry per-format trivia (CSV per-field quote style, ragged rows,
embedded newlines, comment lines; JSON5/YAML/TOML comments, anchors, tags, datetime
types), so either the shape leaks format-specific fields or fidelity is lost.

Resolution:

- The text buffer is the single source of truth. Always. Every document has a text
  representation; the parsed model is a derived, optional convenience.
- The parsed model is OPAQUE and OWNED by the format. The core never inspects it.
- A format optionally exposes one or more lossy VIEW ADAPTERS that map its model to a
  generic editor's view and back: for example toTableView/applyTableEdit for the
  generic table editor, toTreeView/applyTreeEdit for the generic tree editor. The
  generic editor edits the view; the format reconciles those edits back into its own
  representation (ideally a region-splice against the original text, see below).
- "Which editor fits" is a capability negotiation (does this format offer a view this
  editor consumes, or a native pairing), NOT a type-equality check on a shared shape.
- Editor pairing tiers, best to worst:
  1. Native pairing: a format ships with its own custom editor that understands its
     model fully (future: FDX editor, subtitle timeline). Highest fidelity.
  2. Generic-view editor: the format exposes a lossy view adapter consumed by a shared
     generic editor (CSV to the table editor, JSON to the tree editor). Convenient,
     explicitly lossy unless backed by a region-splice serializer.
  3. Text fallback: edit the raw text in the code editor (CodeMirror). Always
     available because text is canonical, and byte-exact by construction.
- Consequence for "domain" formats: an opaque model with no editor installed cannot
  fall back to text automatically (it is not text). Therefore every format MUST be
  able to produce text (it is a text format by definition), so the text fallback is
  always real. A format may refuse a non-text editor, never the text editor.

## Round-trip fidelity: honest claims, proven early

- Text-model formats (JSON, YAML, XML, Markdown, TOML, INI, code, .env, logs): edited
  as text in CodeMirror. Round-trip is byte-exact by construction because there is no
  re-serialization. Highlighting and validation are layered on top (lang-* + ajv etc).
  This is the bulk of v1 and is safe.
- Structured editing (table/tree views): round-trip is NOT free. PapaParse,
  fast-xml-parser, and js-yaml do not produce a concrete syntax tree; js-yaml drops
  comments entirely. "Preserve untouched regions" requires either a span-preserving
  parser or a region-splice serializer (keep the original text, track which rows/nodes
  the user actually touched, re-serialize only those, stitch the rest verbatim).
- Phase 0 spike (gate before building the abstraction): implement byte-exact
  region-splice round-trip for CSV (edit a cell, serialize, assert every untouched row
  is byte-identical to the original). If this is not achievable and pleasant within the
  Phase 0 budget, demote structured editing to "best-effort, may reformat" and say so
  in the UI, or drop the table editor from v1. Do not build the view-adapter machinery
  until CSV round-trip is proven.
- Encodings/BOM/line endings are first-class document metadata, detected on open and
  preserved on save (UTF-8 default, but detect UTF-16/latin-1, strip-and-restore BOM,
  preserve CRLF vs LF). These directly affect the byte-exact claim, so they are part of
  the canonical text model, not an afterthought.

## Architecture

The core is small: EventBus + ModuleManager + Registries (Editor / Format / Tool /
Command / Storage) + UIShell + CommandPalette + SessionStore + editor resolution. It
depends on no parser and no DOM editor widget directly. The universal fallback editor
is a privileged but swappable module whose id is a configuration value (not a literal
in the resolver), so "core owns no editor" is structurally true.

### Data flow

Open: Storage reads bytes, decode using detected encoding to canonical text ->
Format.parse(text) yields an opaque model (or, for text-model formats, the text
itself) -> resolve an editor (native pairing > generic view > text fallback) -> editor
mounts and edits the model/view. Save/switch: Format.serialize(model) -> text ->
re-encode with the document's encoding/BOM/line-ending metadata -> Storage writes.

### Interface sketches (TypeScript-ish)

```
interface EditorModule {
  manifest: { kind: 'editor'; editorId: string; consumesViews: string[] }; // e.g. ['table'], ['tree'], ['text']
  create(host: HostAPI): EditorInstance;
}
interface EditorInstance {
  mount(container: HTMLElement, view: EditorView): void; // view = a format's adapter output, or text
  getView(): EditorView;
  applyRemote(change: unknown): void;        // for collaboration, per-editor native binding
  selection(): SelectionToken;               // opaque, only this editor interprets it
  contributeCommands(): CommandDescriptor[]; // editor-scoped commands + keybindings
  focus(): void;
  // a11y contract: the editor owns focus management and ARIA roles for its surface
  dispose(): void;
}

interface FormatModule<Model> {
  manifest: {
    kind: 'format'; formatId: string; extensions: string[]; mimeTypes?: string[];
    nativeEditor?: string;        // an editor that understands this format's model fully
    viewAdapters?: string[];      // e.g. ['table'] | ['tree'] consumed by generic editors
  };
  detect(input: { filename?: string; sample: string }): number;       // 0..1
  parse(text: string): ParseResult<Model>;        // text -> opaque model
  serialize(model: Model): string;                // model -> text (region-splice if possible)
  validate?(model: Model, text: string): Diagnostic[];
  // optional lossy bridges to generic editors:
  toView?(model: Model, view: string): EditorView;
  applyViewEdit?(model: Model, edit: unknown): Model; // reconcile a generic edit back into the model
}
```

For text-model formats the Model is the text, parse/serialize are identity, nativeEditor
is the code editor, and the format only adds a language() for highlighting plus an
optional validate(). For CSV, Model is a row structure with trivia, viewAdapters is
["table"], and serialize is the region-splice serializer proven in the Phase 0 spike.

### Editor switching, dirty state, undo, and keybindings (the protocol)

This is the top data-loss risk, so it is specified, not left implicit.

- Switch protocol: on willChangeEditor/willChangeFormat, serialize the current model
  to text, run the golden round-trip assertion against the last known text; if untouched
  regions are not byte-identical, warn the user before switching. Treat an editor switch
  as an explicit save-point (commit-or-discard), never a silent reformat.
- One undo authority: editor-local undo handles in-session edits (Ctrl+Z lives in the
  active editor). The version-history tool is a coarse, explicit "restore to version"
  action and is NEVER wired to Ctrl+Z. Undo does not cross an editor/format switch;
  the switch is a boundary.
- Selection is an opaque editor-owned token; the core does not interpret it. Commands
  that need selection come from the active editor's contributions, not from generic
  core commands. The single selectionChanged event carries only "selection changed in
  the active editor", not a cross-editor payload.
- Keybinding/command precedence: active-editor bindings win over global bindings unless
  a global command is explicitly marked global-priority. The command palette shows the
  union of global commands and the active editor's contributed commands. Contributions
  mount and unmount with the editor. Specify this in host-api.ts and resolve-editor.ts
  in Phase 0 even though only one editor exists, because retrofitting precedence later
  is painful.
- Crash recovery: persist the raw editor view/model snapshot to IndexedDB on every
  change, independent of serialize, so a serialize-throw or tab crash never loses edits.

### Detection policy

Extension match is a strong prior; a cheap content sniff breaks ties; below a confidence
floor, open as plain text and surface a non-modal "Detected as X, change?" affordance in
the statusbar. Persist the user's override per extension. Note JSON is valid YAML, .txt
is ambiguous, and JSON-with-comments is JSON5, so ambiguity is the norm, not the edge.

### Host API and events

The host object funnels all capabilities so the core can scope and revoke them:
editor/session access, command register/execute, UI slots (toolbar/sidebar/statusbar/
panels) + command palette, the storage broker, notifications, read-only registries, a
scoped event bus, and a brokered fetch (allow-list per manifest). Everything returns a
Disposable tracked by the core. Events: documentOpened, contentChanged, formatDetected,
editorChanged, documentSaved, selectionChanged; awaitable/vetoable hooks beforeSave,
beforeClose, willChangeFormat, willChangeEditor.

## Identity, storage, and durability (browser store is a cache, not a vault)

- On first visit, generate a random session id; persist small config in localStorage,
  documents and version snapshots in IndexedDB (Dexie).
- Browser storage is evictable: "clear browsing data", Safari ITP 7-day eviction of
  script-writable storage for low-engagement sites, private/incognito mode, and quota
  pressure can all silently destroy the only copy. Therefore:
  - Disk export/save is a FIRST-CLASS, always-available feature from Phase 0 (not a
    later "export" phase). The durable copy is the user's file on disk.
  - Request navigator.storage.persist() and surface quota/usage to the user.
  - Be explicit in the UI that the in-browser copy is a cache and nudge to save to disk.
- Local disk via File System Access API gives real open/save, but it is Chromium-desktop
  only: absent on Firefox, Safari, AND all mobile browsers (those get only the sandboxed
  Origin Private File System, not real local-disk pickers). On those, fall back to
  download-to-save / upload-to-open. Declare the product desktop-first, Chromium-best.
- At-rest encryption: with no login there is no stable user secret to derive a key from,
  so encrypting with a key stored next to the data is theater. Default: do NOT encrypt
  at rest. Offer it only as an explicit opt-in passphrase mode, with the per-session
  unlock UX cost made clear. The honest privacy claim is "your data never leaves your
  machine unless you share it", not "encrypted at rest".

## Share-link collaboration: honest threat model (deferred feature)

If/when collaboration is built (it is a gated future, not v1):

- Transport: Yjs CRDT + Trystero (WebRTC, signaling over public relays). The room id
  and a random secret are encoded in the URL fragment (never sent to the static host);
  payloads are end-to-end encrypted with a key derived from the secret. y-indexeddb
  gives offline persistence. Collaboration binds to each editor's NATIVE CRDT binding
  (y-codemirror.next for text; y-prosemirror if a rich-text editor exists), not to the
  abstract model, so it is per-editor work, not a uniform mechanism. Text editors first;
  table/tree collaboration, if ever, may ship as last-writer-wins + presence rather
  than true CRDT, since per-editor grid CRDT bindings are immature.
- What this protects: content confidentiality from the page host and passive relay
  observers.
- What this does NOT protect (state plainly in UI and docs): the link is a bearer
  capability with no revocation (anyone who ever sees it is in forever), no identity,
  and no forward secrecy (a later secret leak decrypts past captured traffic). The
  fragment leaks via synced browser history, copy/paste over plaintext channels,
  shoulder-surfing, and any page script/extension reading location.hash. Relays see
  metadata (room hash, peer IPs, timing, connection graph); WebRTC leaks peer IP
  addresses. A malicious authorized peer can inject bad CRDT updates.
- Mitigations to include if built: a "rotate secret / new link" action that re-keys the
  room; optional link expiry in the fragment; an optional passphrase layer so the link
  alone is insufficient; a visible peer list so the owner sees who is connected; a
  self-hostable relay option. Trystero is full-mesh, so cap the peer count and design
  for small rooms. Call it "no-server, end-to-end-encrypted, link-is-the-key", never
  "secure".

## Supply chain and integrity

The privacy pitch ("open source, so trust it") is only defensible if the running code
matches the source. Therefore: self-host all libraries (no third-party CDN at runtime),
pin dependency versions, use Subresource Integrity for any non-bundled asset, ship a CSP
that blocks unexpected network egress, and publish a build-provenance statement.
Aggressively minimize the v1 dependency set; add each further library only when a
concrete need forces it.

## Recommended libraries (kept minimal for v1)

v1 core set (small, permissive, actively maintained): CodeMirror 6 (MIT) + selected
@codemirror/lang-* and Lezer for highlighting; ajv (MIT) for JSON schema validation;
json5 (MIT); js-yaml (MIT); PapaParse (MIT) for CSV (paired with our own region-splice
serializer, since PapaParse is not a CST); fast-xml-parser (Apache-2.0); toml + ini
(MIT); Dexie (MIT) for IndexedDB; file-saver (MIT) for disk download fallback; Vite +
TypeScript + a lean UI layer (Lit or vanilla).

Deferred/optional (only when their phase is greenlit, with license notes from the
review): jsdiff + jsondiffpatch (diff/history); Yjs + y-indexeddb + y-codemirror.next
(all MIT, confirmed) + Trystero (verify maintenance + full-mesh peer cap) for collab;
a generic table editor (Tabulator MIT or Glide Data Grid MIT; RevoGrid is open-core MIT
with paid pro features, verify needed features are in the core); a JSON tree editor
(jsoneditor, Apache-2.0); rich text (TipTap MIT core, but Snapshots/Comments/AI are
service-gated and the Snapshots feature overlaps our history idea; or Quill, BSD); JSZip
+ jsPDF for export; wasm-pandoc only if document conversion becomes a real need (it is
research-grade, OOMs easily, no Lua filters; do not promise reliable arbitrary
conversion). Markdown rendering (marked or remark) and turndown only when a preview or
HTML-to-Markdown need is concrete.

Conversion reality: generic any-to-any conversion "through the registry" is largely a
fantasy because models are format-owned and not interchange-compatible (CSV-to-YAML is
ambiguous, HTML-to-FDX is nonsense). If conversion happens, it is a few hardcoded
pairwise converters (Markdown-to-HTML, etc), not a generic pipe.

## Phased roadmap (with honest effort and go/no-go gates)

Effort multipliers note where a phase is far bigger than it looks.

Phase 0 (MVP + the round-trip spike, the real foundation): core engine (event bus,
module manager, registries, command palette, UI shell, editor resolution with a
config-named fallback editor), the CodeMirror editor module, JSON (with ajv) and
Markdown formats (text-model), encoding/BOM/line-ending handling, session id, IndexedDB
autosave + crash-recovery snapshotting, and first-class disk save/open (File System
Access with download/upload fallback). PLUS the CSV region-splice round-trip spike as a
proof, even if the table editor itself is not wired yet. Gate: if byte-exact CSV
round-trip is not working and the editor is not genuinely pleasant to use within a fixed
weekend budget, stop or rescope. Critical files: src/core/event-bus.ts,
module-manager.ts, registries.ts, host-api.ts, resolve-editor.ts, session-store.ts,
src/editor/document-session.ts, src/formats/csv-roundtrip.ts (the spike).

Phase 1 (the shippable v1: dev/data breadth + one structured view): add YAML, XML,
TOML, INI, JSON5 formats (all text-model, byte-exact), detection + statusbar format
picker, and ONE generic table editor consuming the CSV view adapter built on the proven
region-splice serializer, with the editor-switch protocol enforced. Effort: the table
editor + switch-with-dirty-state is the hard 5x part, not wiring Tabulator. Outcome: a
real local-first private editor for dev/data files, with CSV editable as a grid or raw
text. This is a complete, useful product on its own; the project has value even if it
stops here.

--- everything below is "future, maybe", behind go/no-go gates ---

Phase 2 (diff + version history): jsdiff (text), jsondiffpatch (JSON); snapshot timeline
in IndexedDB with explicit restore (never wired to undo). Bounded, rewarding work.

Phase 3 (share-link collaboration): Yjs + y-codemirror.next + y-indexeddb + Trystero,
text editors only, with the honest threat model and mitigations above. Effort: 5x-10x;
this is where solo projects stall. Gate hard before starting; consider whether the
personal/small-group framing even needs it.

Phase 4 (a few pairwise converters + export polish): hardcoded converters
(Markdown-to-HTML/PDF), JSZip archive export. NOT a generic conversion engine. pandoc-
wasm only if truly needed.

Phase 5 (more editors/formats, each its own product): rich-text editor + HTML; tree
editor as a JSON alternative; and only as genuinely-long-term possibilities, custom
editors for subtitles (with subsrt) and screenplay (FDX/Fountain). Effort: 10x each;
these compete with strong incumbents and are out of the committed roadmap.

Phase 6 (optional, far future): untrusted third-party plugin sandboxing (Web Worker /
SES) + a plugin registry, only if the project ever opens to outside plugin authors.

## Verification (how to validate end to end)

- Phase 0: run the Vite dev server; open a .json file, type invalid JSON and confirm an
  ajv diagnostic appears; edit, save to disk, hard-reload and confirm restoration from
  IndexedDB; confirm CRLF and a UTF-8 BOM survive a save unchanged. Run the CSV
  round-trip spike test: edit one cell, serialize, assert every untouched row is
  byte-identical. In DevTools confirm the core chunk imports neither the JSON nor
  Markdown parser (separate chunks). Confirm a forced serialize-throw does not lose the
  in-progress edit (crash-recovery snapshot restores it).
- Phase 1: open a CSV, edit a cell in the grid, switch to the raw-text editor and back;
  confirm the switch warns if untouched regions would change and that untouched rows
  round-trip byte-for-byte. Confirm active-editor keybindings take precedence and the
  palette shows editor-scoped commands.
- Per format: a golden round-trip fixture (parse then serialize an unedited file and
  assert byte-identical output) plus encoding/line-ending fixtures.
- Later phases: a test pyramid including resolver unit tests, switch-protocol integration
  tests, and (for collaboration) CRDT convergence tests across simulated peers.

## Name proposals

Chosen direction: Omnitext ("any text format, one editor"). Backups in case of npm /
domain / GitHub-org collisions: Polytext, Anytext, Textverse, Omnidoc. Action before
committing: check the npm name, the github.com org/repo, and a domain are free.

## Open strategic questions (owner's call)

- Breadth vs focus: v1 commits to dev/data; subtitles/screenplay/rich-text are gated
  futures. Confirm you are comfortable shelving the "edit literally any format" pitch as
  a long-term architectural capability rather than a near-term deliverable.
- Collaboration: keep it as a gated future (Phase 3), or cut it entirely given the
  "mostly for me / small group" framing? It is the single largest sink of effort.
- Round-trip ceiling: if the CSV spike does not yield byte-exact structured round-trip
  pleasantly, do we (a) ship structured editing as "best-effort may reformat", or (b)
  drop structured editors from v1 and stay text-only? Decide the fallback now.
