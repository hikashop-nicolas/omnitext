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

export type ObjectKind = "text" | "image" | "added";
export type Box = [x0: number, y0: number, x1: number, y1: number];

export interface TextStyle {
  family?: "helvetica" | "times" | "courier";
  bold?: boolean;
  italic?: boolean;
  size?: number;
  color?: [number, number, number];
  align?: "left" | "center" | "right" | "justify";
}

export interface ObjectRef {
  kind: ObjectKind;
  index: number;
}

export interface PageObject {
  kind: ObjectKind;
  index: number;
  type: "text" | "image" | "form";
  text: string | null;
  /** Where it is drawn: points from the page's top-left, y down. */
  view: Box;
  style: (Required<Omit<TextStyle, "align">> & { align: TextStyle["align"] | null }) | null;
}

export interface FindMatch {
  page: number;
  text: string;
  rects: Box[];
}

export interface TextSelection {
  text: string;
  rects: Box[];
}

export type MarkupKind = "highlight" | "underline" | "strikeout";

export interface LinkInfo {
  index: number;
  view: Box;
  uri?: string;
  page?: number;
}

export interface AnnotationInfo {
  index: number;
  subtype: string;
  contents: string | null;
  view: Box;
}

export type FieldKind = "text" | "check" | "radio" | "button" | "choice" | "signature";

export interface FieldInfo {
  name: string;
  kind: FieldKind;
  value: string | null;
  view: Box;
}

export type FieldValue = { text: string } | { check: boolean } | { choice: string[] };

export interface Rendered {
  width: number;
  height: number;
  rgba: Uint8Array;
  /** Why the picture is partial or approximate: "content-truncated", "colour-fallback". */
  warnings: string[];
}

/** The calls that change the document: the ones a session records and replays. */
export type EditCall =
  | { op: "editTextBlock"; page: number; block: number; text: string }
  | { op: "deletePages"; pages: number[] }
  | { op: "rotatePages"; pages: number[]; degrees: number }
  | { op: "movePages"; pages: number[]; to: number }
  | { op: "insertBlankPage"; at: number; width: number; height: number }
  | { op: "insertPagesFrom"; name: string; bytes: Uint8Array; at: number }
  | { op: "moveObjects"; page: number; targets: ObjectRef[]; dx: number; dy: number }
  | { op: "resizeObject"; page: number; target: ObjectRef; view: Box }
  | { op: "rotateObject"; page: number; target: ObjectRef; quarterTurns: number }
  | { op: "addText"; page: number; view: Box; text: string; style?: TextStyle }
  | { op: "addImage"; page: number; name: string; bytes: Uint8Array; view?: Box }
  | { op: "deleteObject"; page: number; target: ObjectRef }
  | { op: "setText"; page: number; target: ObjectRef; text?: string; style?: TextStyle }
  | { op: "cover"; page: number; view: Box }
  | { op: "markup"; page: number; kind: MarkupKind; rects: Box[]; color?: [number, number, number] }
  | { op: "addLink"; page: number; view: Box; target: string }
  | { op: "deleteLink"; page: number; index: number }
  | { op: "deleteAnnotation"; page: number; index: number }
  | { op: "setField"; name: string; value: FieldValue }
  | { op: "undo" }
  | { op: "redo" };

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
  objects(page: number): Promise<PageObject[]>;
  moveObjects(page: number, targets: ObjectRef[], dx: number, dy: number): Promise<void>;
  resizeObject(page: number, target: ObjectRef, view: Box): Promise<void>;
  rotateObject(page: number, target: ObjectRef, quarterTurns: number): Promise<void>;
  addText(page: number, view: Box, text: string, style?: TextStyle): Promise<void>;
  addImage(page: number, name: string, bytes: Uint8Array, view?: Box): Promise<void>;
  deleteObject(page: number, target: ObjectRef): Promise<void>;
  setText(page: number, target: ObjectRef, text?: string, style?: TextStyle): Promise<void>;
  cover(page: number, view: Box): Promise<void>;
  execute(call: EditCall): Promise<void>;
  find(query: string, options?: { caseSensitive?: boolean; wholeWords?: boolean; limit?: number }): Promise<FindMatch[]>;
  selectText(page: number, from: [number, number], to: [number, number]): Promise<TextSelection>;
  markup(page: number, kind: MarkupKind, rects: Box[], color?: [number, number, number]): Promise<void>;
  addLink(page: number, view: Box, target: string): Promise<void>;
  links(page: number): Promise<LinkInfo[]>;
  deleteLink(page: number, index: number): Promise<void>;
  annotations(page: number): Promise<AnnotationInfo[]>;
  deleteAnnotation(page: number, index: number): Promise<void>;
  fields(page: number): Promise<FieldInfo[]>;
  setField(name: string, value: FieldValue): Promise<void>;
  editTextBlock(page: number, block: number, text: string): Promise<void>;
  deletePages(pages: number[]): Promise<void>;
  rotatePages(pages: number[], degrees: number): Promise<void>;
  movePages(pages: number[], to: number): Promise<void>;
  insertPagesFrom(name: string, bytes: Uint8Array, at: number): Promise<void>;
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
