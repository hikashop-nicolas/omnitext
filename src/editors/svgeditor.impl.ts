import type { EditorInstance, EditorModule, EditorMountContext } from "../core/types";

// WYSIWYG SVG vector editor: embeds svgedit (served from public/svgedit/) in a same-origin
// iframe and bridges over postMessage. svgedit runs with its own relative asset/locale
// resolution, so no bundler/asset-path wiring is needed. The latest SVG is cached from the
// iframe's "changed" messages, so getText() (used for Save and view switching) is current.

class SvgEditorInstance implements EditorInstance {
  private iframe: HTMLIFrameElement | null = null;
  private latest = "";
  private onChange: (() => void) | null = null;
  private handler: ((e: MessageEvent) => void) | null = null;

  mount(container: HTMLElement, ctx: EditorMountContext): void {
    this.latest = ctx.text;
    this.onChange = ctx.onChange;
    const iframe = document.createElement("iframe");
    iframe.src = "svgedit/omni.html"; // public/svgedit/, served at the app origin
    iframe.style.cssText = "width:100%;height:100%;border:0;display:block;background:#fff;";

    this.handler = (e: MessageEvent) => {
      if (e.source !== iframe.contentWindow) return; // only our iframe
      const m = e.data as { type?: string; svg?: string };
      if (m.type === "inited") {
        iframe.contentWindow?.postMessage({ type: "load", svg: ctx.text }, "*");
      } else if (m.type === "changed" && typeof m.svg === "string") {
        const changed = m.svg !== this.latest;
        this.latest = m.svg;
        if (changed) this.onChange?.();
      } else if (m.type === "svg" && typeof m.svg === "string") {
        this.latest = m.svg;
      }
    };
    window.addEventListener("message", this.handler);
    container.appendChild(iframe);
    this.iframe = iframe;
  }

  getText(): string {
    return this.latest;
  }

  selection(): unknown {
    return null;
  }

  focus(): void {
    this.iframe?.contentWindow?.focus();
  }

  dispose(): void {
    if (this.handler) window.removeEventListener("message", this.handler);
    this.handler = null;
    this.iframe?.remove();
    this.iframe = null;
  }
}

export const svgEditor: EditorModule = {
  create: () => new SvgEditorInstance(),
};
