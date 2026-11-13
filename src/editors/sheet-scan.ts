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
  // WebGPU runs the full network fast; without it, the int8 copy on fewer tiles.
  const gpu = typeof navigator !== "undefined" && "gpu" in navigator;
  const symbols = gpu ? FULL : SMALL;
  try {
    pill(t("scan.preparing"));
    const files = await fetchModelFiles({
      feature: "scan",
      label: "oemer",
      repo: SCAN_MODELS_REPO,
      files: [symbols, CLASSIFIERS],
      alsoFrom: [ENGINE_HOST],
      signal: abort.signal,
      onProgress: (loaded, total) => pill(t("scan.downloading", { percent: String(Math.round((loaded / Math.max(1, total)) * 100)) })),
    });
    const { scanToMusicXml, scanEngineVersion } = await import("scoredit");
    const engine = await scanEngineVersion();
    const base = (filename ?? "scan").replace(/\.[^.]*$/, "");
    const result = await scanToMusicXml(new Blob([bytes as BlobPart], { type: mime ?? "image/png" }), {
      models: { symbols: files.get(symbols.name)!, classifiers: files.get(CLASSIFIERS.name)! },
      // The dev server pre-bundles scoredit, which breaks its worker's URL: in-thread there.
      worker: import.meta.env.DEV ? undefined : true,
      threads: 1,
      step: gpu ? 128 : 256,
      session: gpu ? { executionProviders: ["webgpu", "wasm"] } : undefined,
      wasmPaths: `https://${ENGINE_HOST}/npm/onnxruntime-web@${engine}/dist/`,
      title: base,
      signal: abort.signal,
      progress: (p) => pill(p.total > 1 ? t("scan.reading", { done: String(p.done), total: String(p.total) }) : t("scan.finishing")),
    });
    host.workspace.openFile?.(`${base}.musicxml`, new TextEncoder().encode(result.xml), "application/vnd.recordare.musicxml+xml");
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
