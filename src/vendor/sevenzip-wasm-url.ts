// Test-only stand-in for `7z-wasm/7zz.wasm?url`, for the same reason as the libarchive one:
// in a browser that import is a URL to fetch, and under vitest emscripten reads it off disk.
import { createRequire } from "node:module";

const require = createRequire(import.meta.url);

export default require.resolve("7z-wasm/7zz.wasm");
