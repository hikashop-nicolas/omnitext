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
