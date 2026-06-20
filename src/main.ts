import { OmnitextEngine } from "./core/engine";
import { decodeBytes, encodeText } from "./core/encoding";
import { SessionStore, type DocSnapshot } from "./core/session-store";
import { codemirrorEditor } from "./editors/codemirror";
import { csvFormat } from "./formats/csv/index";
import { jsonFormat } from "./formats/json";
import { markdownFormat } from "./formats/markdown";
import type { EditorInstance, FormatModule, TextEncoding } from "./core/types";

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

// --- engine + module registration -----------------------------------------

const engine = new OmnitextEngine({ fallbackEditorId: "codemirror" });
engine.registerEditor(codemirrorEditor);
const FORMATS: FormatModule[] = [jsonFormat, markdownFormat, csvFormat];
for (const f of FORMATS) engine.registerFormat(f);

const store = new SessionStore();

// --- session state ---------------------------------------------------------

interface Session {
  id: string;
  uri: string | null;
  filename: string | null;
  formatId: string | null;
  encoding: TextEncoding;
  editor: EditorInstance | null;
  fileHandle: FsHandle | null;
  lastSavedText: string;
  dirty: boolean;
}

let session: Session | null = null;
let autosaveTimer: ReturnType<typeof setTimeout> | undefined;

// --- DOM -------------------------------------------------------------------

const $ = <T extends HTMLElement>(id: string): T => {
  const el = document.getElementById(id);
  if (!el) throw new Error(`missing #${id}`);
  return el as T;
};
const editorEl = $("editor");
const filenameEl = $("filename");
const dirtyEl = $("dirty");
const reasonEl = $("reason");
const statusEl = $("status");
const formatSel = $<HTMLSelectElement>("format");
const fileInput = $<HTMLInputElement>("file-input");

function populateFormatSelect(current: string | null): void {
  formatSel.innerHTML = "";
  const auto = new Option("auto", "");
  formatSel.add(auto);
  for (const f of FORMATS) formatSel.add(new Option(f.manifest.id, f.manifest.id));
  formatSel.value = current ?? "";
}

function updateUI(): void {
  filenameEl.textContent = session?.filename ?? "untitled";
  dirtyEl.textContent = session?.dirty ? "(modified)" : "";
  formatSel.value = session?.formatId ?? "";
}

function setStatus(msg: string): void {
  statusEl.textContent = msg;
}

// --- core flows ------------------------------------------------------------

function mountDoc(
  text: string,
  opts: {
    filename: string | null;
    encoding: TextEncoding;
    uri?: string | null;
    fileHandle?: FsHandle | null;
    formatId?: string | null;
    recovered?: boolean;
  },
): void {
  session?.editor?.dispose();

  const sample = text.slice(0, 8192);
  let format: FormatModule | null = null;
  if (opts.formatId) {
    format = engine.formats.byId(opts.formatId) ?? null;
  } else {
    const filename = opts.filename ?? undefined;
    const detected = engine.detect(filename !== undefined ? { filename, sample } : { sample });
    format = detected?.format ?? null;
  }

  const resolution = engine.resolve(format);
  const instance = resolution.editor.create(engine.host("app"));

  session = {
    id: session?.id ?? crypto.randomUUID(),
    uri: opts.uri ?? null,
    filename: opts.filename,
    formatId: format?.manifest.id ?? null,
    encoding: opts.encoding,
    editor: instance,
    fileHandle: opts.fileHandle ?? null,
    lastSavedText: text,
    dirty: false,
  };

  editorEl.innerHTML = "";
  instance.mount(editorEl, {
    text,
    format,
    view: resolution.view,
    onChange: () => {
      if (!session) return;
      session.dirty = session.editor!.getText() !== session.lastSavedText;
      updateUI();
      scheduleAutosave();
    },
  });
  instance.focus();

  reasonEl.textContent = `${resolution.editor.manifest.id} (${resolution.reason})`;
  populateFormatSelect(session.formatId);
  updateUI();
  engine.events.emit("documentOpened", {
    sessionId: session.id,
    uri: session.uri,
    formatId: session.formatId,
  });
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

async function openFile(): Promise<void> {
  if (window.showOpenFilePicker) {
    try {
      const [handle] = await window.showOpenFilePicker();
      if (!handle) return;
      const file = await handle.getFile();
      const decoded = decodeBytes(await file.arrayBuffer());
      mountDoc(decoded.text, {
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
  mountDoc(decoded.text, {
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
  engine.events.emit("documentSaved", {
    sessionId: session.id,
    uri: session.uri ?? "download",
  });
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

function changeFormat(formatId: string): void {
  if (!session?.editor) return;
  const text = session.editor.getText(); // serialize-as-save-point (text is canonical)
  mountDoc(text, {
    filename: session.filename,
    encoding: session.encoding,
    uri: session.uri,
    fileHandle: session.fileHandle,
    formatId: formatId || null,
  });
}

// --- wire up ---------------------------------------------------------------

$("btn-new").addEventListener("click", () =>
  mountDoc("", { filename: null, encoding: { label: "utf-8", bom: false } }),
);
$("btn-open").addEventListener("click", () => void openFile());
$("btn-save").addEventListener("click", () => void saveFile());
formatSel.addEventListener("change", () => changeFormat(formatSel.value));

window.addEventListener("beforeunload", (e) => {
  if (session?.dirty) {
    e.preventDefault();
    e.returnValue = "";
  }
});

// --- startup: crash recovery, else a blank doc -----------------------------

async function start(): Promise<void> {
  void SessionStore.requestPersistent();
  let last: DocSnapshot | undefined;
  try {
    last = await store.loadLatest();
  } catch (e) {
    console.error("recovery load failed", e);
  }
  if (last && last.text) {
    session = { id: last.id } as Session;
    mountDoc(last.text, {
      filename: last.filename,
      encoding: last.encoding,
      uri: last.uri,
      formatId: last.formatId,
      recovered: true,
    });
  } else {
    mountDoc("", { filename: null, encoding: { label: "utf-8", bom: false } });
  }
}

void start();
