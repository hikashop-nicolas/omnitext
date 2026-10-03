/**
 * Load a translation model on the wasm backend in a real browser and translate one sentence.
 *
 * The only honest check that the engine we ship can translate on a device without WebGPU, which
 * is what most Android WebViews are. Not in `npm test`: it downloads 500 to 800 MB of model and
 * needs a browser, so it is run by hand before a release or after a dependency bump. The cheap
 * half of the same guard, the engine version, is src/onnxruntime-version.test.ts.
 *
 * Usage:
 *   npm run dev                                   # in another terminal, serving the app
 *   npm i -D --no-save puppeteer                  # once, if it is not installed
 *   node scripts/check-translate-wasm.mjs [model] [device]
 *
 * model defaults to Xenova/m2m100_418M, device to wasm (pass webgpu to check the GPU path).
 * Exits non-zero unless the browser produced a non-empty translation.
 */
const model = process.argv[2] || "Xenova/m2m100_418M";
const device = process.argv[3] || "wasm";
const origin = process.env.OMNITEXT_ORIGIN || "http://localhost:5173";

// puppeteer brings its own Chrome; puppeteer-core needs CHROME_PATH to one you already have.
let puppeteer;
for (const pkg of ["puppeteer", "puppeteer-core"]) {
  try {
    puppeteer = (await import(pkg)).default;
    break;
  } catch {
    /* try the next one */
  }
}
if (!puppeteer) {
  console.error("needs a driver: npm i -D --no-save puppeteer");
  process.exit(2);
}

const browser = await puppeteer.launch({
  headless: true,
  executablePath: process.env.CHROME_PATH || undefined,
  args: ["--enable-unsafe-webgpu", "--no-sandbox"],
});
const page = await browser.newPage();
page.on("console", (m) => console.log("  browser:", m.text()));
await page.goto(origin, { waitUntil: "domcontentloaded" });

// Imports the same installed transformers.js the app's workers do, so it exercises the engine
// version the app would use, from the app's own origin.
const result = await page.evaluate(
  async (model, device) => {
    const { pipeline, env } = await import("/node_modules/@huggingface/transformers/dist/transformers.web.js");
    env.allowLocalModels = false;
    try {
      const translate = await pipeline("translation", model, { device, dtype: "q8" });
      const flores = model.includes("nllb");
      const out = await translate(["The quick brown fox jumps over the lazy dog."], {
        src_lang: flores ? "eng_Latn" : "en",
        tgt_lang: flores ? "fra_Latn" : "fr",
        max_new_tokens: 40,
        no_repeat_ngram_size: 3,
      });
      return { ok: true, text: (Array.isArray(out) ? out[0] : out).translation_text };
    } catch (e) {
      return { ok: false, error: String(e?.message ?? e) };
    }
  },
  model,
  device,
);
await browser.close();

console.log(`${model} on ${device}:`, JSON.stringify(result));
if (!result.ok || !result.text?.trim()) {
  console.error("translation failed");
  process.exit(1);
}
