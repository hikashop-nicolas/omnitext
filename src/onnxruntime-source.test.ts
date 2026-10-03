import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { ORT_BACKEND_MODULE, ORT_ENGINE_FILES, rewriteOnnxBackend } from "./onnxruntime-engine";

// Two builds, two answers. Without OMNITEXT_BUNDLE_ONNXRUNTIME the engine still comes from
// jsDelivr and the build drops onnxruntime's own wasm (vite.config.ts), which is what the web and
// Play builds do; with the flag the same file is rewritten to the packaged copy. Both halves rest
// on strings in transformers.js, so an upgrade that moves them fails here first.
//
// Read from the bundle a browser gets, which is the file Vite resolves, not the sources beside it.
describe("where transformers.js loads onnxruntime from", () => {
  const src = readFileSync(`node_modules/${ORT_BACKEND_MODULE}`, "utf8");

  it("still defaults to jsDelivr, which is what the unflagged build keeps", () => {
    expect(src).toContain("https://cdn.jsdelivr.net/npm/onnxruntime-web@");
    expect(src).toMatch(/!ONNX_ENV\.wasm\.wasmPaths/);
  });

  it("asks for the two files the flagged build packages, and for no proxy worker", () => {
    for (const file of ORT_ENGINE_FILES) expect(src).toContain(file);
    expect(src).toContain("ONNX_ENV.wasm.proxy = false");
  });

  // Android is not Safari by this test, so the Safari pair is never asked for and is not packaged.
  it("excludes Android from the Safari test that picks the other pair", () => {
    expect(src).toContain('!userAgent.includes("Android")');
  });

  it("points at the packaged engine once rewritten, with no jsDelivr left", () => {
    const rewritten = rewriteOnnxBackend(src);
    expect(rewritten).not.toContain("cdn.jsdelivr.net/npm/onnxruntime-web");
    expect(rewritten).toContain("new URL(ortEngineDir, import.meta.url)");
    expect(rewritten).toContain("ONNX_ENV.wasm.wasmPaths = false");
  });

  it("refuses to rewrite a file it no longer recognises", () => {
    expect(() => rewriteOnnxBackend("// nothing to anchor on")).toThrow(/cannot find/);
  });
});
