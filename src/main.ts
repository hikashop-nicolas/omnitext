import "./app.css";
import { gunzipSync } from "fflate";
import { detectArchiveKind, readArchive, writeArchive } from "./core/archive";
import { OmnitextEngine } from "./core/engine";
import { decodeBytes, encodeText } from "./core/encoding";
import { getOpenedFile, isNative, saveBytesNative } from "./core/platform";
import { SessionStore, type DocSnapshot } from "./core/session-store";
import { codemirrorEditor } from "./editors/codemirror";
import { milkdownEditor } from "./editors/milkdown";
import { docxEditor } from "./editors/docx";
import { odtEditor } from "./editors/odt";
import { pdfEditor } from "./editors/pdf";
import { rtfEditor } from "./editors/rtf";
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
import { rtfFormat } from "./formats/rtf";
import { xlsFormat } from "./formats/xls";
import { xlsxFormat } from "./formats/xlsx";
import { xmlFormat } from "./formats/xml";
import { yamlFormat } from "./formats/yaml";
import { imageEditor } from "./editors/image";
import { filerobotEditor } from "./editors/filerobot";
import { mediaEditor } from "./editors/media";
import { archiveEditor } from "./editors/archive";
import { binaryEditor } from "./editors/binary";
import { latexPreviewEditor } from "./editors/latexpreview";
import { svgEditor } from "./editors/svgeditor";
import { latexFormat } from "./formats/latex";
import { svgFormat } from "./formats/svg";
import { historyTool } from "./tools/history";
import { makeTextFormats, TEXT_FORMAT_TABLE } from "./formats/codemirror-formats";
import { blankTemplate, BLANK_BINARY_FORMATS, PAPER_FORMATS, type Paper } from "./formats/blank-templates";
import {
  GENERIC_ARCHIVE,
  GENERIC_BINARY,
  GENERIC_IMAGE,
  GENERIC_MEDIA,
  makeGenericViewerFormats,
  makeViewerFormats,
} from "./formats/binary-viewers";
import { applyDom, initI18n, t } from "./i18n";
import { getSettings, saveSettings } from "./settings";
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
engine.registerEditor(rtfEditor);
engine.registerEditor(odtEditor);
engine.registerEditor(docxEditor);
engine.registerEditor(sheetEditor);
engine.registerEditor(imageEditor);
engine.registerEditor(filerobotEditor);
engine.registerEditor(mediaEditor);
engine.registerEditor(archiveEditor);
engine.registerEditor(latexPreviewEditor);
engine.registerEditor(svgEditor);
engine.registerEditor(binaryEditor);
const FORMATS: FormatDescriptor[] = [
  jsonFormat,
  json5Format,
  markdownFormat,
  csvFormat,
  tsvFormat,
  xlsxFormat,
  xlsFormat,
  pdfFormat,
  rtfFormat,
  odtFormat,
  docxFormat,
  odsFormat,
  latexFormat,
  svgFormat,
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
// The long tail of text formats (highlighting via CodeMirror). Registered for opening
// existing files; the New dialog stays the curated FORMATS list above.
for (const f of makeTextFormats()) engine.registerFormat(f);
// Image / audio / video viewer formats (read-only), plus generic ones for MIME-class routing.
for (const f of makeViewerFormats()) engine.registerFormat(f);
for (const f of makeGenericViewerFormats()) engine.registerFormat(f);

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
  mime: string | null;
  readOnly: boolean;
  /** Set when this document is an entry opened from an archive: saving writes back into it. */
  archive?: ArchiveContext;
}

interface ArchiveContext {
  archiveBytes: Uint8Array; // the current archive (updated on each write-back); zip/tar/tgz
  path: string; // this entry's path inside the archive
  parentName: string; // the archive's filename (for saving)
  parentHandle: FsHandle | null; // the archive's file handle, for in-place save on the web
}

// Back navigation: opening an archive entry pushes the archive here so a back button returns.
interface NavSnapshot {
  binary: boolean;
  bytes?: Uint8Array;
  text?: string;
  filename: string | null;
  formatId: string | null;
  mime?: string;
  encoding: TextEncoding;
  fileHandle: FsHandle | null;
}
const navStack: NavSnapshot[] = [];
function updateBackBtn(): void {
  backBtn.hidden = navStack.length === 0;
}

let session: Session | null = null;
let autosaveTimer: ReturnType<typeof setTimeout> | undefined;

// Per-document editor cache: switching keeps the previous editor alive (hidden) instead
// of disposing it, so its undo history survives a "switch away and come back" (when the
// content has not changed since). Editing in another view recreates this one on return.
// All entries are disposed when a different document is opened.
interface LiveEditor {
  instance: EditorInstance;
  el: HTMLElement;
  text: string; // the content this editor currently reflects
}
const liveEditors = new Map<string, LiveEditor>();
function disposeLiveEditors(): void {
  for (const { instance } of liveEditors.values()) {
    try {
      instance.dispose();
    } catch {
      /* ignore */
    }
  }
  liveEditors.clear();
}

// --- DOM ---------------------------------------------------------------------

const $ = <T extends HTMLElement>(id: string): T => {
  const el = document.getElementById(id);
  if (!el) throw new Error(`missing #${id}`);
  return el as T;
};
const editorEl = $("editor");
const filenameEl = $("filename");
const dirtyEl = $("dirty");
const saveBtn = $("btn-save");
const backBtn = $<HTMLButtonElement>("btn-back");
const reasonEl = $("reason");
const statusTextEl = $("status-text");
const formatLabelEl = $("format-label");
const viewBtn = $<HTMLButtonElement>("view-btn");
const viewLabelEl = $("view-label");
const fileInput = $<HTMLInputElement>("file-input");
const toolsEl = $("tools");
const panelEl = $("panel");
const panelTitleEl = $("panel-title");
const panelBodyEl = $("panel-body");
const newDlgEl = $("newdlg");
const newFormatInput = $<HTMLInputElement>("new-format-input");
const newFormatList = $<HTMLUListElement>("new-format-list");
const newFormatOptsEl = $("new-format-opts");
const newPaperSel = $<HTMLSelectElement>("new-paper");
const newOrientSel = $<HTMLSelectElement>("new-orientation");
const newPaginatedChk = $<HTMLInputElement>("new-paginated");
const newDirectionSel = $<HTMLSelectElement>("new-direction");

// Format is a read-only label for the active document: it is determined by the file's
// content/extension on open, or chosen up front in the New dialog. Switching the format
// of an open document is meaningless for binary files (xlsx/pdf/docx/odt) and would
// discard their bytes, so it is not offered inline.
function setFormatLabel(current: string | null): void {
  formatLabelEl.textContent = current ?? t("app.plainText");
}

// The View switcher: an eye button (bottom-right). One view -> hidden; two -> a click
// toggles directly; three+ -> a click opens a popover. Current choices are kept here.
let viewChoices: EditorResolution[] = [];
function populateEditorSelect(choices: EditorResolution[], currentId: string): void {
  viewChoices = choices;
  viewBtn.hidden = choices.length <= 1; // nothing to switch to
  viewLabelEl.textContent = editorLabel(currentId);
}

function updateUI(): void {
  filenameEl.textContent = session?.filename ?? t("app.untitled");
  // Read-only surfaces (Preview, viewers) cannot save: hide Save and the dirty dot.
  const readOnly = !!session?.readOnly;
  saveBtn.hidden = readOnly;
  dirtyEl.hidden = readOnly;
  const modified = !!session?.dirty;
  dirtyEl.classList.toggle("is-modified", modified);
  dirtyEl.title = modified ? t("app.unsavedChanges") : t("app.allSaved");
  setFormatLabel(session?.formatId ?? null);
  if (session?.editorId) viewLabelEl.textContent = editorLabel(session.editorId);
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
  mime?: string | null;
  recovered?: boolean;
  /** A view switch within the same document (keeps other editors alive for undo). */
  isSwitch?: boolean;
  /** Per-document editor options chosen at creation (e.g. richdoc pagination). */
  docOptions?: { paginated?: boolean };
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
  const targetId = chosen.editor.manifest.id;
  const isSwitch = !!opts.isSwitch;
  if (!isSwitch) {
    // New document (open / create / restore): drop every cached editor and start clean.
    disposeLiveEditors();
    editorEl.innerHTML = "";
  } else if (session?.editorId) {
    // View switch: record what the outgoing editor now holds, then hide (keep alive).
    const cur = liveEditors.get(session.editorId);
    if (cur) {
      cur.text = text;
      cur.el.style.display = "none";
    }
  }

  // Reuse a cached editor only when its content still matches (so its undo survives);
  // otherwise build a fresh one.
  const cached = isSwitch && !binary ? liveEditors.get(targetId) : undefined;
  const reuse = !!cached && cached.text === text;
  let instance: EditorInstance;
  let mountEl: HTMLElement | null = null;
  if (cached && reuse) {
    instance = cached.instance;
    cached.el.style.display = "";
  } else {
    if (cached) {
      try {
        cached.instance.dispose();
      } catch {
        /* ignore */
      }
      cached.el.remove();
      liveEditors.delete(targetId);
    }
    mountEl = document.createElement("div");
    mountEl.style.height = "100%";
    editorEl.appendChild(mountEl);
    instance = editorModule.create(engine.host("app"));
  }

  session = {
    id: session?.id ?? crypto.randomUUID(),
    uri: opts.uri ?? null,
    filename: opts.filename,
    formatId,
    encoding: opts.encoding,
    editor: instance,
    editorId: targetId,
    fileHandle: opts.fileHandle ?? null,
    lastSavedText: binary ? "" : text,
    dirty: false,
    binary,
    mime: opts.mime ?? descriptor?.manifest.mimeTypes?.[0] ?? null,
    readOnly: !!chosen.editor.manifest.readOnly,
  };

  if (mountEl) {
    liveEditors.set(targetId, { instance, el: mountEl, text });
    instance.mount(mountEl, {
      text,
      bytes,
      binary,
      mime: opts.mime ?? descriptor?.manifest.mimeTypes?.[0],
      model,
      format: formatModule,
      view: chosen.view,
      docOptions: opts.docOptions,
      onChange: () => {
        if (!session) return;
        session.dirty = session.binary
          ? true
          : session.editor!.getText() !== session.lastSavedText;
        // Keep the active editor's cache entry current so a later switch-and-return reuses it.
        const live = liveEditors.get(session.editorId!);
        if (live && !session.binary) live.text = session.editor!.getText();
        updateUI();
        if (!session.binary) scheduleAutosave();
        engine.events.emit("contentChanged", { sessionId: session.id });
      },
    });
  }
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

async function openBuffer(
  buffer: ArrayBuffer,
  filename: string,
  scheme: string,
  handle: FsHandle | null,
  mime?: string,
): Promise<void> {
  // Opening a fresh file (anything but drilling into an archive entry) is a new nav root.
  if (scheme !== "archive") {
    navStack.length = 0;
    updateBackBtn();
  }
  const lower = filename.toLowerCase();
  // tar family (incl. gzip-wrapped) -> the archive viewer. Checked by full name because
  // .tar.gz's trailing extension is .gz.
  if (lower.endsWith(".tar") || lower.endsWith(".tgz") || lower.endsWith(".tar.gz")) {
    await mountDoc({
      bytes: new Uint8Array(buffer),
      binary: true,
      formatId: "tar",
      filename,
      encoding: { label: "binary", bom: false },
      uri: `${scheme}://${filename}`,
      fileHandle: handle,
      mime,
    });
    return;
  }
  // A single gzip-compressed file (foo.json.gz): transparently decompress and open the inner
  // file, so it lands in the right editor.
  if (lower.endsWith(".gz")) {
    try {
      const inner = gunzipSync(new Uint8Array(buffer));
      const innerBuf = inner.buffer.slice(inner.byteOffset, inner.byteOffset + inner.byteLength) as ArrayBuffer;
      await openBuffer(innerBuf, filename.slice(0, -3), scheme, null);
      return;
    } catch (e) {
      console.error("gunzip failed", e);
    }
  }
  // A registered binary format by extension (image/media/office/pdf) wins.
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
      mime,
    });
    return;
  }
  // No extension match, but the OS told us the type: route by MIME class.
  // SVG is excluded: it is editable XML handled by the svg (vector + source) format.
  const cls = mime?.split("/")[0];
  const isZip = mime === "application/zip" || mime === "application/java-archive";
  const generic =
    mime === "image/svg+xml"
      ? null
      : isZip
        ? GENERIC_ARCHIVE
        : cls === "image"
          ? GENERIC_IMAGE
          : cls === "video" || cls === "audio"
            ? GENERIC_MEDIA
            : null;
  if (generic) {
    await mountDoc({
      bytes: new Uint8Array(buffer),
      binary: true,
      formatId: generic,
      filename,
      encoding: { label: "binary", bom: false },
      uri: `${scheme}://${filename}`,
      fileHandle: handle,
      mime,
    });
    return;
  }
  // Unknown type and the content looks binary (NUL / many control bytes): show the hex
  // fallback rather than decoding it into garbage text.
  if (looksBinary(buffer)) {
    await mountDoc({
      bytes: new Uint8Array(buffer),
      binary: true,
      formatId: GENERIC_BINARY,
      filename,
      encoding: { label: "binary", bom: false },
      uri: `${scheme}://${filename}`,
      fileHandle: handle,
      mime,
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

// Heuristic: a NUL byte, or >10% non-text control bytes in the first 8KB, means binary.
function looksBinary(buffer: ArrayBuffer): boolean {
  const bytes = new Uint8Array(buffer, 0, Math.min(buffer.byteLength, 8192));
  if (bytes.length === 0) return false;
  let control = 0;
  for (const b of bytes) {
    if (b === 0) return true;
    // Allow tab (9), LF (10), CR (13); count other low control chars.
    if ((b < 9 || (b > 13 && b < 32)) && b !== 27) control++;
  }
  return control / bytes.length > 0.1;
}

async function openFile(): Promise<void> {
  if (window.showOpenFilePicker) {
    try {
      const [handle] = await window.showOpenFilePicker();
      if (!handle) return;
      const file = await handle.getFile();
      await openBuffer(await file.arrayBuffer(), file.name, "fs", handle, file.type);
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
  await openBuffer(await file.arrayBuffer(), file.name, "upload", null, file.type);
  fileInput.value = "";
});

// Drag-and-drop: dropping a file anywhere on the window opens it (the Open button remains the
// keyboard path). Only file drags are intercepted, so dragging text within an editor is
// unaffected. A depth counter tracks enter/leave across nested elements.
const dropzoneEl = $("dropzone");
let dragDepth = 0;
const isFileDrag = (e: DragEvent): boolean => !!e.dataTransfer && Array.from(e.dataTransfer.types).includes("Files");
window.addEventListener("dragenter", (e) => {
  if (!isFileDrag(e)) return;
  e.preventDefault();
  dragDepth++;
  dropzoneEl.classList.add("show");
});
window.addEventListener("dragover", (e) => {
  if (!isFileDrag(e)) return;
  e.preventDefault();
  if (e.dataTransfer) e.dataTransfer.dropEffect = "copy";
});
window.addEventListener("dragleave", (e) => {
  if (!isFileDrag(e)) return;
  dragDepth = Math.max(0, dragDepth - 1);
  if (dragDepth === 0) dropzoneEl.classList.remove("show");
});
window.addEventListener("drop", async (e) => {
  if (!isFileDrag(e)) return;
  e.preventDefault();
  dragDepth = 0;
  dropzoneEl.classList.remove("show");
  const file = e.dataTransfer?.files?.[0];
  if (!file) return;
  await openBuffer(await file.arrayBuffer(), file.name, "upload", null, file.type);
});

async function saveFile(): Promise<void> {
  if (!session?.editor) return;
  if (session.archive) {
    await saveIntoArchive(session.archive);
    return;
  }

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

// Saving an archive entry rebuilds the archive with the edited entry and writes the whole
// archive back (in place via the handle on the web, else share/download).
async function saveIntoArchive(a: ArchiveContext): Promise<void> {
  if (!session?.editor) return;
  const entryBytes = session.binary
    ? ((await session.editor.getBytes?.()) ?? new Uint8Array())
    : encodeText(session.editor.getText(), session.encoding);
  let newArchive: Uint8Array;
  try {
    const kind = detectArchiveKind(a.archiveBytes);
    const entries = readArchive(a.archiveBytes);
    const idx = entries.findIndex((e) => e.name === a.path);
    if (idx >= 0) entries[idx]!.data = new Uint8Array(entryBytes);
    else entries.push({ name: a.path, data: new Uint8Array(entryBytes) });
    newArchive = writeArchive(kind, entries);
  } catch (e) {
    console.error("re-pack archive failed", e);
    engine.notificationSink.error(t("notify.saveFailed"));
    return;
  }
  try {
    if (isNative()) {
      await saveBytesNative(newArchive, a.parentName);
    } else if (a.parentHandle?.createWritable) {
      const w = await a.parentHandle.createWritable();
      await w.write(newArchive);
      await w.close();
    } else {
      downloadBytes(newArchive, a.parentName);
    }
  } catch (e) {
    console.error("archive save failed", e);
    engine.notificationSink.error(t("notify.saveFailed"));
    return;
  }
  // Keep the in-memory archive + the back-target current so a later edit or "back" sees it.
  a.archiveBytes = newArchive;
  const top = navStack[navStack.length - 1];
  if (top?.binary) top.bytes = newArchive;
  if (!session.binary) session.lastSavedText = session.editor.getText();
  session.dirty = false;
  updateUI();
  setStatus(t("status.savedToArchive", { name: a.parentName }));
}

// Return to the archive (or other document) the current entry was opened from.
async function goBack(): Promise<void> {
  const snap = navStack.pop();
  updateBackBtn();
  if (!snap) return;
  await mountDoc(
    snap.binary
      ? {
          bytes: snap.bytes ?? new Uint8Array(),
          binary: true,
          formatId: snap.formatId,
          filename: snap.filename,
          encoding: snap.encoding,
          mime: snap.mime,
          fileHandle: snap.fileHandle,
          uri: snap.filename ? `back://${snap.filename}` : null,
        }
      : {
          text: snap.text ?? "",
          filename: snap.filename,
          formatId: snap.formatId,
          encoding: snap.encoding,
          fileHandle: snap.fileHandle,
          uri: snap.filename ? `back://${snap.filename}` : null,
        },
  );
}

// --- new document (format chosen up front) -----------------------------------

// All formats that can be created blank: the curated text/data formats plus the long tail
// of CodeMirror text formats. Binary formats need real file bytes, so they are excluded.
interface NewFormatOption {
  id: string | null;
  label: string;
  ext: string;
  search: string;
}
function buildNewFormatOptions(): NewFormatOption[] {
  const opts: NewFormatOption[] = [{ id: null, label: t("app.plainTextOption"), ext: ".txt", search: "plain text txt" }];
  const seen = new Set<string>();
  const add = (id: string, exts: readonly string[]): void => {
    if (seen.has(id)) return;
    seen.add(id);
    opts.push({ id, label: id, ext: exts.join(" "), search: `${id} ${exts.join(" ")}`.toLowerCase() });
  };
  const creatableBinary = BLANK_BINARY_FORMATS as readonly string[];
  for (const f of FORMATS) {
    if (f.manifest.binary && !creatableBinary.includes(f.manifest.id)) continue; // binary needs a blank template
    add(f.manifest.id, f.manifest.extensions ?? []);
  }
  for (const f of TEXT_FORMAT_TABLE) add(f.id, f.exts);
  const [plain, ...rest] = opts;
  rest.sort((a, b) => a.label.localeCompare(b.label));
  return [plain!, ...rest];
}

let newFormatOpts: NewFormatOption[] = [];
let newFormatSelectedId: string | null = null;
let newFormatActive = -1; // highlighted index in the rendered list

function renderNewFormatList(query: string): void {
  const q = query.trim().toLowerCase();
  const matches = q ? newFormatOpts.filter((o) => o.search.includes(q)) : newFormatOpts;
  newFormatList.innerHTML = "";
  if (!matches.length) {
    const li = document.createElement("li");
    li.className = "combobox-empty";
    li.textContent = t("app.noMatches");
    newFormatList.appendChild(li);
  } else {
    matches.forEach((o, i) => {
      const li = document.createElement("li");
      li.setAttribute("role", "option");
      li.dataset.id = o.id ?? "";
      li.dataset.idx = String(i);
      li.innerHTML = `${escapeText(o.label)}${o.ext ? `<span class="opt-ext">${escapeText(o.ext)}</span>` : ""}`;
      li.addEventListener("mousedown", (e) => {
        e.preventDefault(); // keep focus in the input
        pickNewFormat(o);
      });
      newFormatList.appendChild(li);
    });
  }
  newFormatActive = matches.length ? 0 : -1;
  highlightNewFormat();
  newFormatList.hidden = false;
  newFormatInput.setAttribute("aria-expanded", "true");
}
function highlightNewFormat(): void {
  Array.from(newFormatList.children).forEach((li, i) => li.classList.toggle("active", i === newFormatActive));
  if (newFormatActive >= 0) (newFormatList.children[newFormatActive] as HTMLElement | undefined)?.scrollIntoView({ block: "nearest" });
}
function activeOption(): NewFormatOption | null {
  const q = newFormatInput.value.trim().toLowerCase();
  const matches = q ? newFormatOpts.filter((o) => o.search.includes(q)) : newFormatOpts;
  return newFormatActive >= 0 ? matches[newFormatActive] ?? null : null;
}
function pickNewFormat(o: NewFormatOption): void {
  newFormatSelectedId = o.id;
  newFormatInput.value = o.id ? `${o.label}${o.ext ? " " + o.ext.split(" ")[0] : ""}` : o.label;
  newFormatList.hidden = true;
  newFormatInput.setAttribute("aria-expanded", "false");
  updateNewFormatOpts();
}
// Show the page-size / pagination options only for formats that have a page (docx/odt).
function updateNewFormatOpts(): void {
  const id = newFormatSelectedId ?? "";
  newFormatOptsEl.hidden = !(PAPER_FORMATS as readonly string[]).includes(id);
}
const escapeText = (s: string): string => s.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");

// Modal focus management: remember what had focus, trap Tab inside the card, restore on close.
let modalReturnFocus: HTMLElement | null = null;
function trapModalTab(card: HTMLElement, e: KeyboardEvent): void {
  if (e.key !== "Tab") return;
  const f = [...card.querySelectorAll<HTMLElement>('button:not([disabled]),input:not([disabled]),select:not([disabled]),textarea:not([disabled]),a[href],[tabindex]:not([tabindex="-1"])')].filter((el) => el.offsetParent !== null);
  if (!f.length) return;
  const first = f[0]!;
  const last = f[f.length - 1]!;
  const a = document.activeElement;
  if (e.shiftKey && (a === first || !card.contains(a))) { e.preventDefault(); last.focus(); }
  else if (!e.shiftKey && a === last) { e.preventDefault(); first.focus(); }
}

function openNewDialog(): void {
  modalReturnFocus = document.activeElement as HTMLElement | null;
  newFormatOpts = buildNewFormatOptions();
  newFormatSelectedId = null;
  newFormatInput.value = "";
  newFormatInput.placeholder = t("app.formatSearch");
  newFormatList.hidden = true;
  // seed the per-document options from the global defaults
  const s = getSettings();
  newPaperSel.value = s.pageSize;
  newOrientSel.value = "portrait";
  newPaginatedChk.checked = s.paginated;
  newDirectionSel.value = "ltr";
  newFormatOptsEl.hidden = true;
  newDlgEl.hidden = false;
  newFormatInput.focus();
  renderNewFormatList("");
}

function closeNewDialog(): void {
  newDlgEl.hidden = true;
  newFormatList.hidden = true;
  modalReturnFocus?.focus();
  modalReturnFocus = null;
}

async function createNewDocument(): Promise<void> {
  // If the user typed but did not click an option, take the highlighted match.
  const picked = activeOption();
  const formatId = newFormatSelectedId ?? picked?.id ?? null;
  const descriptor = formatId ? engine.formats.byId(formatId) : null;
  const paper = (newPaperSel.value || "a4") as Paper;
  const orient = newOrientSel.value === "landscape" ? "landscape" : "portrait";
  const paginated = newPaginatedChk.checked;
  const direction = (newDirectionSel.value || "ltr") as "ltr" | "rtl" | "vertical";
  closeNewDialog();
  navStack.length = 0; // a new document is a fresh nav root
  updateBackBtn();

  // Binary formats (docx/odt/sheets/pdf) need a real blank file, opened in their editor.
  if (descriptor?.manifest.binary && formatId) {
    const bytes = await blankTemplate(formatId, paper, orient, direction);
    if (!bytes) {
      engine.notificationSink.error(t("notify.formatLoadFailed", { format: formatId }));
      return;
    }
    void mountDoc({
      binary: true,
      bytes,
      filename: null,
      encoding: { label: "utf-8", bom: false },
      formatId,
      editorId: descriptor.manifest.defaultEditor ?? null,
      docOptions: { paginated },
    });
    return;
  }

  // Text formats start blank in the text editor; the View switcher offers richer surfaces.
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
  // hook lets future tools veto or warn on a lossy hand-off. Binary formats have no text,
  // so carry the current bytes across the switch (e.g. image viewer -> image editor);
  // otherwise the new editor receives no image and fails to load.
  const text = session.editor.getText();
  const switchBytes = session.binary ? ((await session.editor.getBytes?.()) ?? null) : null;
  const prevSaved = session.lastSavedText; // keep the on-disk baseline across the switch
  const prevArchive = session.archive; // keep the archive write-back context across the switch
  const ctx = await engine.events.runHook("willChangeEditor", {
    sessionId: session.id,
    toEditor: editorId,
    cancel: false,
  });
  if (ctx.cancel) return;
  if (session.formatId) {
    prefs[session.formatId] = editorId;
    savePrefs();
  }
  await mountDoc({
    text,
    bytes: switchBytes,
    binary: session.binary,
    mime: session.mime,
    filename: session.filename,
    encoding: session.encoding,
    uri: session.uri,
    fileHandle: session.fileHandle,
    formatId: session.formatId,
    editorId,
    isSwitch: true,
  });
  if (!session) return;
  session.archive = prevArchive;
  // A view switch carries the current content over, but must not pretend it is saved:
  // restore the on-disk baseline and recompute dirty against it.
  if (session.editor && !session.binary) {
    session.lastSavedText = prevSaved;
    session.dirty = session.editor.getText() !== prevSaved;
  }
  updateUI();
}

// --- wire up -----------------------------------------------------------------

// Surface notifications visibly (they previously only reached the console) in an assertive
// aria-live region so errors are seen and announced by screen readers.
const toastEl = $("toast");
let toastTimer: ReturnType<typeof setTimeout> | undefined;
function showToast(msg: string, kind: "info" | "warn" | "error"): void {
  toastEl.textContent = msg;
  toastEl.className = `toast show ${kind}`;
  clearTimeout(toastTimer);
  toastTimer = setTimeout(() => {
    toastEl.className = "toast";
    toastEl.textContent = "";
  }, 5000);
}
engine.notificationSink = {
  info: (m) => { console.info("[omnitext]", m); showToast(m, "info"); },
  warn: (m) => { console.warn("[omnitext]", m); showToast(m, "warn"); },
  error: (m) => { console.error("[omnitext]", m); showToast(m, "error"); },
};

// Global editor shortcuts. Cmd/Ctrl+S saves and Cmd/Ctrl+O opens, overriding the browser's
// "save page"/"open file" so the app owns them (pdfedit/richdoc leave save to the host).
document.addEventListener("keydown", (e) => {
  if (!(e.metaKey || e.ctrlKey) || e.altKey || e.shiftKey) return;
  const k = e.key.toLowerCase();
  if (k === "s") { e.preventDefault(); void saveFile(); }
  else if (k === "o") { e.preventDefault(); void openFile(); }
});

$("btn-new").addEventListener("click", openNewDialog);
$("btn-open").addEventListener("click", () => void openFile());
$("btn-save").addEventListener("click", () => void saveFile());
backBtn.addEventListener("click", () => void goBack());
$("new-cancel").addEventListener("click", closeNewDialog);
$("new-create").addEventListener("click", () => void createNewDocument());
newDlgEl.addEventListener("click", (e) => {
  if (e.target === newDlgEl) closeNewDialog(); // click the backdrop to dismiss
});
newDlgEl.addEventListener("keydown", (e) => trapModalTab(newDlgEl.querySelector(".modal-card") as HTMLElement, e));
newFormatInput.addEventListener("input", () => {
  newFormatSelectedId = null; // typing invalidates a prior pick
  updateNewFormatOpts();
  renderNewFormatList(newFormatInput.value);
});
newFormatInput.addEventListener("focus", () => renderNewFormatList(newFormatInput.value));
newFormatInput.addEventListener("keydown", (e) => {
  const count = newFormatList.children.length;
  if (e.key === "ArrowDown") {
    e.preventDefault();
    if (newFormatList.hidden) renderNewFormatList(newFormatInput.value);
    else if (count) { newFormatActive = (newFormatActive + 1) % count; highlightNewFormat(); }
  } else if (e.key === "ArrowUp") {
    e.preventDefault();
    if (count) { newFormatActive = (newFormatActive - 1 + count) % count; highlightNewFormat(); }
  } else if (e.key === "Enter") {
    e.preventDefault();
    const opt = activeOption();
    if (opt && !newFormatList.hidden) pickNewFormat(opt);
    void createNewDocument();
  } else if (e.key === "Escape") {
    if (!newFormatList.hidden) { newFormatList.hidden = true; e.stopPropagation(); }
  }
});
document.addEventListener("keydown", (e) => {
  if (e.key === "Escape" && !newDlgEl.hidden) closeNewDialog();
});

// --- settings dialog ---------------------------------------------------------
const settingsDlgEl = $("settingsdlg");
const settingNameEl = $("setting-name") as HTMLInputElement;
const settingPageSizeEl = $("setting-pagesize") as HTMLSelectElement;
const settingPaginatedEl = $("setting-paginated") as HTMLInputElement;
function openSettings(): void {
  modalReturnFocus = document.activeElement as HTMLElement | null;
  const s = getSettings();
  settingNameEl.value = s.name;
  settingPageSizeEl.value = s.pageSize;
  settingPaginatedEl.checked = s.paginated;
  settingsDlgEl.hidden = false;
  settingNameEl.focus();
}
function closeSettings(): void {
  settingsDlgEl.hidden = true;
  modalReturnFocus?.focus();
  modalReturnFocus = null;
}
function saveSettingsDialog(): void {
  saveSettings({
    name: settingNameEl.value.trim(),
    pageSize: settingPageSizeEl.value === "letter" ? "letter" : "a4",
    paginated: settingPaginatedEl.checked,
  });
  closeSettings();
}
$("btn-settings").addEventListener("click", openSettings);
$("settings-cancel").addEventListener("click", closeSettings);
$("settings-save").addEventListener("click", saveSettingsDialog);
settingsDlgEl.addEventListener("click", (e) => {
  if (e.target === settingsDlgEl) closeSettings();
});
settingsDlgEl.addEventListener("keydown", (e) => trapModalTab(settingsDlgEl.querySelector(".modal-card") as HTMLElement, e));
settingNameEl.addEventListener("keydown", (e) => {
  if (e.key === "Enter") saveSettingsDialog();
});
document.addEventListener("keydown", (e) => {
  if (e.key === "Escape" && !settingsDlgEl.hidden) closeSettings();
});
// View switcher: with two views a click toggles to the other directly; with three or more
// it opens a small popover. (One view hides the button entirely.)
let viewPop: HTMLElement | null = null;
function closeViewPop(returnFocus = false): void {
  viewPop?.remove();
  viewPop = null;
  viewBtn.setAttribute("aria-expanded", "false");
  document.removeEventListener("pointerdown", onViewOutside, true);
  if (returnFocus) viewBtn.focus();
}
function onViewOutside(e: Event): void {
  const t2 = e.target as Node;
  if (viewPop && !viewPop.contains(t2) && !viewBtn.contains(t2)) closeViewPop();
}
function openViewPopover(): void {
  if (viewPop) {
    closeViewPop(true);
    return;
  }
  const pop = document.createElement("div");
  pop.className = "view-pop";
  pop.setAttribute("role", "menu");
  for (const c of viewChoices) {
    const id = c.editor.manifest.id;
    const b = document.createElement("button");
    b.type = "button";
    b.setAttribute("role", "menuitem");
    b.textContent = editorLabel(id);
    if (id === session?.editorId) {
      b.className = "is-current";
      b.setAttribute("aria-current", "true");
    }
    b.addEventListener("click", () => {
      closeViewPop(true);
      void changeEditor(id);
    });
    pop.appendChild(b);
  }
  // Keyboard: arrows move between items, Home/End jump, Escape closes and returns focus.
  pop.addEventListener("keydown", (e) => {
    const items = [...pop.querySelectorAll<HTMLElement>("button")];
    const i = items.indexOf(document.activeElement as HTMLElement);
    if (e.key === "ArrowDown") { e.preventDefault(); items[(i + 1) % items.length]?.focus(); }
    else if (e.key === "ArrowUp") { e.preventDefault(); items[(i - 1 + items.length) % items.length]?.focus(); }
    else if (e.key === "Home") { e.preventDefault(); items[0]?.focus(); }
    else if (e.key === "End") { e.preventDefault(); items[items.length - 1]?.focus(); }
    else if (e.key === "Escape") { e.preventDefault(); closeViewPop(true); }
  });
  document.body.appendChild(pop);
  viewPop = pop;
  viewBtn.setAttribute("aria-expanded", "true");
  const r = viewBtn.getBoundingClientRect();
  pop.style.left = `${Math.round(Math.min(r.left, window.innerWidth - pop.offsetWidth - 8))}px`;
  pop.style.top = `${Math.round(r.top - pop.offsetHeight - 6)}px`; // above the button
  (pop.querySelector<HTMLElement>("button.is-current") ?? pop.querySelector<HTMLElement>("button"))?.focus();
  setTimeout(() => document.addEventListener("pointerdown", onViewOutside, true), 0);
}
viewBtn.addEventListener("click", () => {
  if (viewChoices.length <= 1) return;
  if (viewChoices.length === 2) {
    const other = viewChoices.find((c) => c.editor.manifest.id !== session?.editorId);
    if (other) void changeEditor(other.editor.manifest.id);
  } else {
    openViewPopover();
  }
});

// Show the save-state dot's meaning as a brief tooltip: on tap (touch has no hover) and on
// keyboard focus (no hover either), so keyboard users get the same hint.
let dirtyTip: HTMLElement | null = null;
let dirtyTipTimer: ReturnType<typeof setTimeout> | undefined;
const showDirtyTip = () => {
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
};
const hideDirtyTip = () => {
  clearTimeout(dirtyTipTimer);
  if (dirtyTip) dirtyTip.hidden = true;
};
dirtyEl.addEventListener("click", showDirtyTip);
dirtyEl.addEventListener("focus", showDirtyTip);
dirtyEl.addEventListener("blur", hideDirtyTip);

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
  openFile(name, bytes, mime, archivePath) {
    // Open an in-memory file. When it's an archive entry, remember the parent archive so
    // saving writes back into it and the back button returns to it.
    const buf = bytes.buffer.slice(bytes.byteOffset, bytes.byteOffset + bytes.byteLength) as ArrayBuffer;
    void (async () => {
      let archive: ArchiveContext | undefined;
      if (archivePath && session?.editor && session.binary) {
        const archiveBytes = (await session.editor.getBytes?.()) ?? new Uint8Array();
        archive = {
          archiveBytes,
          path: archivePath,
          parentName: session.filename ?? "archive",
          parentHandle: session.fileHandle,
        };
        navStack.push({
          binary: true,
          bytes: archiveBytes,
          filename: session.filename,
          formatId: session.formatId,
          encoding: session.encoding,
          fileHandle: session.fileHandle,
        });
        updateBackBtn();
      }
      await openBuffer(buf, name, "archive", null, mime);
      if (archive && session) session.archive = archive;
    })();
  },
  exportFile(name, bytes) {
    // Save/share an in-memory file (e.g. extract one archive entry).
    if (isNative()) void saveBytesNative(bytes, name);
    else downloadBytes(bytes, name);
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
document.addEventListener("keydown", (e) => {
  if (e.key === "Escape" && !panelEl.hidden) ui.closePanels();
});

// --- startup: an "Open with" file, else crash recovery, else a blank doc ------

// Open a file handed to us via the OS "Open with"; returns true if one was pending.
let startupDone = false;
async function maybeOpenPendingFile(): Promise<boolean> {
  const file = await getOpenedFile();
  if (!file) return false;
  const buf = file.bytes.buffer.slice(
    file.bytes.byteOffset,
    file.bytes.byteOffset + file.bytes.byteLength,
  ) as ArrayBuffer;
  await openBuffer(buf, file.name, "intent", null, file.mime);
  return true;
}

async function start(): Promise<void> {
  await initI18n();
  applyDom(); // resolve the static [data-i18n] attributes in index.html
  engine.registerTool(historyTool); // registered after i18n so its button title is translated
  void SessionStore.requestPersistent();

  // A file opened while the app is already running arrives on the next resume; pull it then.
  document.addEventListener("visibilitychange", () => {
    if (startupDone && document.visibilityState === "visible") void maybeOpenPendingFile();
  });

  // A file the app was launched with via "Open with" wins over crash recovery.
  if (await maybeOpenPendingFile()) {
    startupDone = true;
    return;
  }

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
  startupDone = true;
}

void start();
