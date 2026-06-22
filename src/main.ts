import { OmnitextEngine } from "./core/engine";
import { decodeBytes, encodeText } from "./core/encoding";
import { isNative, saveBytesNative } from "./core/platform";
import { SessionStore, type DocSnapshot } from "./core/session-store";
import { codemirrorEditor } from "./editors/codemirror";
import { milkdownEditor } from "./editors/milkdown";
import { docxEditor } from "./editors/docx";
import { odtEditor } from "./editors/odt";
import { pdfEditor } from "./editors/pdf";
import { previewEditor } from "./editors/preview";
import { quillEditor } from "./editors/quill";
import { sheetEditor } from "./editors/sheet";
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
import { docxFormat } from "./formats/docx";
import { markdownFormat } from "./formats/markdown";
import { odsFormat } from "./formats/ods";
import { odtFormat } from "./formats/odt";
import { propertiesFormat } from "./formats/properties";
import { pythonFormat } from "./formats/python";
import { sqlFormat } from "./formats/sql";
import { shellFormat } from "./formats/shell";
import { tomlFormat } from "./formats/toml";
import { tsvFormat } from "./formats/tsv";
import { typescriptFormat } from "./formats/typescript";
import { pdfFormat } from "./formats/pdf";
import { xlsFormat } from "./formats/xls";
import { xlsxFormat } from "./formats/xlsx";
import { xmlFormat } from "./formats/xml";
import { yamlFormat } from "./formats/yaml";
import { historyTool } from "./tools/history";
import { applyDom, initI18n, t } from "./i18n";
import type {
  EditorInstance,
  EditorResolution,
  FormatDescriptor,
  FormatModule,
  TextEncoding,
  UIContributions,
  Workspace,
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
engine.registerEditor(pdfEditor);
engine.registerEditor(odtEditor);
engine.registerEditor(docxEditor);
engine.registerEditor(sheetEditor);
const FORMATS: FormatDescriptor[] = [
  jsonFormat,
  json5Format,
  markdownFormat,
  csvFormat,
  tsvFormat,
  xlsxFormat,
  xlsFormat,
  pdfFormat,
  odtFormat,
  docxFormat,
  odsFormat,
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

// Friendly labels for editor ids (shown in the switcher and status pill); from i18n,
// falling back to the raw id when a label is missing.
const editorLabel = (id: string): string => {
  const key = `app.editors.${id}`;
  const label = t(key);
  return label === key ? id : label;
};

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
  binary: boolean;
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
const formatLabelEl = $("format-label");
const editorSel = $<HTMLSelectElement>("editor-select");
const fileInput = $<HTMLInputElement>("file-input");
const toolsEl = $("tools");
const panelEl = $("panel");
const panelTitleEl = $("panel-title");
const panelBodyEl = $("panel-body");
const newDlgEl = $("newdlg");
const newFormatSel = $<HTMLSelectElement>("new-format");

// Format is a read-only label for the active document: it is determined by the file's
// content/extension on open, or chosen up front in the New dialog. Switching the format
// of an open document is meaningless for binary files (xlsx/pdf/docx/odt) and would
// discard their bytes, so it is not offered inline.
function setFormatLabel(current: string | null): void {
  formatLabelEl.textContent = current ?? t("app.plainText");
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
  filenameEl.textContent = session?.filename ?? t("app.untitled");
  const modified = !!session?.dirty;
  dirtyEl.classList.toggle("is-modified", modified);
  dirtyEl.title = modified ? t("app.unsavedChanges") : t("app.allSaved");
  setFormatLabel(session?.formatId ?? null);
  if (session?.editorId) editorSel.value = session.editorId;
}

function setStatus(msg: string): void {
  statusTextEl.textContent = msg;
}

// --- core flow ---------------------------------------------------------------

interface MountOpts {
  text?: string;
  bytes?: Uint8Array | null;
  binary?: boolean;
  filename: string | null;
  encoding: TextEncoding;
  uri?: string | null;
  fileHandle?: FsHandle | null;
  formatId?: string | null;
  editorId?: string | null;
  recovered?: boolean;
}

async function mountDoc(opts: MountOpts): Promise<void> {
  const binary = !!opts.binary;
  const text = opts.text ?? "";
  const bytes = opts.bytes ?? null;

  // Resolve the format descriptor (explicit id, else detection on the text).
  let descriptor: FormatDescriptor | null = null;
  if (opts.formatId) {
    descriptor = engine.formats.byId(opts.formatId) ?? null;
  } else if (!binary) {
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
    engine.notificationSink.error(t("notify.formatLoadFailed", { format: formatId ?? "" }));
  }

  // Pre-parse content into the format's model (from text or bytes) for the editor.
  let model: unknown = text;
  if (formatModule) {
    try {
      model = binary
        ? (formatModule.parseBinary?.(bytes ?? new Uint8Array())?.model ?? null)
        : formatModule.parse(text).model;
    } catch (e) {
      console.error("parse failed", e);
      engine.notificationSink.error(t("notify.readFailed", { what: formatId ?? t("notify.documentWord") }));
    }
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
      t("notify.editorLoadFailed", { editor: editorLabel(chosen.editor.manifest.id) }),
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
    lastSavedText: binary ? "" : text,
    dirty: false,
    binary,
  };

  editorEl.innerHTML = "";
  instance.mount(editorEl, {
    text,
    bytes,
    binary,
    model,
    format: formatModule,
    view: chosen.view,
    onChange: () => {
      if (!session) return;
      session.dirty = session.binary
        ? true
        : session.editor!.getText() !== session.lastSavedText;
      updateUI();
      if (!session.binary) scheduleAutosave();
      engine.events.emit("contentChanged", { sessionId: session.id });
    },
  });
  instance.focus();

  const reasonKey = `app.reason.${chosen.reason}`;
  const reasonText = t(reasonKey) === reasonKey ? chosen.reason : t(reasonKey);
  reasonEl.textContent = `${editorLabel(chosen.editor.manifest.id)} · ${reasonText}`;
  setFormatLabel(formatId);
  populateEditorSelect(choices, chosen.editor.manifest.id);
  updateUI();
  engine.events.emit("documentOpened", { sessionId: session.id, uri: session.uri, formatId });
  const where = isNative() ? t("status.onThisDevice") : t("status.inThisBrowser");
  setStatus(opts.recovered ? t("status.recovered") : t("status.ready", { where }));
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

/** A registered binary format matching the filename's extension, else null. */
function binaryFormatFor(filename: string): FormatDescriptor | null {
  const dot = filename.lastIndexOf(".");
  if (dot < 0) return null;
  const d = engine.formats.byExtension(filename.slice(dot))[0];
  return d?.manifest.binary ? d : null;
}

async function openBuffer(buffer: ArrayBuffer, filename: string, scheme: string, handle: FsHandle | null): Promise<void> {
  const bin = binaryFormatFor(filename);
  if (bin) {
    await mountDoc({
      bytes: new Uint8Array(buffer),
      binary: true,
      formatId: bin.manifest.id,
      filename,
      encoding: { label: "binary", bom: false },
      uri: `${scheme}://${filename}`,
      fileHandle: handle,
    });
    return;
  }
  const decoded = decodeBytes(buffer);
  await mountDoc({
    text: decoded.text,
    filename,
    encoding: decoded.encoding,
    uri: `${scheme}://${filename}`,
    fileHandle: handle,
  });
  if (decoded.lossyOnSave) setStatus(t("status.encodingUtf8"));
}

async function openFile(): Promise<void> {
  if (window.showOpenFilePicker) {
    try {
      const [handle] = await window.showOpenFilePicker();
      if (!handle) return;
      const file = await handle.getFile();
      await openBuffer(await file.arrayBuffer(), file.name, "fs", handle);
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
  await openBuffer(await file.arrayBuffer(), file.name, "upload", null);
  fileInput.value = "";
});

async function saveFile(): Promise<void> {
  if (!session?.editor) return;

  let bytes: Uint8Array;
  let savedText = "";
  if (session.binary) {
    const b = await session.editor.getBytes?.();
    if (!b) {
      engine.notificationSink.error(t("notify.cannotSave"));
      return;
    }
    bytes = b;
  } else {
    savedText = session.editor.getText();
    const ctx = await engine.events.runHook("beforeSave", {
      sessionId: session.id,
      text: savedText,
      cancel: false,
    });
    if (ctx.cancel) return;
    bytes = encodeText(savedText, session.encoding);
  }

  const name = session.filename ?? "untitled.txt";
  const handle = session.fileHandle;
  try {
    if (isNative()) {
      // The app's WebView exposes the File System Access API, but writing back to a
      // picked document's content URI is denied by Android, so always route Save
      // through the native share/save sheet instead of the (broken) handle path.
      await saveBytesNative(bytes, name);
    } else if (handle?.createWritable) {
      const w = await handle.createWritable();
      await w.write(bytes);
      await w.close();
    } else {
      downloadBytes(bytes, name);
    }
  } catch (e) {
    console.error("save failed", e);
    engine.notificationSink.error(t("notify.saveFailed"));
    return;
  }

  if (!session.binary) session.lastSavedText = savedText;
  session.dirty = false;
  updateUI();
  engine.events.emit("documentSaved", { sessionId: session.id, uri: session.uri ?? "download" });
  setStatus(t("status.saved"));
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

// --- new document (format chosen up front) -----------------------------------

function populateNewFormatSelect(): void {
  newFormatSel.innerHTML = "";
  newFormatSel.add(new Option(t("app.plainTextOption"), ""));
  // Only text-based formats can be created blank; binary formats need real file bytes.
  for (const f of FORMATS) {
    if (f.manifest.binary) continue;
    newFormatSel.add(new Option(f.manifest.id, f.manifest.id));
  }
  newFormatSel.value = "";
}

function openNewDialog(): void {
  populateNewFormatSelect();
  newDlgEl.hidden = false;
  newFormatSel.focus();
}

function closeNewDialog(): void {
  newDlgEl.hidden = true;
}

function createNewDocument(): void {
  const formatId = newFormatSel.value || null;
  closeNewDialog();
  // Start blank documents in the text editor: structured surfaces (tree/table) error on
  // empty content. The View switcher lets the user move to them once they have content.
  void mountDoc({
    text: "",
    filename: null,
    encoding: { label: "utf-8", bom: false },
    formatId,
    editorId: "codemirror",
  });
}

// --- editor switching (text is the canonical hand-off) -----------------------

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
  await mountDoc({
    text,
    filename: session.filename,
    encoding: session.encoding,
    uri: session.uri,
    fileHandle: session.fileHandle,
    formatId: session.formatId,
    editorId,
  });
}

// --- wire up -----------------------------------------------------------------

$("btn-new").addEventListener("click", openNewDialog);
$("btn-open").addEventListener("click", () => void openFile());
$("btn-save").addEventListener("click", () => void saveFile());
$("new-cancel").addEventListener("click", closeNewDialog);
$("new-create").addEventListener("click", createNewDocument);
newDlgEl.addEventListener("click", (e) => {
  if (e.target === newDlgEl) closeNewDialog(); // click the backdrop to dismiss
});
newFormatSel.addEventListener("keydown", (e) => {
  if (e.key === "Enter") createNewDocument();
});
document.addEventListener("keydown", (e) => {
  if (e.key === "Escape" && !newDlgEl.hidden) closeNewDialog();
});
editorSel.addEventListener("change", () => void changeEditor(editorSel.value));

// Tapping the save-state dot shows its meaning as a brief tooltip (touch has no hover).
let dirtyTip: HTMLElement | null = null;
let dirtyTipTimer: ReturnType<typeof setTimeout> | undefined;
dirtyEl.addEventListener("click", () => {
  if (!dirtyTip) {
    dirtyTip = document.createElement("div");
    dirtyTip.className = "ot-tip";
    document.body.appendChild(dirtyTip);
  }
  dirtyTip.textContent = dirtyEl.title;
  const r = dirtyEl.getBoundingClientRect();
  dirtyTip.style.left = `${r.left}px`;
  dirtyTip.style.top = `${r.bottom + 6}px`;
  dirtyTip.hidden = false;
  clearTimeout(dirtyTipTimer);
  dirtyTipTimer = setTimeout(() => {
    if (dirtyTip) dirtyTip.hidden = true;
  }, 2200);
});

window.addEventListener("beforeunload", (e) => {
  if (session?.dirty) {
    e.preventDefault();
    e.returnValue = "";
  }
});

// --- workspace + UI providers for tools, then register tools -----------------

const workspace: Workspace = {
  getActiveDocument() {
    if (!session?.editor) return null;
    return {
      sessionId: session.id,
      key: session.uri ?? session.id,
      uri: session.uri,
      filename: session.filename,
      formatId: session.formatId,
      text: session.binary ? "" : session.editor.getText(),
      binary: session.binary,
    };
  },
  async getActiveBytes() {
    if (!session?.editor || !session.binary) return null;
    return (await session.editor.getBytes?.()) ?? null;
  },
  getActiveState() {
    if (!session?.editor) return null;
    return session.editor.getState?.() ?? null;
  },
  setActiveState(state) {
    if (!session?.editor?.setState || !state) return;
    // Restore happens in place (the editor re-renders the pristine doc and replays the edits);
    // mark dirty since the restored state differs from what is on disk.
    session.editor.setState(state);
    session.dirty = true;
    updateUI();
  },
  setActiveBytes(bytes) {
    if (!session?.editor || !session.binary) return;
    // Remount the binary editor from the restored bytes; mark dirty since the restored
    // content differs from what is on disk.
    void mountDoc({
      bytes,
      binary: true,
      filename: session.filename,
      encoding: session.encoding,
      uri: session.uri,
      fileHandle: session.fileHandle,
      formatId: session.formatId,
      editorId: session.editorId,
    }).then(() => {
      if (!session?.editor) return;
      session.dirty = true;
      updateUI();
    });
  },
  setActiveText(text) {
    if (!session?.editor) return;
    const prevSaved = session.lastSavedText; // keep the on-disk baseline so restore is dirty
    void mountDoc({
      text,
      filename: session.filename,
      encoding: session.encoding,
      uri: session.uri,
      fileHandle: session.fileHandle,
      formatId: session.formatId,
      editorId: session.editorId,
    }).then(() => {
      if (!session?.editor) return;
      session.lastSavedText = prevSaved;
      session.dirty = session.editor.getText() !== prevSaved;
      updateUI();
      scheduleAutosave();
    });
  },
};

let panelCleanup: (() => void) | null = null;
const ui: UIContributions = {
  addToolbarButton(btn) {
    const b = document.createElement("button");
    b.className = btn.icon ? "btn icon" : "btn";
    b.id = `toolbtn-${btn.id}`;
    if (btn.icon) {
      b.innerHTML = btn.icon;
      b.title = btn.title;
      b.setAttribute("aria-label", btn.title);
    } else {
      b.textContent = btn.title;
    }
    b.addEventListener("click", btn.onClick);
    toolsEl.appendChild(b);
    return { dispose: () => b.remove() };
  },
  openPanel(panel) {
    ui.closePanels();
    panelTitleEl.textContent = panel.title;
    panelBodyEl.textContent = "";
    const cleanup = panel.render(panelBodyEl);
    if (typeof cleanup === "function") panelCleanup = cleanup;
    panelEl.hidden = false;
    return { close: () => ui.closePanels() };
  },
  closePanels() {
    if (panelCleanup) {
      try {
        panelCleanup();
      } catch {
        /* ignore */
      }
      panelCleanup = null;
    }
    panelBodyEl.textContent = "";
    panelEl.hidden = true;
  },
};

engine.workspace = workspace;
engine.ui = ui;
$("panel-close").addEventListener("click", () => ui.closePanels());

// --- startup: crash recovery, else a blank doc -------------------------------

async function start(): Promise<void> {
  await initI18n();
  applyDom(); // resolve the static [data-i18n] attributes in index.html
  engine.registerTool(historyTool); // registered after i18n so its button title is translated
  void SessionStore.requestPersistent();
  let last: DocSnapshot | undefined;
  try {
    last = await store.loadLatest();
  } catch (e) {
    console.error("recovery load failed", e);
  }
  if (last?.text) {
    session = { id: last.id } as Session;
    await mountDoc({
      text: last.text,
      filename: last.filename,
      encoding: last.encoding,
      uri: last.uri,
      formatId: last.formatId,
      recovered: true,
    });
  } else {
    await mountDoc({ text: "", filename: null, encoding: { label: "utf-8", bom: false } });
  }
}

void start();
