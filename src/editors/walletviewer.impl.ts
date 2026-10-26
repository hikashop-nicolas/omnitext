import { createWalletView, type WalletViewHandle } from "walletview";
import type { EditorInstance, EditorModule, EditorMountContext } from "../core/types";

class WalletInstance implements EditorInstance {
  private handle: WalletViewHandle | null = null;
  private root: HTMLElement | null = null;

  mount(container: HTMLElement, ctx: EditorMountContext): void {
    const root = document.createElement("div");
    root.style.cssText =
      "height:100%;--wv-canvas:var(--canvas);--wv-text:var(--text);--wv-muted:var(--muted);--wv-surface:var(--surface);--wv-border:var(--border)";
    container.appendChild(root);
    this.root = root;
    this.handle = createWalletView(root, { bytes: ctx.bytes ?? new Uint8Array(), filename: ctx.filename });
  }

  getText(): string {
    return "";
  }
  selection(): unknown {
    return null;
  }
  focus(): void {}
  dispose(): void {
    this.handle?.destroy();
    this.root?.remove();
    this.handle = null;
    this.root = null;
  }
}

export const walletViewer: EditorModule = {
  create: () => new WalletInstance(),
};
