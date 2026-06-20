// Side-effect CSS imports (Vite injects these at build time).
declare module "*.css";

// The "ini" package ships no TypeScript types; declare the bits we use.
declare module "ini" {
  export function parse(text: string): Record<string, unknown>;
  export function decode(text: string): Record<string, unknown>;
  export function stringify(obj: unknown, opts?: unknown): string;
  export function encode(obj: unknown, opts?: unknown): string;
}
