// "Read sheet music" from a picture: a small network distilled from oemer's, and oemer's classifiers (Hugging Face,
// fetched and cached by localml behind the AI download consent), run by scoredit's scan reader,
// and the result opened as a new score. A draft to correct: it says so when it opens.
import { fetchModelFiles, ModelFilesDeclined } from "localml/files";
import { t } from "../i18n";
import type { HostAPI } from "../core/types";

/** The Hugging Face repository holding the scan models (see scoredit's README). */
export const SCAN_MODELS_REPO = "hikashop-nicolas/scoredit-scan";
const SYMBOLS = { name: "scoredit-symbols-small-int8.onnx", bytes: 1_813_217 };
const CLASSIFIERS = { name: "oemer-classifiers.json", bytes: 5_850_300 };
const ENGINE_HOST = "cdn.jsdelivr.net";

let running: AbortController | null = null;

/** Reads the picture as sheet music and opens the score; one at a time. */
export async function readSheetMusic(host: HostAPI, bytes: Uint8Array, mime: string | undefined, filename: string | undefined): Promise<void> {
  if (running) return;
  const abort = (running = new AbortController());
  const pill = progressPill(() => abort.abort());
  const base = (filename ?? "scan").replace(/\.[^.]*$/, "");
  try {
    pill(t("scan.preparing"));
    const xml = await read(bytes, mime, base, abort.signal, pill);
    if (xml === null) return;
    host.workspace.openFile?.(`${base}.musicxml`, new TextEncoder().encode(xml), "application/vnd.recordare.musicxml+xml");
    host.notifications.info(t("scan.draft"));
  } catch (e) {
    if (e instanceof ModelFilesDeclined || abort.signal.aborted) return;
    console.error("sheet music not read", e);
    host.notifications.error(t("scan.failed", { message: e instanceof Error ? e.message : String(e) }));
  } finally {
    pill(null);
    running = null;
  }
}

/** One reading: the small symbol network on the CPU, in a worker, one window per band of staffs. */
async function read(bytes: Uint8Array, mime: string | undefined, base: string, signal: AbortSignal, pill: (s: string | null) => void): Promise<string | null> {
  const files = await fetchModelFiles({
    feature: "scan",
    label: "oemer",
    repo: SCAN_MODELS_REPO,
    files: [SYMBOLS, CLASSIFIERS],
    alsoFrom: [ENGINE_HOST],
    signal,
    onProgress: (loaded, total) => pill(t("scan.downloading", { percent: String(Math.round((loaded / Math.max(1, total)) * 100)) })),
  });
  const { scanToMusicXml, scanEngineVersion } = await import("scoredit");
  const engine = await scanEngineVersion();
  const result = await scanToMusicXml(new Blob([bytes as BlobPart], { type: mime ?? "image/png" }), {
    models: { symbols: files.get(SYMBOLS.name)!, classifiers: files.get(CLASSIFIERS.name)! },
    // The dev server pre-bundles scoredit, which breaks its worker's URL: in the page there.
    worker: import.meta.env.DEV ? undefined : true,
    threads: 1,
    tiles: "strips",
    wasmPaths: `https://${ENGINE_HOST}/npm/onnxruntime-web@${engine}/dist/`,
    title: base,
    signal,
    progress: (p) => pill(p.total > 1 ? t("scan.reading", { done: String(p.done), total: String(p.total) }) : t("scan.finishing")),
  });
  return signal.aborted ? null : result.xml;
}

/** A status pill with the progress; clicking it stops the reading. Null removes it. */
function progressPill(onCancel: () => void): (text: string | null) => void {
  let el: HTMLElement | null = null;
  return (text) => {
    if (text === null) {
      el?.remove();
      el = null;
      return;
    }
    if (!el) {
      el = document.createElement("button");
      el.className = "ot-export-progress";
      el.setAttribute("role", "status");
      el.title = t("scan.cancel");
      el.addEventListener("click", onCancel);
      document.body.append(el);
    }
    el.textContent = text;
  };
}
