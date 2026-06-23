// Copies svgedit's editor (the full default toolset) into public/svgedit/ so it can run
// from a same-origin iframe with its own relative asset/locale resolution intact (no
// bundler/asset-path fights). Skips tests, sourcemaps, the iife duplicate and the stock
// HTML. Also writes omni.html: a tiny boot page that inits svgedit and bridges load/get/
// change over postMessage. Generated (gitignored); run via predev/prebuild or manually:
//   node scripts/copy-svgedit-assets.mjs
import { cpSync, writeFileSync, rmSync } from "node:fs";

const SRC = "node_modules/svgedit/dist/editor";
const OUT = "public/svgedit";

rmSync(OUT, { recursive: true, force: true });
cpSync(SRC, OUT, {
  recursive: true,
  filter: (src) => {
    const p = src.replace(/\\/g, "/");
    if (p.includes("/tests")) return false;
    if (p.endsWith(".map")) return false;
    if (/\/iife-/.test(p)) return false;
    if (/\/(browser-not-supported|index)\./.test(p)) return false;
    return true;
  },
});

// Boot page: init svgedit with the full default toolset and bridge to the host via
// postMessage. The host posts {type:'load', svg}; this posts {type:'inited'} when ready
// and {type:'changed', svg} on every edit; {type:'get'} replies {type:'svg', svg}.
const OMNI = `<!doctype html>
<html><head><meta charset="utf-8" />
<meta name="viewport" content="width=device-width, initial-scale=1.0, user-scalable=no" />
<link rel="stylesheet" href="./svgedit.css" />
<style>html,body{margin:0;height:100%;background:#fff} #container{height:100%;width:100%}</style>
</head><body>
<div id="container"></div>
<script type="module">
import Editor from './Editor.js'
const ed = new Editor(document.getElementById('container'))
ed.setConfig({ extensions: [], noDefaultExtensions: false, showRulers: false, dimensions: [800, 600], forceStorage: true, noStorageOnLoad: true })
ed.init()
const post = (m) => parent.postMessage(m, '*')
const ready = (cb) => ed.svgCanvas ? cb() : setTimeout(() => ready(cb), 40)
let bound = false
ready(() => {
  if (!bound) { bound = true; try { ed.svgCanvas.bind('changed', () => post({ type: 'changed', svg: ed.svgCanvas.getSvgString() })) } catch (e) {} }
  post({ type: 'inited' })
})
window.addEventListener('message', (e) => {
  const m = e.data || {}
  if (m.type === 'load') ready(() => { try { ed.svgCanvas.setSvgString(m.svg || '') } catch (err) { post({ type: 'error', message: String(err) }) } })
  else if (m.type === 'get') post({ type: 'svg', svg: ed.svgCanvas ? ed.svgCanvas.getSvgString() : '' })
})
</script>
</body></html>
`;
writeFileSync(`${OUT}/omni.html`, OMNI);
console.log(`svgedit assets -> ${OUT} (+ omni.html boot page)`);
