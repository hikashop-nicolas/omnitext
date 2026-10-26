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
  /** Which of the field's widgets this is (a radio group has one per button). */
  widget: number;
  /** A check box or radio button: whether this one is chosen, and what choosing it sets. */
  on?: boolean;
  export?: string | null;
  /** A choice: a drop-down (true) or a list box, and its choices as [value, label]. */
  combo?: boolean;
  options?: [string, string][];
  caption?: string | null;
}

export type FieldValue = { text: string } | { check: boolean } | { radio: string | null } | { choice: string[] };

type Rgb = [number, number, number];
type Point = [number, number];

export type CommentSpec = (
  | { type: "note"; at: Point }
  | { type: "rect"; box: Box }
  | { type: "oval"; box: Box }
  | { type: "line"; from: Point; to: Point }
  | { type: "arrow"; from: Point; to: Point }
  | { type: "ink"; strokes: Point[][] }
  | { type: "textbox"; box: Box; fontSize?: number }
  | { type: "typewriter"; box: Box; fontSize?: number }
  | { type: "mark"; box: Box; mark?: "check" | "cross" | "dot" | "line" }
  | { type: "signature"; strokes: Point[][] }
  | { type: "typedSignature"; at: Point; text: string; height?: number }
  | { type: "stamp"; box: Box; stamp: string; by?: string }
) & { contents?: string; author?: string; color?: Rgb; fill?: Rgb; width?: number; opacity?: number };

export interface StampInfo {
  name: string;
  label: string;
  group: "dynamic" | "signHere" | "business";
  size: [number, number];
  color: Rgb;
}

export type FieldType = "text" | "multiline" | "date" | "check" | "radio" | "combo" | "list" | "button";

export interface FieldSpec {
  type: FieldType;
  name?: string;
  options?: string[];
  editable?: boolean;
  multi?: boolean;
  group?: string;
  export?: string;
  caption?: string;
}

export interface FieldChange {
  name?: string;
  tooltip?: string;
  required?: boolean;
  readOnly?: boolean;
  options?: string[];
  fontSize?: number;
  caption?: string;
  /** Which widget `box` and `caption` apply to (default the first). */
  widget?: number;
  /** Moves and resizes the field: displayed points from the page's top-left. */
  box?: Box;
}

export interface ProtectSpec {
  open?: string;
  owner?: string;
  printing?: "none" | "low" | "high";
  changes?: "none" | "pages" | "fill" | "comment" | "any";
  copy?: boolean;
  accessibility?: boolean;
}

export interface LayerInfo {
  index: number;
  name: string;
  visible: boolean;
}

export interface SignatureInfo {
  field: string;
  signed: boolean;
  signer: string | null;
  date: string | null;
  reason: string | null;
  page: number | null;
  summary: string;
  status: string;
}

export interface SignSpec {
  page?: number;
  box?: Box;
  field?: string;
  name?: string;
  reason?: string;
  location?: string;
  contact?: string;
  certify?: 1 | 2 | 3;
}

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
  | { op: "addAnnotation"; page: number; spec: CommentSpec }
  | { op: "setAnnotationContents"; page: number; index: number; text: string }
  | { op: "addField"; page: number; view: Box; spec: FieldSpec }
  | { op: "deleteField"; name: string }
  | { op: "deleteFieldWidget"; name: string; widget: number }
  | { op: "setFieldProps"; name: string; change: FieldChange }
  | { op: "setFieldActions"; name: string; actions: FieldActionInfo[] }
  | { op: "runAction"; action: FieldAction; target?: string }
  | { op: "setFieldScript"; name: string; event: ScriptEvent; script: string }
  | { op: "addRedaction"; page: number; boxes: Box[]; overlay?: string }
  | { op: "applyRedactions" }
  | { op: "clearRedactions" }
  | { op: "removeHidden"; ids: string[] }
  | { op: "addWatermark"; spec: WatermarkSpec; picture?: { name: string; bytes: Uint8Array } }
  | { op: "addHeaderFooter"; spec: HeaderFooterSpec }
  | { op: "addBackground"; spec: BackgroundSpec; picture?: { name: string; bytes: Uint8Array } }
  | { op: "removeMarks"; kind: MarkKind }
  | { op: "addBookmark"; parent: number[]; index: number; title: string; page: number }
  | { op: "renameBookmark"; path: number[]; title: string }
  | { op: "deleteBookmark"; path: number[] }
  | { op: "moveBookmark"; from: number[]; toParent: number[]; index: number }
  | { op: "setBookmarkPage"; path: number[]; page: number }
  | { op: "addAttachment"; name: string; bytes: Uint8Array; description?: string }
  | { op: "deleteAttachment"; key: string }
  | { op: "protect"; spec: ProtectSpec }
  | { op: "removeProtection" }
  | { op: "addPictureStamp"; page: number; view: Box; name: string; bytes: Uint8Array }
  | { op: "flattenFillSign" }
  | { op: "undo" }
  | { op: "redo" };

export type ActionTrigger = "mouse_up" | "mouse_down" | "mouse_enter" | "mouse_exit" | "on_focus" | "on_blur";

export type FieldAction =
  | { kind: "javascript"; script: string }
  | { kind: "uri"; url: string }
  | { kind: "reset"; fields: string[] }
  | { kind: "named"; name: string }
  | { kind: "goto"; page: number }
  | { kind: "showhide"; fields: string[]; hide: boolean }
  | { kind: "submit"; url: string }
  | { kind: "other"; text: string };

export type FieldActionInfo = FieldAction & { trigger: ActionTrigger };

export type JsRequest =
  | { type: "print" }
  | { type: "goto"; page: number }
  | { type: "url"; url: string }
  | { type: "submit"; url: string }
  | { type: "named"; name: string }
  | { type: "reset"; fields: string[] }
  | { type: "focus"; field: string }
  | { type: "beep" }
  | { type: "saveAs" }
  | { type: "panel"; panel: string };

export interface JsOutput {
  alerts: string[];
  console: string[];
  requests: JsRequest[];
  errors: string[];
  result?: string | null;
}

export interface HiddenInfo {
  id: string;
  count: number;
}

export interface WatermarkSpec {
  text?: string;
  size?: number;
  color?: [number, number, number];
  opacity?: number;
  rotation?: number;
  behind?: boolean;
  scale?: number;
  pages?: number[];
}

export interface HeaderFooterSpec {
  text: [string, string, string, string, string, string];
  size?: number;
  color?: [number, number, number];
  margins?: [number, number, number, number];
  start?: number;
  shrink?: boolean;
  pages?: number[];
}

export interface BackgroundSpec {
  color?: [number, number, number];
  opacity?: number;
  scale?: number;
  pages?: number[];
}

export type MarkKind = "headerFooter" | "watermark" | "background";

export interface BookmarkInfo {
  path: number[];
  title: string;
  page: number | null;
  open: boolean;
  bold: boolean;
  italic: boolean;
}

export interface AttachmentInfo {
  index: number;
  name: string;
  description: string | null;
  size: number | null;
  where: "document" | "page";
  key?: string;
  page?: number;
}

export type ScriptEvent = "keystroke" | "format" | "validate" | "calculate";

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
  addAnnotation(page: number, spec: CommentSpec): Promise<void>;
  setAnnotationContents(page: number, index: number, text: string): Promise<void>;
  stamps(): Promise<StampInfo[]>;
  addField(page: number, view: Box, spec: FieldSpec): Promise<void>;
  deleteField(name: string): Promise<void>;
  deleteFieldWidget(name: string, widget: number): Promise<void>;
  setFieldProps(name: string, change: FieldChange): Promise<void>;
  fieldActions(name: string): Promise<FieldActionInfo[]>;
  setFieldActions(name: string, actions: FieldActionInfo[]): Promise<void>;
  runAction(action: FieldAction, target?: string): Promise<JsOutput>;
  takeJsOutput(): Promise<JsOutput>;
  fieldScripts(name: string): Promise<Partial<Record<ScriptEvent, string>>>;
  setFieldScript(name: string, event: ScriptEvent, script: string): Promise<void>;
  addRedaction(page: number, boxes: Box[], overlay?: string): Promise<void>;
  redactionCount(): Promise<number>;
  applyRedactions(): Promise<void>;
  clearRedactions(): Promise<void>;
  hiddenInfo(): Promise<HiddenInfo[]>;
  removeHidden(ids: string[]): Promise<void>;
  addWatermark(spec: WatermarkSpec, picture?: { name: string; bytes: Uint8Array }): Promise<void>;
  addHeaderFooter(spec: HeaderFooterSpec): Promise<void>;
  addBackground(spec: BackgroundSpec, picture?: { name: string; bytes: Uint8Array }): Promise<void>;
  removeMarks(kind: MarkKind): Promise<void>;
  bookmarks(): Promise<BookmarkInfo[]>;
  addBookmark(parent: number[], index: number, title: string, page: number): Promise<void>;
  renameBookmark(path: number[], title: string): Promise<void>;
  deleteBookmark(path: number[]): Promise<void>;
  moveBookmark(from: number[], toParent: number[], index: number): Promise<void>;
  setBookmarkPage(path: number[], page: number): Promise<void>;
  attachments(): Promise<AttachmentInfo[]>;
  addAttachment(name: string, bytes: Uint8Array, description?: string): Promise<void>;
  deleteAttachment(key: string): Promise<void>;
  attachmentBytes(index: number): Promise<Uint8Array>;
  protect(spec: ProtectSpec): Promise<void>;
  removeProtection(): Promise<void>;
  layers(): Promise<LayerInfo[]>;
  setLayerVisible(index: number, visible: boolean): Promise<boolean>;
  addPictureStamp(page: number, view: Box, name: string, bytes: Uint8Array): Promise<void>;
  flattenFillSign(): Promise<void>;
  signatures(): Promise<SignatureInfo[]>;
  signWithCertificate(p12: Uint8Array, password: string, spec?: SignSpec): Promise<Uint8Array>;
  createDigitalId(name: string, organisation: string, email: string, password: string, years?: number): Promise<Uint8Array>;
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
