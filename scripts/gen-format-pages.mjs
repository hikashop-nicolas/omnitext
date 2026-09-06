// Generates dist/formats/<id>.html plus dist/formats.html, dist/sitemap.xml and
// dist/robots.txt, after `vite build` and before gen-sw.mjs (which precaches whatever it
// finds in dist).
//
// Why a generator and not hand-written pages: a page claiming Omnitext opens .dwg has to
// stop claiming it the day the app stops. So the extensions and the editor named on each
// page are read from the very format modules src/main.ts registers, and a page whose id no
// longer exists in the app fails the build instead of going out stale. The prose that no
// registry can know lives in format-pages.data.mjs.
//
// The URLs end in .html on purpose. The service worker answers navigations from its cache
// and falls back to the app shell, and a directory-style URL would not match a cached
// "formats/pdf.html" entry, so every visit would be served the app instead of the page.
import { mkdirSync, readdirSync, writeFileSync } from "node:fs";
import { register } from "node:module";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { PAGES } from "./format-pages.data.mjs";

// The app's modules import each other without file extensions, which node does not resolve
// on its own. Must run before the dynamic imports below.
register("./ts-resolve-hook.mjs", import.meta.url);

const root = fileURLToPath(new URL("..", import.meta.url));
const dist = join(root, "dist");
const SITE = "https://hikashop-nicolas.github.io/omnitext";
const REPO = "https://github.com/hikashop-nicolas/omnitext";

// ---------------------------------------------------------------------------
// The registry, as the app itself declares it
// ---------------------------------------------------------------------------

/** Every format descriptor the app defines, by id. Node strips the types for us. */
async function loadManifests() {
  const dir = join(root, "src", "formats");
  const wanted = (f) => f.endsWith(".ts") && !f.endsWith(".impl.ts") && !f.endsWith(".test.ts");
  // Some formats are a directory (csv), so look one level down as well.
  const files = readdirSync(dir, { withFileTypes: true }).flatMap((e) =>
    e.isDirectory()
      ? readdirSync(join(dir, e.name)).filter(wanted).map((f) => join(e.name, f))
      : wanted(e.name)
        ? [e.name]
        : [],
  );
  const byId = new Map();
  const skipped = [];
  for (const f of files) {
    let mod;
    try {
      mod = await import(join(dir, f));
    } catch (e) {
      // A module that needs a browser is not one we describe on a page, but say so: a
      // silent skip here once turned a resolution failure into "the app dropped this
      // format", which sent me looking in the wrong place entirely.
      skipped.push(`${f}: ${String(e.message).split("\n")[0]}`);
      continue;
    }
    for (const [name, value] of Object.entries(mod)) {
      // Most formats are exported as a descriptor object...
      if (value && typeof value === "object" && value.manifest?.kind === "format") {
        byId.set(value.manifest.id, value.manifest);
      }
      // ...but the media, image, archive and long-tail code formats come from a factory
      // (makeViewerFormats, makeTextFormats). Those are most of what the app opens, so a
      // loader that only looked at plain exports could not describe any of them.
      if (typeof value === "function" && /^make\w*Formats$/.test(name)) {
        for (const d of value()) {
          if (d?.manifest?.kind === "format") byId.set(d.manifest.id, d.manifest);
        }
      }
    }
  }
  return { byId, skipped };
}

// ---------------------------------------------------------------------------
// Rendering
// ---------------------------------------------------------------------------

const esc = (s) =>
  String(s).replace(/[&<>"']/g, (c) =>
    ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[c],
  );

const STYLE = `
:root { color-scheme: light dark; --bg:#fff; --fg:#1a1c20; --muted:#5b6270; --line:#e3e6ec;
  --card:#f7f8fa; --accent:#3b5bdb; }
@media (prefers-color-scheme: dark) { :root { --bg:#16181d; --fg:#e8eaee; --muted:#9aa3b2;
  --line:#2a2e37; --card:#1d2027; --accent:#8ea2ff; } }
* { box-sizing:border-box; }
body { margin:0; background:var(--bg); color:var(--fg); font:16px/1.65 system-ui,-apple-system,
  "Segoe UI",sans-serif; }
.wrap { max-width:44rem; margin:0 auto; padding:2.5rem 1.25rem 4rem; }
a { color:var(--accent); }
header a.home { display:inline-flex; align-items:center; gap:.5rem; font-weight:600;
  text-decoration:none; color:var(--fg); }
header a.home img { width:28px; height:28px; }
h1 { font-size:1.9rem; line-height:1.25; margin:1.75rem 0 .75rem; }
h2 { font-size:1.15rem; margin:2rem 0 .5rem; }
.lead { font-size:1.05rem; color:var(--fg); }
ul { padding-left:1.15rem; }
li { margin:.35rem 0; }
.cta { display:inline-block; margin:1.25rem 0; padding:.7rem 1.3rem; border-radius:8px;
  background:var(--accent); color:#fff; text-decoration:none; font-weight:600; }
.facts { margin:1.5rem 0; padding:1rem 1.15rem; background:var(--card); border:1px solid var(--line);
  border-radius:10px; font-size:.95rem; }
.facts dl { display:grid; grid-template-columns:auto 1fr; gap:.35rem 1rem; margin:0; }
.facts dt { color:var(--muted); }
.facts dd { margin:0; }
.note { color:var(--muted); font-size:.95rem; }
footer { margin-top:3rem; padding-top:1.25rem; border-top:1px solid var(--line);
  color:var(--muted); font-size:.9rem; }
.grid { display:grid; grid-template-columns:repeat(auto-fill,minmax(13rem,1fr)); gap:.75rem;
  padding:0; list-style:none; }
.grid a { display:block; padding:.75rem .9rem; border:1px solid var(--line); border-radius:9px;
  text-decoration:none; background:var(--card); }
.grid strong { display:block; color:var(--fg); }
.grid span { color:var(--muted); font-size:.88rem; }
code { background:var(--card); padding:.1rem .35rem; border-radius:4px; font-size:.9em; }
`;

/** `base` is the path back to the site root: "../" from inside formats/, "" from the root. */
function shell({ title, description, canonical, body, base }) {
  return `<!doctype html>
<html lang="en">
<head>
<meta charset="utf-8" />
<meta name="viewport" content="width=device-width, initial-scale=1" />
<title>${esc(title)}</title>
<meta name="description" content="${esc(description)}" />
<link rel="canonical" href="${esc(canonical)}" />
<meta property="og:title" content="${esc(title)}" />
<meta property="og:description" content="${esc(description)}" />
<meta property="og:url" content="${esc(canonical)}" />
<meta property="og:type" content="website" />
<link rel="icon" href="${base}favicon.svg" type="image/svg+xml" />
<style>${STYLE}</style>
</head>
<body>
<div class="wrap">
<header><a class="home" href="${base}index.html"><img src="${base}icon-192.png" alt="" /> Omnitext</a></header>
${body}
<footer>
Omnitext is a free, open-source editor that runs entirely in your browser. No account, no
upload, no tracking. <a href="${REPO}">Source on GitHub</a> ·
<a href="${base}formats.html">All formats</a> · <a href="${base}privacy.html">Privacy</a>
</footer>
</div>
</body>
</html>
`;
}

/** Extensions a page may advertise: every one comes from the registry, none is invented. */
function extensionsFor(page, manifests) {
  const all = page.formats.flatMap((id) => manifests.get(id).extensions).filter(Boolean);
  return [...new Set(all)];
}

// A page covering 60 languages would otherwise print 150 extensions, which reads as noise
// and buries the ones people recognise.
const EXT_SHOWN = 16;

function formatPage(page, manifests) {
  const exts = extensionsFor(page, manifests);
  const title = `${page.headline} · Omnitext`;
  const canonical = `${SITE}/formats/${page.id}.html`;
  const related = PAGES.filter((p) => p.id !== page.id).slice(0, 6);
  const body = `
<h1>${esc(page.headline)}</h1>
<p class="lead">${esc(page.lead)}</p>
<a class="cta" href="../index.html">Open Omnitext</a>
<p class="note">Free, no account, and your file never leaves your device.</p>
<div class="facts">
  <dl>
    <dt>Opens</dt><dd>${
      exts.slice(0, EXT_SHOWN).map((e) => `<code>${esc(e)}</code>`).join(" ") || "—"
    }${exts.length > EXT_SHOWN ? ` and ${exts.length - EXT_SHOWN} more` : ""}</dd>
    <dt>Runs</dt><dd>In your browser. The file is not uploaded anywhere.</dd>
    <dt>Costs</dt><dd>Nothing, and there is no account to make.</dd>
  </dl>
</div>
<h2>What you can do with ${esc(page.name)} files here</h2>
<ul>${page.can.map((c) => `<li>${esc(c)}</li>`).join("")}</ul>
${page.note ? `<p class="note">${esc(page.note)}</p>` : ""}
<h2>Why it stays on your device</h2>
<p>Omnitext is a static page: there is no server to receive your file. It runs the editor
in the browser, reads the file from your disk, and writes it back there. That is also why it
keeps working offline, and why it can open a file you would not want to hand to a website.</p>
<h2>Other formats</h2>
<ul class="grid">${related
    .map(
      (p) =>
        `<li><a href="${esc(p.id)}.html"><strong>${esc(p.name)}</strong><span>${esc(p.headline)}</span></a></li>`,
    )
    .join("")}</ul>
<p><a href="../formats.html">See every format Omnitext opens</a></p>
`;
  return shell({ title, description: page.summary, canonical, body, base: "../" });
}

function indexPage(pages, manifests) {
  const body = `
<h1>Every format Omnitext opens</h1>
<p class="lead">Omnitext opens and edits files in your browser: documents, spreadsheets, PDFs,
drawings, subtitles, maps, images and more. Nothing is uploaded, there is no account, and it
is free and open source.</p>
<a class="cta" href="index.html">Open Omnitext</a>
<h2>Formats with a page of their own</h2>
<ul class="grid">${pages
    .map(
      (p) =>
        `<li><a href="formats/${esc(p.id)}.html"><strong>${esc(p.name)}</strong><span>${esc(
          extensionsFor(p, manifests).slice(0, 4).join(" "),
        )}</span></a></li>`,
    )
    .join("")}</ul>
<p class="note">Omnitext opens a good deal more than this: the app picks an editor for the
file you give it, and anything it does not recognise still opens, as text or as a hex view.</p>
`;
  return shell({
    title: "Every file format Omnitext opens · Omnitext",
    description:
      "Documents, spreadsheets, PDFs, CAD drawings, subtitles, maps and images, all edited in your browser with nothing uploaded.",
    canonical: `${SITE}/formats.html`,
    body,
    base: "", // the index sits at the site root, not inside formats/
  });
}

// ---------------------------------------------------------------------------
// Build
// ---------------------------------------------------------------------------

const { byId: manifests, skipped } = await loadManifests();

const referenced = PAGES.flatMap((p) => p.formats);
const unknown = referenced.filter((id) => !manifests.has(id)).map((id) => ({ id }));
if (unknown.length) {
  const why = skipped.length ? `\nModules that would not load:\n  ${skipped.join("\n  ")}` : "";
  throw new Error(
    `format pages describe ids the app no longer registers: ${unknown
      .map((p) => p.id)
      .join(", ")}. Remove the page or restore the format.${why}`,
  );
}
const empty = PAGES.filter((p) => extensionsFor(p, manifests).length === 0);
if (empty.length) {
  throw new Error(
    `these formats claim no extension, so their page would list none: ${empty
      .map((p) => p.id)
      .join(", ")}`,
  );
}

mkdirSync(join(dist, "formats"), { recursive: true });
for (const page of PAGES) {
  writeFileSync(
    join(dist, "formats", `${page.id}.html`),
    formatPage(page, manifests),
  );
}
writeFileSync(join(dist, "formats.html"), indexPage(PAGES, manifests));

const urls = [`${SITE}/`, `${SITE}/formats.html`, ...PAGES.map((p) => `${SITE}/formats/${p.id}.html`)];
writeFileSync(
  join(dist, "sitemap.xml"),
  `<?xml version="1.0" encoding="UTF-8"?>\n<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">\n${urls
    .map((u) => `  <url><loc>${u}</loc></url>`)
    .join("\n")}\n</urlset>\n`,
);
writeFileSync(join(dist, "robots.txt"), `User-agent: *\nAllow: /\nSitemap: ${SITE}/sitemap.xml\n`);

console.log(`format pages: ${PAGES.length} pages + index, sitemap with ${urls.length} urls`);
