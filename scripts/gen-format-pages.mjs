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
import { existsSync, mkdirSync, readdirSync, writeFileSync } from "node:fs";
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
  --card:#f7f8fa; --accent:#3b5bdb; --shadow:0 12px 28px rgba(16,20,32,.14); }
@media (prefers-color-scheme: dark) { :root { --bg:#16181d; --fg:#e8eaee; --muted:#9aa3b2;
  --line:#2a2e37; --card:#1d2027; --accent:#8ea2ff; --shadow:0 12px 28px rgba(0,0,0,.45); } }
* { box-sizing:border-box; }
body { margin:0; background:var(--bg); color:var(--fg); font:16px/1.65 system-ui,-apple-system,
  "Segoe UI",sans-serif; }
.wrap { max-width:46rem; margin:0 auto; padding:2.5rem 1.25rem 4rem; }
a { color:var(--accent); }
header a.home { display:inline-flex; align-items:center; gap:.5rem; font-weight:600;
  text-decoration:none; color:var(--fg); }
header a.home img { width:28px; height:28px; }
h1 { font-size:1.9rem; line-height:1.25; margin:1.75rem 0 .75rem; }
h2 { font-size:1.15rem; margin:2rem 0 .5rem; }
.lead { font-size:1.05rem; color:var(--fg); }
ul { padding-left:1.15rem; }
li { margin:.35rem 0; }
.cta { display:inline-block; margin:1.25rem 0 .4rem; padding:.7rem 1.3rem; border-radius:8px;
  background:var(--accent); color:#fff; text-decoration:none; font-weight:600; }
.cta + .note { margin-top:0; }
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
figure { margin:1.75rem 0; }
figure img { display:block; width:100%; height:auto; border:1px solid var(--line);
  border-radius:12px; box-shadow:var(--shadow); }
figcaption { margin-top:.6rem; color:var(--muted); font-size:.92rem; }
ol.steps { counter-reset:step; list-style:none; padding:0; margin:1rem 0; }
ol.steps li { counter-increment:step; position:relative; padding-left:2.4rem; margin:.6rem 0; }
ol.steps li::before { content:counter(step); position:absolute; left:0; top:.1rem; width:1.7rem;
  height:1.7rem; border-radius:50%; background:var(--card); border:1px solid var(--line);
  color:var(--accent); font-weight:600; font-size:.9rem; display:grid; place-items:center; }
details { border-top:1px solid var(--line); padding:.7rem 0; }
details summary { cursor:pointer; font-weight:600; }
details p { margin:.5rem 0 0; color:var(--muted); }
`;

/**
 * A screenshot, dark and light, as a <picture> so it matches the reader's own theme.
 * The pair lives in public/shots: <name>.webp and <name>-light.webp. These sit near the top
 * of their page, so they load eagerly rather than after a scroll that never comes.
 */
function figure(shot, base) {
  if (!shot) return "";
  return `<figure>
  <picture>
    <source srcset="${base}shots/${esc(shot.name)}-light.webp" media="(prefers-color-scheme: light)" />
    <img src="${base}shots/${esc(shot.name)}.webp" alt="${esc(shot.caption)}" width="1400" decoding="async" />
  </picture>
  <figcaption>${esc(shot.caption)}</figcaption>
</figure>`;
}

/** `base` is the path back to the site root: "../" from inside formats/, "" from the root. */
function shell({ title, description, canonical, body, base, image }) {
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
<meta property="og:type" content="website" />${
  image ? `\n<meta property="og:image" content="${esc(image)}" />\n<meta name="twitter:card" content="summary_large_image" />` : ""
}
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
${figure(page.shot, "../")}
<h2>What you can do with ${esc(page.name)}${/s$/.test(page.name) ? "" : " files"} here</h2>
<ul>${page.can.map((c) => `<li>${esc(c)}</li>`).join("")}</ul>
${page.note ? `<p class="note">${esc(page.note)}</p>` : ""}
<h2>How it works</h2>
<ol class="steps">
  <li>Open Omnitext and pick your file, or drop it anywhere on the page.</li>
  <li>Edit it in the surface that suits it, with everything else left as it was.</li>
  <li>Save, and the file is written back to your disk.</li>
</ol>
<div class="facts">
  <dl>
    <dt>Opens</dt><dd>${
      exts.slice(0, EXT_SHOWN).map((e) => `<code>${esc(e)}</code>`).join(" ") || "none"
    }${exts.length > EXT_SHOWN ? ` and ${exts.length - EXT_SHOWN} more` : ""}</dd>
    <dt>Runs</dt><dd>In your browser. The file is not uploaded anywhere.</dd>
    <dt>Costs</dt><dd>Nothing, and there is no account to make.</dd>
  </dl>
</div>
<h2>Questions</h2>
<details><summary>Is my file uploaded anywhere?</summary>
<p>No. Omnitext is a static page with no server behind it: it reads the file from your disk,
edits it in the browser and writes it back there. Nothing is sent, and there is nothing to
delete afterwards.</p></details>
<details><summary>Is it really free?</summary>
<p>Yes. Every feature is available to everyone, with no account, no trial, no watermark and
no page limit. The source is open, under the MIT licence.</p></details>
<details><summary>Does it work offline?</summary>
<p>Yes, once you have visited it. Your browser can also install it as an app, which adds
Omnitext to your computer's "Open with" menu. There is an Android app as well.</p></details>
<details><summary>Do I need to install anything?</summary>
<p>No. It runs in the browser you already have, on a computer or a phone.</p></details>
<h2>Other formats</h2>
<ul class="grid">${related
    .map(
      (p) =>
        `<li><a href="${esc(p.id)}.html"><strong>${esc(p.name)}</strong><span>${esc(p.headline)}</span></a></li>`,
    )
    .join("")}</ul>
<p><a href="../formats.html">See every format Omnitext opens</a></p>
`;
  return shell({
    title,
    description: page.summary,
    canonical,
    body,
    base: "../",
    image: page.shot ? `${SITE}/shots/${page.shot.name}.webp` : undefined,
  });
}

// The order people think in, rather than the order the pages were written in. Every page id
// must appear exactly once: a page added without a group would otherwise vanish from the
// index while still being built.
const GROUPS = [
  { title: "Documents", ids: ["pdf", "docx", "odt", "markdown", "latex", "epub"] },
  { title: "Spreadsheets and data", ids: ["xlsx", "ods", "csv", "sqlite", "parquet", "ipynb", "json"] },
  { title: "Pictures and drawings", ids: ["svg", "psd", "heic", "dwg", "dxf", "dicom"] },
  { title: "Audio, video and subtitles", ids: ["video", "audio", "srt", "vtt", "ass"] },
  { title: "Maps", ids: ["geojson", "kml", "gpx"] },
  { title: "Mail and everything else", ids: ["eml", "msg", "archives", "code"] },
];

function indexPage(pages, manifests) {
  const byId = new Map(pages.map((p) => [p.id, p]));
  const grouped = GROUPS.map((g) => ({ ...g, pages: g.ids.map((id) => byId.get(id)) }));
  const card = (p) =>
    `<li><a href="formats/${esc(p.id)}.html"><strong>${esc(p.name)}</strong><span>${esc(
      extensionsFor(p, manifests).slice(0, 4).join(" "),
    )}</span></a></li>`;
  const body = `
<h1>Every format Omnitext opens</h1>
<p class="lead">Omnitext opens and edits files in your browser: documents, spreadsheets, PDFs,
drawings, subtitles, maps, images and more. Nothing is uploaded, there is no account, and it
is free and open source.</p>
<a class="cta" href="index.html">Open Omnitext</a>
${figure({ name: "home", caption: "Omnitext when it opens: pick a file, or drop one on the page." }, "")}
${grouped
    .map((g) => `<h2>${esc(g.title)}</h2>\n<ul class="grid">${g.pages.map(card).join("")}</ul>`)
    .join("\n")}
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
    image: `${SITE}/shots/home.webp`,
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

const groupedIds = GROUPS.flatMap((g) => g.ids);
const ungrouped = PAGES.map((p) => p.id).filter((id) => !groupedIds.includes(id));
const strayGroupIds = groupedIds.filter((id) => !PAGES.some((p) => p.id === id));
if (ungrouped.length || strayGroupIds.length) {
  throw new Error(
    `the format index groups do not match the pages. Missing from a group: ${
      ungrouped.join(", ") || "none"
    }. Grouped but not a page: ${strayGroupIds.join(", ") || "none"}.`,
  );
}

// A page pointing at a screenshot that is not in public/shots would render a broken image,
// and nothing else in the build would notice.
for (const page of PAGES.filter((p) => p.shot)) {
  for (const f of [`${page.shot.name}.webp`, `${page.shot.name}-light.webp`]) {
    if (!existsSync(join(root, "public", "shots", f))) {
      throw new Error(`${page.id}.html names a screenshot that does not exist: public/shots/${f}`);
    }
  }
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
