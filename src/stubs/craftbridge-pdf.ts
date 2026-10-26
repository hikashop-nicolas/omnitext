// Stands in for craftbridge/pdf in builds that did not bring the engine's wasm (see
// vite.config.ts): the new PDF editor is not registered there, so none of this runs. It also
// carries the types the editor is checked against, so keep it in step with craftbridge's API.

export type Tile = [x: number, y: number, width: number, height: number];

export interface TextBlock {
  index: number;
  /** [x0, y0, x1, y1] in PDF user space. */
  rect: [number, number, number, number];
  /** The same box as displayed: points from the top-left of the page, y down. */
  view: [number, number, number, number] | null;
  text: string;
  font: string;
  size: number;
  bold: boolean;
  italic: boolean;
  color: [number, number, number];
  rotation: number;
  invisible: boolean;
}

export interface Rendered {
  width: number;
  height: number;
  rgba: Uint8Array;
  /** Why the picture is partial or approximate: "content-truncated", "colour-fallback". */
  warnings: string[];
}

export interface History {
  undo: string | null;
  redo: string | null;
}

export type ErrorCode = "needs-password" | "wrong-password" | "invalid" | "failed";

export class EngineError extends Error {
  constructor(
    readonly code: ErrorCode,
    message: string,
  ) {
    super(message);
  }
}

export interface OpenOptions {
  password?: string;
  worker?: Worker;
  workerUrl?: string | URL;
  wasmUrl?: string;
}

export declare class PdfDocument {
  readonly pageCount: number;
  readonly encrypted: boolean;
  pageSize(page: number): Promise<[number, number] | null>;
  render(page: number, scale: number, tile?: Tile): Promise<Rendered>;
  textBlocks(page: number): Promise<TextBlock[]>;
  editTextBlock(page: number, block: number, text: string): Promise<void>;
  deletePages(pages: number[]): Promise<void>;
  rotatePages(pages: number[], degrees: number): Promise<void>;
  movePages(pages: number[], to: number): Promise<void>;
  insertBlankPage(at: number, width: number, height: number): Promise<void>;
  history(): Promise<History>;
  undo(): Promise<void>;
  redo(): Promise<void>;
  save(full?: boolean): Promise<Uint8Array>;
  close(): void;
}

export async function openPdf(_bytes: Uint8Array, _options?: OpenOptions): Promise<PdfDocument> {
  throw new EngineError("failed", "the new PDF engine is not part of this build");
}
