// Test-only stand-in for `libarchive-wasm/dist/libarchive.wasm?url`.
//
// In the browser that import yields a URL, which emscripten fetches. Under vitest it runs
// in node, where emscripten reads the same string off disk instead: a URL path like
// "/node_modules/…/libarchive.wasm" is then resolved from the filesystem root and fails.
// vite.config.ts aliases the import to this module for tests only, so the app keeps the
// URL it needs and the tests get a path node can open.
import { createRequire } from "node:module";

const require = createRequire(import.meta.url);

export default require.resolve("libarchive-wasm/dist/libarchive.wasm");
