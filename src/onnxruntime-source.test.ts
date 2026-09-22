import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

// The build drops onnxruntime's own wasm (vite.config.ts) because transformers.js loads it from
// jsDelivr instead. If an update changes that default, the AI features would look for the file
// the build no longer ships: this fails first, so the drop can be revisited.
describe("where transformers.js loads onnxruntime from", () => {
  it("still defaults to jsDelivr", () => {
    const src = readFileSync("node_modules/@huggingface/transformers/src/backends/onnx.js", "utf8");
    expect(src).toContain("https://cdn.jsdelivr.net/npm/onnxruntime-web@");
    expect(src).toMatch(/!ONNX_ENV\.wasm\.wasmPaths/);
  });
});
