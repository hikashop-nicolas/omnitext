import type { FormatDescriptor, FormatModule } from "../core/types";

// Binary "viewer" formats: images and audio/video that the WebView can render natively.
// Each is a binary format whose native editor is the read-only image/media viewer. The
// document's MIME flows to the viewer (via the mount context) so it builds the right blob.
//
// SVG is intentionally NOT here: it is editable XML, handled by the xml text format.

interface ViewerFormat {
  id: string;
  exts: string[];
  mime: string;
  viewer: "image" | "media" | "archive";
}

const VIEWER_FORMATS: ViewerFormat[] = [
  // Images (browser-renderable raster + vector-as-raster)
  { id: "png", exts: [".png", ".apng"], mime: "image/png", viewer: "image" },
  { id: "jpeg", exts: [".jpg", ".jpeg", ".jfif", ".pjpeg"], mime: "image/jpeg", viewer: "image" },
  { id: "gif", exts: [".gif"], mime: "image/gif", viewer: "image" },
  { id: "webp", exts: [".webp"], mime: "image/webp", viewer: "image" },
  { id: "avif", exts: [".avif"], mime: "image/avif", viewer: "image" },
  { id: "bmp", exts: [".bmp"], mime: "image/bmp", viewer: "image" },
  { id: "icon", exts: [".ico"], mime: "image/x-icon", viewer: "image" },
  // Video
  { id: "mp4", exts: [".mp4", ".m4v"], mime: "video/mp4", viewer: "media" },
  { id: "webmv", exts: [".webm"], mime: "video/webm", viewer: "media" },
  { id: "ogv", exts: [".ogv"], mime: "video/ogg", viewer: "media" },
  { id: "mov", exts: [".mov"], mime: "video/quicktime", viewer: "media" },
  // Audio
  { id: "mp3", exts: [".mp3"], mime: "audio/mpeg", viewer: "media" },
  { id: "wav", exts: [".wav"], mime: "audio/wav", viewer: "media" },
  { id: "oga", exts: [".ogg", ".oga", ".opus"], mime: "audio/ogg", viewer: "media" },
  { id: "m4a", exts: [".m4a", ".aac"], mime: "audio/mp4", viewer: "media" },
  { id: "flac", exts: [".flac"], mime: "audio/flac", viewer: "media" },
  // Archives (zip-based; docx/xlsx/odt/ods are also zips but have dedicated editors)
  { id: "zip", exts: [".zip"], mime: "application/zip", viewer: "archive" },
  { id: "jar", exts: [".jar"], mime: "application/java-archive", viewer: "archive" },
  { id: "cbz", exts: [".cbz"], mime: "application/vnd.comicbook+zip", viewer: "archive" },
];

const viewerModule = (): FormatModule => ({
  // Binary viewers do not transform content; the editor reads ctx.bytes directly.
  parse: (text) => ({ ok: true, model: text, diagnostics: [] }),
  serialize: (model) => String(model),
});

function descriptor(id: string, exts: string[], mime: string, viewer: string): FormatDescriptor {
  return {
    manifest: {
      kind: "format",
      id,
      extensions: exts,
      mimeTypes: [mime],
      binary: true,
      nativeEditor: viewer,
    },
    detect: () => 0,
    load: () => Promise.resolve(viewerModule()),
  };
}

/** Per-type image/media formats (nice labels + extension routing + "Open with"). */
export function makeViewerFormats(): FormatDescriptor[] {
  return VIEWER_FORMATS.map((f) => descriptor(f.id, f.exts, f.mime, f.viewer));
}

/**
 * Generic formats with no extensions, used for MIME-class routing when an extension is
 * unknown but the OS reports image/*, video/* or audio/*. Routed to explicitly by id.
 */
export const GENERIC_IMAGE = "image";
export const GENERIC_MEDIA = "media";
export const GENERIC_ARCHIVE = "archive";
export function makeGenericViewerFormats(): FormatDescriptor[] {
  return [
    descriptor(GENERIC_IMAGE, [], "", "image"),
    descriptor(GENERIC_MEDIA, [], "", "media"),
    descriptor(GENERIC_ARCHIVE, [], "", "archive"),
  ];
}

export const VIEWER_FORMAT_TABLE = VIEWER_FORMATS;
