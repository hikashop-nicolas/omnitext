// Side-effect CSS imports (Vite injects these at build time).
declare module "*.css";

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
