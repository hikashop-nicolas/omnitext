import { OmnitextEngine } from "./core/engine";
import { decodeBytes, encodeText } from "./core/encoding";
import { SessionStore, type DocSnapshot } from "./core/session-store";
import { codemirrorEditor } from "./editors/codemirror";
import { milkdownEditor } from "./editors/milkdown";
import { previewEditor } from "./editors/preview";
import { quillEditor } from "./editors/quill";
import { tableEditor } from "./editors/table";
import { treeEditor } from "./editors/tree";
import { cssFormat } from "./formats/css";
import { csvFormat } from "./formats/csv/index";
import { dotenvFormat } from "./formats/dotenv";
import { htmlFormat } from "./formats/html";
import { iniFormat } from "./formats/ini";
import { javascriptFormat } from "./formats/javascript";
import { jsonFormat } from "./formats/json";
import { json5Format } from "./formats/json5";
import { markdownFormat } from "./formats/markdown";
import { propertiesFormat } from "./formats/properties";
import { pythonFormat } from "./formats/python";
import { sqlFormat } from "./formats/sql";
import { shellFormat } from "./formats/shell";
import { tomlFormat } from "./formats/toml";
import { tsvFormat } from "./formats/tsv";
import { typescriptFormat } from "./formats/typescript";
import { xmlFormat } from "./formats/xml";
import { yamlFormat } from "./formats/yaml";
import type {
  EditorInstance,
  EditorResolution,
  FormatDescriptor,
  FormatModule,
  TextEncoding,
} from "./core/types";

declare global {
  interface Window {
    showOpenFilePicker?: (opts?: unknown) => Promise<FsHandle[]>;
  }
}
interface FsHandle {
  name: string;
  getFile(): Promise<File>;
  createWritable(): Promise<{ write(data: Uint8Array): Promise<void>; close(): Promise<void> }>;
}

// --- engine + module registration (descriptors only; impls load on demand) ----

const engine = new OmnitextEngine({ fallbackEditorId: "codemirror" });
engine.registerEditor(codemirrorEditor);
engine.registerEditor(tableEditor);
engine.registerEditor(previewEditor);
engine.registerEditor(treeEditor);
engine.registerEditor(milkdownEditor);
engine.registerEditor(quillEditor);
const FORMATS: FormatDescriptor[] = [
  jsonFormat,
  json5Format,
  markdownFormat,
  csvFormat,
  tsvFormat,
  yamlFormat,
  xmlFormat,
  tomlFormat,
  iniFormat,
  htmlFormat,
  cssFormat,
  javascriptFormat,
  typescriptFormat,
  pythonFormat,
  sqlFormat,
  shellFormat,
  dotenvFormat,
  propertiesFormat,
];
for (const f of FORMATS) engine.registerFormat(f);

const store = new SessionStore();

// Friendly labels for editor ids shown in the switcher and status pill.
const EDITOR_LABELS: Record<string, string> = {
  codemirror: "Text",
  table: "Table",
  preview: "Preview",
  tree: "Tree",
  milkdown: "Rich",
  quill: "WYSIWYG",
};
const editorLabel = (id: string): string => EDITOR_LABELS[id] ?? id;

// Per-format editor preference, persisted so a choice (e.g. "edit CSV as a table") sticks.
const PREF_KEY = "omnitext:prefEditor";
const prefs: Record<string, string> = loadPrefs();
function loadPrefs(): Record<string, string> {
  try {
    return JSON.parse(localStorage.getItem(PREF_KEY) ?? "{}") as Record<string, string>;
  } catch {
    return {};
  }
}
function savePrefs(): void {
  try {
    localStorage.setItem(PREF_KEY, JSON.stringify(prefs));
  } catch {
    /* ignore */
  }
}

// --- session state -----------------------------------------------------------

interface Session {
  id: string;
  uri: string | null;
  filename: string | null;
  formatId: string | null;
  encoding: TextEncoding;
  editor: EditorInstance | null;
  editorId: string | null;
  fileHandle: FsHandle | null;
  lastSavedText: string;
  dirty: boolean;
}

let session: Session | null = null;
let autosaveTimer: ReturnType<typeof setTimeout> | undefined;

// --- DOM ---------------------------------------------------------------------

const $ = <T extends HTMLElement>(id: string): T => {
  const el = document.getElementById(id);
  if (!el) throw new Error(`missing #${id}`);
  return el as T;
};
const editorEl = $("editor");
const filenameEl = $("filename");
const dirtyEl = $("dirty");
const reasonEl = $("reason");
const statusTextEl = $("status-text");
const formatSel = $<HTMLSelectElement>("format");
const editorSel = $<HTMLSelectElement>("editor-select");
const fileInput = $<HTMLInputElement>("file-input");

function populateFormatSelect(current: string | null): void {
  formatSel.innerHTML = "";
  formatSel.add(new Option("auto", ""));
  for (const f of FORMATS) {
    formatSel.add(new Option(f.manifest.id, f.manifest.id));
  }
  formatSel.value = current ?? "";
}

function populateEditorSelect(choices: EditorResolution[], currentId: string): void {
  editorSel.innerHTML = "";
  for (const c of choices) {
    editorSel.add(new Option(editorLabel(c.editor.manifest.id), c.editor.manifest.id));
  }
  editorSel.value = currentId;
  editorSel.disabled = choices.length <= 1;
}

function updateUI(): void {
  filenameEl.textContent = session?.filename ?? "untitled";
  dirtyEl.textContent = session?.dirty ? "(modified)" : "";
  formatSel.value = session?.formatId ?? "";
  if (session?.editorId) editorSel.value = session.editorId;
}

function setStatus(msg: string): void {
  statusTextEl.textContent = msg;
}

// --- core flow ---------------------------------------------------------------

interface MountOpts {
  filename: string | null;
  encoding: TextEncoding;
  uri?: string | null;
  fileHandle?: FsHandle | null;
  formatId?: string | null;
  editorId?: string | null;
  recovered?: boolean;
}

async function mountDoc(text: string, opts: MountOpts): Promise<void> {
  // Resolve the format descriptor (explicit id, else detection).
  let descriptor: FormatDescriptor | null = null;
  if (opts.formatId) {
    descriptor = engine.formats.byId(opts.formatId) ?? null;
  } else {
    const filename = opts.filename ?? undefined;
    const sample = text.slice(0, 8192);
    const hit = engine.detect(filename !== undefined ? { filename, sample } : { sample });
    descriptor = hit?.descriptor ?? null;
  }
  const formatId = descriptor?.manifest.id ?? null;

  // Choose the editor: explicit, else a saved per-format preference, else resolution.
  const choices = engine.editorChoices(descriptor);
  const wantEditorId = opts.editorId ?? (formatId ? prefs[formatId] : undefined);
  let chosen =
    choices.find((c) => c.editor.manifest.id === wantEditorId) ?? engine.resolve(descriptor);

  // Load the (lazy) implementations.
  let formatModule: FormatModule | null = null;
  try {
    if (descriptor) formatModule = await descriptor.load();
  } catch (e) {
    console.error("format load failed", e);
    engine.notificationSink.error(`Could not load the ${formatId} format.`);
  }
  // A chunk can fail to load (e.g. a stale page after a redeploy). Degrade to the text
  // editor instead of wedging, and tell the user.
  let editorModule;
  try {
    editorModule = await chosen.editor.load();
  } catch (e) {
    console.error("editor load failed", e);
    const fallback = engine.editors.byId("codemirror");
    if (!fallback || chosen.editor.manifest.id === "codemirror") throw e;
    engine.notificationSink.warn(
      `Could not load the ${editorLabel(chosen.editor.manifest.id)} editor (try reloading). Using Text.`,
    );
    chosen = { editor: fallback, view: "text", reason: "fallback" };
    editorModule = await fallback.load();
  }
  const instance = editorModule.create(engine.host("app"));

  session?.editor?.dispose();
  session = {
    id: session?.id ?? crypto.randomUUID(),
    uri: opts.uri ?? null,
    filename: opts.filename,
    formatId,
    encoding: opts.encoding,
    editor: instance,
    editorId: chosen.editor.manifest.id,
    fileHandle: opts.fileHandle ?? null,
    lastSavedText: text,
    dirty: false,
  };

  editorEl.innerHTML = "";
  instance.mount(editorEl, {
    text,
    format: formatModule,
    view: chosen.view,
    onChange: () => {
      if (!session) return;
      session.dirty = session.editor!.getText() !== session.lastSavedText;
      updateUI();
      scheduleAutosave();
    },
  });
  instance.focus();

  reasonEl.textContent = `${editorLabel(chosen.editor.manifest.id)} · ${chosen.reason}`;
  populateFormatSelect(formatId);
  populateEditorSelect(choices, chosen.editor.manifest.id);
  updateUI();
  engine.events.emit("documentOpened", { sessionId: session.id, uri: session.uri, formatId });
  setStatus(
    opts.recovered
      ? "Recovered unsaved work from this browser. Use Save to write it to disk."
      : "Ready. The in-browser copy is a cache; use Save for a durable file.",
  );
}

function snapshot(): DocSnapshot | null {
  if (!session?.editor) return null;
  return {
    id: session.id,
    uri: session.uri,
    filename: session.filename,
    formatId: session.formatId,
    text: session.editor.getText(),
    encoding: session.encoding,
    updatedAt: Date.now(),
  };
}

function scheduleAutosave(): void {
  clearTimeout(autosaveTimer);
  autosaveTimer = setTimeout(() => {
    const snap = snapshot();
    if (snap) void store.save(snap).catch((e) => console.error("autosave failed", e));
  }, 400);
}

// --- open / save -------------------------------------------------------------

async function openFile(): Promise<void> {
  if (window.showOpenFilePicker) {
    try {
      const [handle] = await window.showOpenFilePicker();
      if (!handle) return;
      const file = await handle.getFile();
      const decoded = decodeBytes(await file.arrayBuffer());
      await mountDoc(decoded.text, {
        filename: file.name,
        encoding: decoded.encoding,
        uri: `fs://${file.name}`,
        fileHandle: handle,
      });
      if (decoded.lossyOnSave) setStatus("Note: this file's encoding will be saved as UTF-8.");
    } catch (e) {
      if ((e as DOMException)?.name !== "AbortError") console.error(e);
    }
    return;
  }
  fileInput.click();
}

fileInput.addEventListener("change", async () => {
  const file = fileInput.files?.[0];
  if (!file) return;
  const decoded = decodeBytes(await file.arrayBuffer());
  await mountDoc(decoded.text, {
    filename: file.name,
    encoding: decoded.encoding,
    uri: `upload://${file.name}`,
  });
  fileInput.value = "";
});

async function saveFile(): Promise<void> {
  if (!session?.editor) return;
  const text = session.editor.getText();
  const ctx = await engine.events.runHook("beforeSave", {
    sessionId: session.id,
    text,
    cancel: false,
  });
  if (ctx.cancel) return;

  const bytes = encodeText(text, session.encoding);
  const handle = session.fileHandle;
  if (handle?.createWritable) {
    const w = await handle.createWritable();
    await w.write(bytes);
    await w.close();
  } else {
    downloadBytes(bytes, session.filename ?? "untitled.txt");
  }

  session.lastSavedText = text;
  session.dirty = false;
  updateUI();
  engine.events.emit("documentSaved", { sessionId: session.id, uri: session.uri ?? "download" });
  setStatus("Saved.");
}

function downloadBytes(bytes: Uint8Array, name: string): void {
  const blob = new Blob([bytes as BlobPart], { type: "application/octet-stream" });
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = name;
  a.click();
  URL.revokeObjectURL(url);
}

// --- format / editor switching (text is the canonical hand-off) --------------

function changeFormat(formatId: string): void {
  if (!session?.editor) return;
  const text = session.editor.getText();
  void mountDoc(text, {
    filename: session.filename,
    encoding: session.encoding,
    uri: session.uri,
    fileHandle: session.fileHandle,
    formatId: formatId || null,
  });
}

async function changeEditor(editorId: string): Promise<void> {
  if (!session?.editor || editorId === session.editorId) return;
  // Switch protocol: serialize current model to canonical text, then remount. The
  // hook lets future tools veto or warn on a lossy hand-off.
  const text = session.editor.getText();
  const ctx = await engine.events.runHook("willChangeEditor", {
    sessionId: session.id,
    toEditor: editorId,
    cancel: false,
  });
  if (ctx.cancel) {
    if (session.editorId) editorSel.value = session.editorId;
    return;
  }
  if (session.formatId) {
    prefs[session.formatId] = editorId;
    savePrefs();
  }
  await mountDoc(text, {
    filename: session.filename,
    encoding: session.encoding,
    uri: session.uri,
    fileHandle: session.fileHandle,
    formatId: session.formatId,
    editorId,
  });
}

// --- wire up -----------------------------------------------------------------

$("btn-new").addEventListener("click", () =>
  void mountDoc("", { filename: null, encoding: { label: "utf-8", bom: false } }),
);
$("btn-open").addEventListener("click", () => void openFile());
$("btn-save").addEventListener("click", () => void saveFile());
formatSel.addEventListener("change", () => changeFormat(formatSel.value));
editorSel.addEventListener("change", () => void changeEditor(editorSel.value));

window.addEventListener("beforeunload", (e) => {
  if (session?.dirty) {
    e.preventDefault();
    e.returnValue = "";
  }
});

// --- startup: crash recovery, else a blank doc -------------------------------

async function start(): Promise<void> {
  void SessionStore.requestPersistent();
  let last: DocSnapshot | undefined;
  try {
    last = await store.loadLatest();
  } catch (e) {
    console.error("recovery load failed", e);
  }
  if (last?.text) {
    session = { id: last.id } as Session;
    await mountDoc(last.text, {
      filename: last.filename,
      encoding: last.encoding,
      uri: last.uri,
      formatId: last.formatId,
      recovered: true,
    });
  } else {
    await mountDoc("", { filename: null, encoding: { label: "utf-8", bom: false } });
  }
}

void start();
