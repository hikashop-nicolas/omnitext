import { createGeoEditor, type GeoEditorHandle } from "geoedit";
import type { EditorInstance, EditorModule, EditorMountContext, HostAPI } from "../core/types";

// Thin adapter wrapping the standalone geoedit library (interactive map editor for
// GeoJSON / KML / KMZ / GPX / TopoJSON / WKT, byte-lossless in-place editing) as an
// Omnitext editor module. geoedit renders its own toolbar, panels and popups; this
// adapter just routes save/share and errors through the Omnitext host.
class GeoInstance implements EditorInstance {
  private handle: GeoEditorHandle | null = null;

  constructor(private host: HostAPI) {}

  mount(container: HTMLElement, ctx: EditorMountContext): void {
    this.handle = createGeoEditor(
      container,
      { text: ctx.text, bytes: ctx.bytes ?? undefined, filename: ctx.filename },
      {
        onChange: ctx.onChange,
        onExport: (name, bytes) => this.host.workspace.exportFile?.(name, bytes),
        onError: (message) => this.host.notifications.error(message),
      },
    );
  }

  getText(): string {
    return this.handle?.getText() ?? "";
  }

  getBytes(): Uint8Array | undefined {
    return this.handle?.getBytes();
  }

  selection(): unknown {
    return null;
  }

  focus(): void {}

  dispose(): void {
    this.handle?.destroy();
    this.handle = null;
  }
}

export const geoEditor: EditorModule = {
  create: (host) => new GeoInstance(host),
};
