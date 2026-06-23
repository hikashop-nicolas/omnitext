import { describe, expect, it } from "vitest";
import { makeViewerFormats, makeGenericViewerFormats, VIEWER_FORMAT_TABLE } from "./binary-viewers";

describe("binary viewer formats", () => {
  it("has unique extensions and routes each to the image or media viewer", () => {
    const seen = new Set<string>();
    for (const f of VIEWER_FORMAT_TABLE) {
      expect(["image", "media"]).toContain(f.viewer);
      for (const ext of f.exts) {
        expect(seen.has(ext), `duplicate ext ${ext}`).toBe(false);
        seen.add(ext);
      }
    }
  });

  it("builds binary descriptors whose native editor is the viewer", () => {
    const png = makeViewerFormats().find((d) => d.manifest.id === "png")!;
    expect(png.manifest.binary).toBe(true);
    expect(png.manifest.nativeEditor).toBe("image");
    expect(png.manifest.mimeTypes).toEqual(["image/png"]);
    const mp4 = makeViewerFormats().find((d) => d.manifest.id === "mp4")!;
    expect(mp4.manifest.nativeEditor).toBe("media");
  });

  it("provides extensionless generic formats for MIME-class routing", () => {
    const generic = makeGenericViewerFormats();
    const image = generic.find((d) => d.manifest.id === "image")!;
    const media = generic.find((d) => d.manifest.id === "media")!;
    expect(image.manifest.extensions).toEqual([]);
    expect(image.manifest.nativeEditor).toBe("image");
    expect(media.manifest.nativeEditor).toBe("media");
  });
});
