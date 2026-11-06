import { isNative } from "../core/platform";

/** The slice of a richdoc editor the fullscreen needs. */
interface Reading {
  setReadingMode(on: boolean): void;
}

/**
 * Fullscreen reading for a richdoc editor on Android: the editor's button asks, the page goes
 * fullscreen, and the editor drops its chrome and its caret until fullscreen ends.
 */
export class RichdocFullscreen {
  private wrap: HTMLElement | null = null;
  private editor: Reading | null = null;

  constructor(private container: HTMLElement) {
    if (typeof document !== "undefined") document.addEventListener("fullscreenchange", this.onChange);
  }

  /** Editor options: the button only exists where fullscreen works, which is the app. */
  options(): { onFullscreen?: () => void } {
    return isNative() && typeof document !== "undefined" && document.fullscreenEnabled ? { onFullscreen: () => void this.toggle() } : {};
  }

  attach(editor: Reading): void {
    this.editor = editor;
  }

  private toggle(): Promise<void> {
    this.wrap = this.container.querySelector<HTMLElement>(".docxedit-wrap");
    if (!this.wrap) return Promise.resolve();
    if (document.fullscreenElement === this.wrap) return document.exitFullscreen().catch(() => undefined);
    return this.wrap.requestFullscreen?.().catch(() => undefined) ?? Promise.resolve();
  }

  private onChange = (): void => {
    this.editor?.setReadingMode(!!this.wrap && document.fullscreenElement === this.wrap);
  };

  dispose(): void {
    if (typeof document === "undefined") return;
    document.removeEventListener("fullscreenchange", this.onChange);
    if (this.wrap && document.fullscreenElement === this.wrap) void document.exitFullscreen().catch(() => undefined);
    this.editor = null;
  }
}
