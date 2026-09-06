// Vitest setup. The app runs in a browser; a couple of libraries assume as much at import
// time, and node has to be told.
//
// xzwasm is published as UMD and reads `self` when the module is evaluated. Every browser
// context defines it (window and workers both), so this is node missing a browser global
// rather than the library needing a shim in production. Because of that, these tests prove
// xzwasm's decoding but not that the module loads in a page: that is worth checking in a
// real browser when the xz path changes.
globalThis.self ??= globalThis as unknown as Window & typeof globalThis;
