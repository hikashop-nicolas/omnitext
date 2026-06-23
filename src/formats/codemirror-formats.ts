import { StreamLanguage, type StreamParser } from "@codemirror/language";
import type { Extension } from "@codemirror/state";
import type { FormatDescriptor, FormatModule, ParseResult } from "../core/types";

// Data-driven registration of the long tail of text formats. Each entry is just an id,
// some extensions, and an optional highlighting `mode`; the editing surface is always
// CodeMirror (text round-trips byte-for-byte). Highlighting comes from the already-bundled
// @codemirror/legacy-modes (100+ modes) so the bulk needs no new dependencies, and a
// missing mode simply means plain (still fully editable) text. These are registered for
// OPENING/highlighting existing files; the New dialog stays the curated primary set.
//
// Extensions here must not collide with the primary formats (json, yaml, js, ts, css,
// html, xml, py, sql, sh, toml, ini, md, csv, tsv, env, properties, and the binary ones).

// Resolve a highlighting mode to a CodeMirror extension. Each case is its own lazy chunk.
async function loadMode(mode: string): Promise<Extension | null> {
  const sl = (p: StreamParser<unknown>) => StreamLanguage.define(p);
  switch (mode) {
    case "c": return sl((await import("@codemirror/legacy-modes/mode/clike")).c);
    case "cpp": return sl((await import("@codemirror/legacy-modes/mode/clike")).cpp);
    case "java": return sl((await import("@codemirror/legacy-modes/mode/clike")).java);
    case "csharp": return sl((await import("@codemirror/legacy-modes/mode/clike")).csharp);
    case "scala": return sl((await import("@codemirror/legacy-modes/mode/clike")).scala);
    case "kotlin": return sl((await import("@codemirror/legacy-modes/mode/clike")).kotlin);
    case "objc": return sl((await import("@codemirror/legacy-modes/mode/clike")).objectiveC);
    case "objcpp": return sl((await import("@codemirror/legacy-modes/mode/clike")).objectiveCpp);
    case "dart": return sl((await import("@codemirror/legacy-modes/mode/clike")).dart);
    case "glsl": return sl((await import("@codemirror/legacy-modes/mode/clike")).shader);
    case "squirrel": return sl((await import("@codemirror/legacy-modes/mode/clike")).squirrel);
    case "ceylon": return sl((await import("@codemirror/legacy-modes/mode/clike")).ceylon);
    case "ocaml": return sl((await import("@codemirror/legacy-modes/mode/mllike")).oCaml);
    case "fsharp": return sl((await import("@codemirror/legacy-modes/mode/mllike")).fSharp);
    case "sml": return sl((await import("@codemirror/legacy-modes/mode/mllike")).sml);
    case "rust": return sl((await import("@codemirror/legacy-modes/mode/rust")).rust);
    case "go": return sl((await import("@codemirror/legacy-modes/mode/go")).go);
    case "ruby": return sl((await import("@codemirror/legacy-modes/mode/ruby")).ruby);
    case "perl": return sl((await import("@codemirror/legacy-modes/mode/perl")).perl);
    case "lua": return sl((await import("@codemirror/legacy-modes/mode/lua")).lua);
    case "haskell": return sl((await import("@codemirror/legacy-modes/mode/haskell")).haskell);
    case "swift": return sl((await import("@codemirror/legacy-modes/mode/swift")).swift);
    case "julia": return sl((await import("@codemirror/legacy-modes/mode/julia")).julia);
    case "r": return sl((await import("@codemirror/legacy-modes/mode/r")).r);
    case "fortran": return sl((await import("@codemirror/legacy-modes/mode/fortran")).fortran);
    case "cobol": return sl((await import("@codemirror/legacy-modes/mode/cobol")).cobol);
    case "pascal": return sl((await import("@codemirror/legacy-modes/mode/pascal")).pascal);
    case "tcl": return sl((await import("@codemirror/legacy-modes/mode/tcl")).tcl);
    case "erlang": return sl((await import("@codemirror/legacy-modes/mode/erlang")).erlang);
    case "clojure": return sl((await import("@codemirror/legacy-modes/mode/clojure")).clojure);
    case "commonlisp": return sl((await import("@codemirror/legacy-modes/mode/commonlisp")).commonLisp);
    case "scheme": return sl((await import("@codemirror/legacy-modes/mode/scheme")).scheme);
    case "powershell": return sl((await import("@codemirror/legacy-modes/mode/powershell")).powerShell);
    case "diff": return sl((await import("@codemirror/legacy-modes/mode/diff")).diff);
    case "stex": return sl((await import("@codemirror/legacy-modes/mode/stex")).stex);
    case "textile": return sl((await import("@codemirror/legacy-modes/mode/textile")).textile);
    case "gas": return sl((await import("@codemirror/legacy-modes/mode/gas")).gas);
    case "cmake": return sl((await import("@codemirror/legacy-modes/mode/cmake")).cmake);
    case "protobuf": return sl((await import("@codemirror/legacy-modes/mode/protobuf")).protobuf);
    case "groovy": return sl((await import("@codemirror/legacy-modes/mode/groovy")).groovy);
    case "coffeescript": return sl((await import("@codemirror/legacy-modes/mode/coffeescript")).coffeeScript);
    case "nginx": return sl((await import("@codemirror/legacy-modes/mode/nginx")).nginx);
    case "scss": return sl((await import("@codemirror/legacy-modes/mode/css")).sCSS);
    case "less": return sl((await import("@codemirror/legacy-modes/mode/css")).less);
    case "json": return (await import("@codemirror/lang-json")).json();
    default: return null;
  }
}

interface TextFormat {
  id: string;
  exts: string[];
  mimes?: string[];
  mode?: string;
}

// The long tail. Programming languages first (highlighted), then markup/docs, config,
// and plain-text families (no mode = plain CodeMirror, still fully editable).
const TEXT_FORMATS: TextFormat[] = [
  // C-family and other clike dialects
  { id: "c", exts: [".c", ".h"], mimes: ["text/x-csrc"], mode: "c" },
  { id: "cpp", exts: [".cpp", ".cc", ".cxx", ".hpp", ".hh", ".hxx", ".ino"], mimes: ["text/x-c++src"], mode: "cpp" },
  { id: "java", exts: [".java"], mimes: ["text/x-java"], mode: "java" },
  { id: "csharp", exts: [".cs"], mimes: ["text/x-csharp"], mode: "csharp" },
  { id: "scala", exts: [".scala", ".sc"], mode: "scala" },
  { id: "kotlin", exts: [".kt", ".kts"], mode: "kotlin" },
  { id: "objc", exts: [".m"], mode: "objc" },
  { id: "objcpp", exts: [".mm"], mode: "objcpp" },
  { id: "dart", exts: [".dart"], mode: "dart" },
  { id: "glsl", exts: [".glsl", ".vert", ".frag", ".shader"], mode: "glsl" },
  { id: "squirrel", exts: [".nut"], mode: "squirrel" },
  // ML family
  { id: "ocaml", exts: [".ml", ".mli"], mode: "ocaml" },
  { id: "fsharp", exts: [".fs", ".fsi", ".fsx"], mode: "fsharp" },
  { id: "sml", exts: [".sml"], mode: "sml" },
  // Dedicated single-language modes
  { id: "rust", exts: [".rs"], mimes: ["text/x-rustsrc"], mode: "rust" },
  { id: "go", exts: [".go"], mimes: ["text/x-go"], mode: "go" },
  { id: "ruby", exts: [".rb", ".rake", ".gemspec"], mimes: ["text/x-ruby"], mode: "ruby" },
  { id: "perl", exts: [".pl", ".pm"], mimes: ["text/x-perl"], mode: "perl" },
  { id: "lua", exts: [".lua"], mimes: ["text/x-lua"], mode: "lua" },
  { id: "haskell", exts: [".hs", ".lhs"], mode: "haskell" },
  { id: "swift", exts: [".swift"], mode: "swift" },
  { id: "julia", exts: [".jl"], mode: "julia" },
  { id: "rlang", exts: [".r", ".rmd"], mode: "r" },
  { id: "fortran", exts: [".f", ".for", ".f90", ".f95", ".f03"], mode: "fortran" },
  { id: "cobol", exts: [".cob", ".cbl"], mode: "cobol" },
  { id: "pascal", exts: [".pas", ".pp"], mode: "pascal" },
  { id: "tcl", exts: [".tcl"], mode: "tcl" },
  { id: "erlang", exts: [".erl", ".hrl"], mode: "erlang" },
  { id: "clojure", exts: [".clj", ".cljs", ".cljc", ".edn"], mode: "clojure" },
  { id: "commonlisp", exts: [".lisp", ".cl", ".el"], mode: "commonlisp" },
  { id: "scheme", exts: [".scm", ".ss"], mode: "scheme" },
  { id: "powershell", exts: [".ps1", ".psm1", ".psd1"], mode: "powershell" },
  { id: "asm", exts: [".s", ".asm"], mode: "gas" },
  { id: "cmake", exts: [".cmake"], mode: "cmake" },
  { id: "protobuf", exts: [".proto"], mode: "protobuf" },
  { id: "groovy", exts: [".groovy", ".gradle"], mode: "groovy" },
  { id: "coffeescript", exts: [".coffee"], mode: "coffeescript" },
  { id: "nginx", exts: [".nginx"], mode: "nginx" },
  { id: "scss", exts: [".scss"], mimes: ["text/x-scss"], mode: "scss" },
  { id: "less", exts: [".less"], mimes: ["text/x-less"], mode: "less" },
  // JSON-ish (reuse the JSON language)
  { id: "jsonl", exts: [".jsonl", ".ndjson", ".jsonc"], mode: "json" },
  // Markup / docs (highlighted). LaTeX has its own format (latex.ts) with a preview view.
  { id: "textile", exts: [".textile"], mode: "textile" },
  { id: "diff", exts: [".diff", ".patch"], mimes: ["text/x-diff"], mode: "diff" },
  // Markup / docs (plain, no dedicated mode)
  { id: "restructuredtext", exts: [".rst", ".rest"], mimes: ["text/x-rst"] },
  { id: "org", exts: [".org"] },
  { id: "asciidoc", exts: [".adoc", ".asciidoc", ".asc"] },
  { id: "bibtex", exts: [".bib"], mimes: ["text/x-bibtex"] },
  { id: "graphql", exts: [".graphql", ".gql"] },
  // Config / data (plain)
  { id: "editorconfig", exts: [".editorconfig"] },
  { id: "reg", exts: [".reg"] },
  { id: "desktop", exts: [".desktop"] },
  { id: "gettext", exts: [".po", ".pot"] },
  { id: "hcl", exts: [".hcl", ".tf", ".tfvars"] },
  { id: "tabseparated", exts: [".tab"], mimes: ["text/tab-separated-values"] },
  // Web component single-file formats (plain for now)
  { id: "vue", exts: [".vue"] },
  { id: "svelte", exts: [".svelte"] },
  { id: "astro", exts: [".astro"] },
  // Communication / calendar / contacts (plain)
  { id: "email", exts: [".eml"], mimes: ["message/rfc822"] },
  { id: "vcard", exts: [".vcf", ".vcard"], mimes: ["text/vcard"] },
  { id: "icalendar", exts: [".ics", ".ical"], mimes: ["text/calendar"] },
  // Subtitles (plain for now; a timeline editor is a possible future)
  { id: "subtitle", exts: [".srt", ".vtt", ".sub", ".ass", ".ssa"], mimes: ["text/vtt"] },
  // Logs and generic plain text
  { id: "log", exts: [".log", ".err", ".out"] },
  { id: "plaintext", exts: [".txt", ".text", ".nfo", ".me", ".1st", ".readme"], mimes: ["text/plain"] },
];

function textImpl(mode?: string): () => Promise<FormatModule> {
  return async () => {
    const ext = mode ? await loadMode(mode) : null;
    const mod: FormatModule = {
      parse: (text): ParseResult => ({ ok: true, model: text, diagnostics: [] }),
      serialize: (model) => String(model),
    };
    if (ext) mod.language = () => ext;
    return mod;
  };
}

/** All the long-tail text formats as descriptors (register for opening, not the New dialog). */
export function makeTextFormats(): FormatDescriptor[] {
  return TEXT_FORMATS.map((f) => ({
    manifest: {
      kind: "format" as const,
      id: f.id,
      extensions: f.exts,
      mimeTypes: f.mimes ?? [],
      nativeEditor: "codemirror",
    },
    detect: () => 0,
    load: textImpl(f.mode),
  }));
}

// Exported for tests: the raw table so we can assert no extension/id collisions.
export const TEXT_FORMAT_TABLE = TEXT_FORMATS;
