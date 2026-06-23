import { parse, HtmlGenerator } from "latex.js";
import type { EditorInstance, EditorModule, EditorMountContext } from "../core/types";

// Read-only LaTeX preview: renders the .tex source to HTML with latex.js (a faithful
// subset, no PDF, no arbitrary packages) inside a shadow root so its stylesheet does not
// leak into the app. The stylesheet + KaTeX woff2 fonts are served from public/latexjs/
// (see scripts/copy-latex-assets.mjs); Computer Modern body fonts are omitted, so body
// text falls back to a system serif while math renders correctly.

class LatexPreviewInstance implements EditorInstance {
  private text = "";
  private host: HTMLElement | null = null;

  mount(container: HTMLElement, ctx: EditorMountContext): void {
    this.text = ctx.text;
    const host = document.createElement("div");
    host.style.cssText = "height:100%;overflow:auto;background:#fff;";
    const root = host.attachShadow({ mode: "open" });

    const style = document.createElement("style");
    style.textContent =
      ".latex-body{max-width:760px;margin:0 auto;padding:32px 28px;color:#111;}" +
      ".latex-err{color:#b00;font:13px/1.5 ui-monospace,Menlo,monospace;padding:20px;white-space:pre-wrap;}";
    root.append(style, link("latexjs/css/article.css"), link("latexjs/css/katex.css"));

    const body = document.createElement("div");
    body.className = "latex-body";
    try {
      const generator = parse(ctx.text, { generator: new HtmlGenerator({ hyphenate: false }) });
      body.appendChild(generator.domFragment());
    } catch (e) {
      body.className = "latex-err";
      body.textContent = "LaTeX preview error:\n" + ((e as Error)?.message ?? String(e));
    }
    root.appendChild(body);
    container.appendChild(host);
    this.host = host;
  }

  getText(): string {
    return this.text; // read-only
  }

  selection(): unknown {
    return null;
  }

  focus(): void {
    this.host?.focus?.();
  }

  dispose(): void {
    this.host?.remove();
    this.host = null;
  }
}

function link(href: string): HTMLLinkElement {
  const l = document.createElement("link");
  l.rel = "stylesheet";
  l.href = href;
  return l;
}

export const latexPreviewEditor: EditorModule = {
  create: () => new LatexPreviewInstance(),
};
