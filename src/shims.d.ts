// Side-effect CSS imports (Vite injects these at build time).
declare module "*.css";

// Vite build flags (tsconfig types has vitest/globals, not vite/client).
interface ImportMetaEnv {
  readonly PROD: boolean;
  readonly DEV: boolean;
}
interface ImportMeta {
  readonly env: ImportMetaEnv;
}

// Vite "?url" imports return the asset URL as a string.
declare module "*?url" {
  const url: string;
  export default url;
}

// The "ini" package ships no TypeScript types; declare the bits we use.
declare module "ini" {
  export function parse(text: string): Record<string, unknown>;
  export function decode(text: string): Record<string, unknown>;
  export function stringify(obj: unknown, opts?: unknown): string;
  export function encode(obj: unknown, opts?: unknown): string;
}

// "@jellyfin/libass-wasm" (SubtitlesOctopus) ships no types; declare the bits we use.
declare module "@jellyfin/libass-wasm" {
  export default class SubtitlesOctopus {
    constructor(options: {
      video: HTMLVideoElement;
      subContent: string;
      workerUrl: string;
      fallbackFont?: string;
      fonts?: string[];
      onReady?: () => void;
      onError?: (error: unknown) => void;
    });
    dispose(): void;
    freeTrack(): void;
    setTrack(content: string): void;
  }
}

// "geojs" ships no TypeScript types and is a large UMD bundle; type it loosely.
declare module "geojs" {
  const geo: any;
  export default geo;
}

// "topojson-client" / "wellknown" ship no types; declare the bits we use.
declare module "topojson-client" {
  export function feature(topology: unknown, object: unknown): unknown;
}
declare module "wellknown" {
  export function parse(wkt: string): unknown;
  export function stringify(geometry: unknown): string;
}

// "notebookjs" ships no TypeScript types; declare the bits we use.
declare module "notebookjs" {
  interface RenderedNotebook {
    render(): HTMLElement;
  }
  export const nb: {
    parse(json: unknown): RenderedNotebook;
    markdown: (src: string) => string;
    highlighter: (text: string, pre: HTMLElement, code: HTMLElement, lang?: string) => string;
    sanitizer: (html: string) => string;
    ansi: (text: string) => string;
  };
}

// "utif" (UTIF.js) ships no TypeScript types; declare the bits we use.
declare module "utif" {
  interface IFD {
    width: number;
    height: number;
    [key: string]: unknown;
  }
  const UTIF: {
    decode(buffer: ArrayBuffer | Uint8Array): IFD[];
    decodeImage(buffer: ArrayBuffer | Uint8Array, ifd: IFD): void;
    toRGBA8(ifd: IFD): Uint8Array;
  };
  export default UTIF;
}

// "foliate-js/view.js" registers the <foliate-view> custom element as a side effect and
// ships no types; imported only for that effect.
declare module "foliate-js/view.js";

// "libheif-js/wasm-bundle" (WASM build of libheif) ships no types; typed loosely.
declare module "libheif-js/wasm-bundle" {
  const libheif: unknown;
  export default libheif;
}

// "latex.js" ships no TypeScript types; declare the bits we use.
declare module "latex.js" {
  export class HtmlGenerator {
    constructor(options?: { hyphenate?: boolean; [k: string]: unknown });
  }
  export interface LatexResult {
    domFragment(): DocumentFragment;
    htmlDocument(baseURL?: string): Document;
  }
  export function parse(latex: string, options: { generator: HtmlGenerator }): LatexResult;
}
