import { existsSync, readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

// onnxruntime-web 1.25.x and 1.26.x reject every int8 (q8) encoder-decoder export Xenova
// published: session creation dies in the QDQ-to-MatMulNBits optimiser with "Missing required
// scale: model.shared.weight_merged_0_scale". That is the dtype translation asks for on the wasm
// backend (localml's backend.ts), so on a device without WebGPU, which most Android WebViews are,
// Translate could not load a model at all. @huggingface/transformers 4.2.0 pins one of those
// builds, hence localml asking for 4.3.0, which brings a clean one: an npm override would not do,
// since npm 9, what the F-Droid build runs, ignores overrides. 1.24.3 and 1.27.0 are also clean.
//
// This is a version guard, not a model load: it cannot prove a given engine translates, only that
// we are not back on an engine known to refuse. scripts/check-translate-wasm.mjs does the real
// load, and is run by hand because the models are 500 to 800 MB.
const BROKEN_MINORS = [25, 26];

// The engine transformers.js actually imports: its own nested copy if npm gave it one, else the
// hoisted package. That version is what it puts in the jsDelivr URL, and whose dist the F-Droid
// build packages, so it is the one that has to be clean.
function engineVersion(): string {
  const nested = "node_modules/@huggingface/transformers/node_modules/onnxruntime-web/package.json";
  const path = existsSync(nested) ? nested : "node_modules/onnxruntime-web/package.json";
  return JSON.parse(readFileSync(path, "utf8")).version;
}

describe("the onnxruntime-web the AI features run on", () => {
  it("is not one of the builds that refuse q8 translation models", () => {
    const version = engineVersion();
    const [major, minor] = version.split(".").map((p) => Number.parseInt(p, 10));
    expect(Number.isNaN(minor)).toBe(false);
    expect({ version, broken: major === 1 && BROKEN_MINORS.includes(minor) }).toEqual({ version, broken: false });
  });

  it("is still a dependency transformers.js resolves, so the override reaches it", () => {
    const transformers = JSON.parse(readFileSync("node_modules/@huggingface/transformers/package.json", "utf8"));
    expect(transformers.dependencies?.["onnxruntime-web"]).toBeTruthy();
  });
});
