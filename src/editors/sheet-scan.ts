// "Read sheet music" from a picture: oemer's symbol network and classifiers (Hugging Face,
// fetched and cached by localml behind the AI download consent), run by scoredit's scan reader,
// and the result opened as a new score. A draft to correct: it says so when it opens.
import { fetchModelFiles, ModelFilesDeclined } from "localml/files";
import { t } from "../i18n";
import type { HostAPI } from "../core/types";

/** The Hugging Face repository holding the scan models (see scoredit's README). */
export const SCAN_MODELS_REPO = "hikashop-nicolas/scoredit-scan";
const FULL = { name: "oemer-symbols.onnx", bytes: 38_448_467 };
const SMALL = { name: "oemer-symbols-int8.onnx", bytes: 10_348_373 };
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
    // WebGPU runs the full network fast; a GPU that stalls (some phone drivers lose the device)
    // is abandoned for the CPU path, and remembered so the next reading starts there.
    let xml: string | null = null;
    if ((await hasWebGpu()) && !gpuFailedBefore()) {
      xml = await attempt(true, bytes, mime, base, abort.signal, pill);
      if (xml === null && !abort.signal.aborted) rememberGpuFailed();
    }
    if (xml === null && !abort.signal.aborted) xml = await attempt(false, bytes, mime, base, abort.signal, pill);
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

const GPU_STALL_MS = 45_000;
const GPU_FAILED_KEY = "omnitext:scan-gpu-failed";

/**
 * One reading: on the GPU (full network, in the page, given up when no tile is done for a while,
 * then null) or the CPU (int8 network on fewer tiles, in a worker). Throws on other errors.
 */
async function attempt(gpu: boolean, bytes: Uint8Array, mime: string | undefined, base: string, outer: AbortSignal, pill: (s: string | null) => void): Promise<string | null> {
  const symbols = gpu ? FULL : SMALL;
  const files = await fetchModelFiles({
    feature: "scan",
    label: "oemer",
    repo: SCAN_MODELS_REPO,
    files: [symbols, CLASSIFIERS],
    alsoFrom: [ENGINE_HOST],
    signal: outer,
    onProgress: (loaded, total) => pill(t("scan.downloading", { percent: String(Math.round((loaded / Math.max(1, total)) * 100)) })),
  });
  const { scanToMusicXml, scanEngineVersion } = await import("scoredit");
  const engine = await scanEngineVersion();
  const inner = new AbortController();
  const stop = () => inner.abort();
  outer.addEventListener("abort", stop);
  let stalled = false;
  let timer = 0;
  const watch = () => {
    window.clearTimeout(timer);
    if (gpu) timer = window.setTimeout(() => ((stalled = true), inner.abort()), GPU_STALL_MS);
  };
  watch();
  try {
    // A lost GPU device leaves onnxruntime's promise pending forever: the abort must win the race.
    const aborted = new Promise<never>((_, reject) => inner.signal.addEventListener("abort", () => reject(new DOMException("Aborted", "AbortError")), { once: true }));
    const result = await Promise.race([aborted, scanToMusicXml(new Blob([bytes as BlobPart], { type: mime ?? "image/png" }), {
      models: { symbols: files.get(symbols.name)!, classifiers: files.get(CLASSIFIERS.name)! },
      // WebGPU waits on the GPU anyway and stalls inside a worker on Android: in the page then.
      // The dev server pre-bundles scoredit, which breaks its worker's URL: in the page there too.
      worker: gpu || import.meta.env.DEV ? undefined : true,
      threads: 1,
      step: gpu ? 128 : 256,
      session: gpu ? { executionProviders: ["webgpu", "wasm"] } : undefined,
      wasmPaths: `https://${ENGINE_HOST}/npm/onnxruntime-web@${engine}/dist/`,
      title: base,
      signal: inner.signal,
      progress: (p) => {
        if (p.done > 0) watch();
        pill(p.total > 1 ? t("scan.reading", { done: String(p.done), total: String(p.total) }) : t("scan.finishing"));
      },
    })]);
    return result.xml;
  } catch (e) {
    if (stalled) return null;
    throw e;
  } finally {
    window.clearTimeout(timer);
    outer.removeEventListener("abort", stop);
  }
}

function gpuFailedBefore(): boolean {
  try {
    return localStorage.getItem(GPU_FAILED_KEY) === "1";
  } catch {
    return false;
  }
}

function rememberGpuFailed(): void {
  try {
    localStorage.setItem(GPU_FAILED_KEY, "1");
  } catch {
    /* not kept: the next reading tries the GPU again */
  }
}

/** A WebGPU adapter that answers: navigator.gpu alone does not mean one is there. */
async function hasWebGpu(): Promise<boolean> {
  const gpu = (navigator as Navigator & { gpu?: { requestAdapter(): Promise<unknown> } }).gpu;
  if (!gpu) return false;
  return !!(await gpu.requestAdapter().catch(() => null));
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
