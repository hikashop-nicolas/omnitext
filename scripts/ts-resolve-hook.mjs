// Lets a build script import the app's TypeScript modules the way the bundler does.
//
// Node strips types on its own, but it will not guess extensions: the app writes
// `import { sniff } from "./sniff"` (bundler resolution) and node wants "./sniff.ts". This
// hook fills that gap, and only for relative specifiers with no extension, so nothing else
// about resolution changes.

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
