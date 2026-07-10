// Browser stub for jsdom, aliased in vite.config so notebookjs does not pull in the
// real ~3MB Node dependency. When bundled as ESM, notebookjs's UMD wrapper sees a
// truthy `this` without a `window`, so it takes its "Node" branch and does
// `new JSDOM().window.document`. We run in the browser, so hand it the real document.
export class JSDOM {
  window: (Window & typeof globalThis) | undefined =
    typeof window !== "undefined" ? window : undefined;
}
export default { JSDOM };
