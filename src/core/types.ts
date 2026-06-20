// Omnitext core contracts.
//
// These types ARE the structure the project commits to from day one: any text format
// is supported via Format modules, the editing surface is swappable via Editor
// modules, cross-cutting features (diff, history, export, and later collaboration)
// are Tool modules, and the document model is format-owned and opaque to the core.
// The core depends on no parser and no DOM editor widget; those live in modules.

export interface Disposable {
  dispose(): void;
}

// ---------------------------------------------------------------------------
// Document content + encoding (preserved for byte-exact round-trip)
// ---------------------------------------------------------------------------

export interface TextEncoding {
  /** Label such as "utf-8" or "utf-16le". */
  label: string;
  /** Whether the original bytes began with a byte-order mark. */
  bom: boolean;
}

export interface Diagnostic {
  severity: "error" | "warning" | "info";
  message: string;
  /** Text offsets, when the diagnostic maps to the canonical text. */
  from?: number;
  to?: number;
}

export interface DetectInput {
  filename?: string;
  /** A prefix of the document text; detectors must not assume the whole file. */
  sample: string;
}

// ---------------------------------------------------------------------------
// Generic, explicitly-lossy view contracts shared by formats and generic editors
// ---------------------------------------------------------------------------

/** The view a generic table editor consumes. Trivia stays inside the format. */
export interface TableView {
  rows: string[][];
}

export type ViewEdit =
  | { type: "cell"; row: number; col: number; value: string };

/** The view a read-only preview editor consumes. */
export interface PreviewView {
  /** Ready-to-display HTML. If sandbox is false, the format must have sanitized it. */
  html: string;
  /** Render in a sandboxed iframe (untrusted HTML) instead of inline. */
  sandbox: boolean;
}

/** The view a tree editor consumes for structured (JSON-like) editing. */
export interface TreeView {
  value: unknown;
  /** Serialize an edited value back to canonical text (reformats the document). */
  stringify: (value: unknown) => string;
}

/** Identifies the editing surface a format projects to. Open set (string). */
export type ViewKind = "text" | "table" | "tree" | (string & {});

// ---------------------------------------------------------------------------
// Format modules
// ---------------------------------------------------------------------------

export interface ParseResult {
  ok: boolean;
  /** Opaque, format-owned model. The core never inspects it. */
  model: unknown;
  diagnostics: Diagnostic[];
}

export interface FormatManifest {
  kind: "format";
  id: string;
  extensions: string[];
  mimeTypes?: string[];
  /** An editor id that understands this format's model natively (highest fidelity). */
  nativeEditor?: string;
  /** Generic views this format can project to and reconcile from (lossy convenience). */
  viewAdapters?: ViewKind[];
  /**
   * Editor id to open this format with by default (the "nicest" surface), overriding
   * the native-first order. Must be reachable via nativeEditor or a viewAdapter. The
   * user can still switch, and their per-format choice takes precedence.
   */
  defaultEditor?: string;
}

/**
 * Format behavior, loaded lazily (it may pull in a heavy parser / CodeMirror
 * language). Metadata and detection live on FormatDescriptor so the registry can
 * detect and resolve without importing the implementation.
 */
export interface FormatModule {
  /** Canonical text to an opaque model. For text-model formats, model === text. */
  parse(text: string): ParseResult;
  /** Opaque model back to canonical text. Must be byte-exact for untouched regions. */
  serialize(model: unknown): string;
  validate?(model: unknown, text: string): Diagnostic[];
  /** Project the model to a generic view (lossy). Returns e.g. a TableView. */
  toView?(model: unknown, view: ViewKind): unknown;
  /** Reconcile a generic view edit back into the model, returning a new model. */
  applyViewEdit?(model: unknown, edit: ViewEdit): unknown;
  /**
   * Optional CodeMirror language extension(s) for the text editor. Typed as unknown
   * so the core never imports CodeMirror; only the editor module casts and uses it.
   */
  language?(): unknown;
}

/** Cheap, eagerly-registered handle to a format. The implementation loads on demand. */
export interface FormatDescriptor {
  manifest: FormatManifest;
  /** 0..1 confidence from a lightweight content sniff (no heavy parser import). */
  detect(input: DetectInput): number;
  load(): Promise<FormatModule>;
}

// ---------------------------------------------------------------------------
// Editor modules
// ---------------------------------------------------------------------------

export interface EditorManifest {
  kind: "editor";
  id: string;
  /** View kinds this editor can edit (e.g. ["text"], ["table"]). */
  consumesViews: ViewKind[];
}

export interface EditorMountContext {
  /** Canonical text of the document (the source of truth). */
  text: string;
  /** The active format, for highlighting/validation and view adapters. May be null. */
  format: FormatModule | null;
  /** The view kind the resolver picked for this editor. */
  view: ViewKind;
  /** Editor calls this after a user edit so the host can mark dirty + autosave. */
  onChange(): void;
}

export interface EditorInstance {
  mount(container: HTMLElement, ctx: EditorMountContext): void;
  /** Current content as canonical text (used for save and editor switching). */
  getText(): string;
  /** Future collaboration hook: apply a remote change from a CRDT binding. */
  applyRemote?(change: unknown): void;
  /** Opaque, editor-owned selection token; only this editor interprets it. */
  selection(): unknown;
  /** Editor-scoped commands; active-editor bindings win over non-global globals. */
  contributeCommands?(): CommandDescriptor[];
  focus(): void;
  dispose(): void;
}

/** Editor behavior, loaded lazily (it may pull in CodeMirror or a grid library). */
export interface EditorModule {
  create(host: HostAPI): EditorInstance;
}

/** Cheap, eagerly-registered handle to an editor. The implementation loads on demand. */
export interface EditorDescriptor {
  manifest: EditorManifest;
  load(): Promise<EditorModule>;
}

// ---------------------------------------------------------------------------
// Tool + storage modules (collaboration will be a Tool that binds per-editor)
// ---------------------------------------------------------------------------

export interface ToolManifest {
  kind: "tool" | "storage";
  id: string;
  capabilities?: string[];
}

export interface ToolModule {
  manifest: ToolManifest;
  activate(host: HostAPI): Disposable;
}

export interface StorageProvider {
  scheme: string;
  read(uri: string): Promise<{ text: string }>;
  write(uri: string, text: string): Promise<void>;
}

// ---------------------------------------------------------------------------
// Commands
// ---------------------------------------------------------------------------

export interface CommandDescriptor {
  id: string;
  title: string;
  keybinding?: string;
  /** Global-priority binding; otherwise the active editor's bindings take precedence. */
  global?: boolean;
  run(...args: unknown[]): unknown | Promise<unknown>;
}

// ---------------------------------------------------------------------------
// Events (notifications) and hooks (awaitable, vetoable)
// ---------------------------------------------------------------------------

export interface CoreEvents {
  documentOpened: { sessionId: string; uri: string | null; formatId: string | null };
  contentChanged: { sessionId: string };
  formatDetected: { sessionId: string; formatId: string; confidence: number };
  editorChanged: { sessionId: string; editorId: string };
  documentSaved: { sessionId: string; uri: string };
  selectionChanged: { sessionId: string };
}

export interface CoreHooks {
  beforeSave: { sessionId: string; text: string; cancel: boolean };
  beforeClose: { sessionId: string; dirty: boolean; cancel: boolean };
  willChangeFormat: { sessionId: string; toFormat: string; cancel: boolean };
  willChangeEditor: { sessionId: string; toEditor: string; cancel: boolean };
}

export interface EventBus {
  on<E extends keyof CoreEvents>(event: E, handler: (p: CoreEvents[E]) => void): Disposable;
  emit<E extends keyof CoreEvents>(event: E, payload: CoreEvents[E]): void;
  hook<H extends keyof CoreHooks>(
    name: H,
    handler: (ctx: CoreHooks[H]) => void | Promise<void>,
  ): Disposable;
  runHook<H extends keyof CoreHooks>(name: H, ctx: CoreHooks[H]): Promise<CoreHooks[H]>;
}

// ---------------------------------------------------------------------------
// Registries (read-only views are what modules receive via the host)
// ---------------------------------------------------------------------------

export interface FormatRegistryReadonly {
  byId(id: string): FormatDescriptor | undefined;
  byExtension(ext: string): FormatDescriptor[];
  detect(input: DetectInput): { descriptor: FormatDescriptor; confidence: number } | null;
  list(): FormatDescriptor[];
}

export interface EditorRegistryReadonly {
  byId(id: string): EditorDescriptor | undefined;
  consumersOf(view: ViewKind): EditorDescriptor[];
  list(): EditorDescriptor[];
}

export interface ToolRegistryReadonly {
  byId(id: string): ToolModule | undefined;
  list(): ToolModule[];
}

export interface CommandRegistry {
  register(cmd: CommandDescriptor): Disposable;
  execute(id: string, ...args: unknown[]): Promise<unknown>;
  list(): CommandDescriptor[];
}

export interface Notifications {
  info(message: string): void;
  warn(message: string): void;
  error(message: string): void;
}

// ---------------------------------------------------------------------------
// Host API: the single capability object handed to every module
// ---------------------------------------------------------------------------

export interface HostAPI {
  readonly moduleId: string;
  readonly events: EventBus;
  readonly commands: CommandRegistry;
  readonly formats: FormatRegistryReadonly;
  readonly editors: EditorRegistryReadonly;
  readonly tools: ToolRegistryReadonly;
  readonly notifications: Notifications;
}

/** Resolution result: which editor renders a document and through which view. */
export interface EditorResolution {
  editor: EditorDescriptor;
  view: ViewKind;
  /** "native" | "view" | "fallback", for diagnostics and UI. */
  reason: "native" | "view" | "fallback";
}
