// Lets a build script import the app's TypeScript modules the way the bundler does.
//
// Node strips types on its own, but it will not guess extensions: the app writes
// `import { sniff } from "./sniff"` (bundler resolution) and node wants "./sniff.ts". This
// hook fills that gap, and only for relative specifiers with no extension, so nothing else
// about resolution changes. Node older than 22.18 cannot strip types, so there the load hook
// does it with the bundler's own transformer (F-Droid builds on Debian's Node 20).

import { readFile } from "node:fs/promises";
import { fileURLToPath } from "node:url";

export async function resolve(specifier, context, next) {
  if (specifier.startsWith(".") && !/\.[a-z0-9]+$/i.test(specifier)) {
    for (const candidate of [`${specifier}.ts`, `${specifier}/index.ts`]) {
      try {
        return await next(candidate, context);
      } catch {
        /* try the next shape */
      }
    }
  }
  return next(specifier, context);
}

export async function load(url, context, next) {
  if (process.features.typescript || !url.startsWith("file:") || !url.endsWith(".ts")) return next(url, context);
  const { transformWithOxc } = await import("vite");
  const path = fileURLToPath(url);
  const { code } = await transformWithOxc(await readFile(path, "utf8"), path, { lang: "ts" });
  return { format: "module", source: code, shortCircuit: true };
}
