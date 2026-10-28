// Stands in for craftbridge/deck when the presentation engine is not part of the build (and types the editor against it for
// tsc; vite.config.ts points the real build at craftbridge itself). It mirrors craftbridge/src/deck/protocol.ts.

export type ErrorCode = "invalid" | "failed";

export class EngineError extends Error {
  constructor(
    readonly code: ErrorCode,
    message: string,
  ) {
    super(message);
  }
}

export interface LoadInfo {
  document: number;
  missingFonts: string[];
  damagedMedia: unknown[];
  lostSlides: unknown[];
}

export interface CommandInfo {
  id: string;
  label: string;
  shortcut?: string | null;
  params?: string;
}

export type Hit = { kind: string; id?: number; text?: boolean; handle?: number; index?: number; end?: number; [key: string]: unknown };

export interface SelectedShape {
  id: number;
  x: number;
  y: number;
  w: number;
  h: number;
  rot: number;
  locked: boolean;
  line: boolean;
  handles: [number, number][];
  rotate: [number, number];
  corners: [number, number][];
}

export interface TextOverlay {
  shape: number;
  caret: [[number, number], [number, number]] | null;
  rects: [number, number][][];
  anchor: [number, number];
  end: [number, number];
}

export interface Overlay {
  open: boolean;
  title?: string;
  dirty?: boolean;
  revision?: number;
  slide?: number;
  slides?: number;
  cells?: [number, number, number, number] | null;
  cellRange?: [number, number, number, number] | null;
  target?: { kind: "slides" | "master" | "layout" | "handout" | "notesMaster"; master?: number; layout?: number };
  width?: number;
  height?: number;
  selection?: SelectedShape[];
  text?: TextOverlay | null;
  canUndo?: boolean;
  canRedo?: boolean;
  missingFonts?: string[];
}

export type Tool =
  | { kind: "select" }
  | { kind: "shape"; preset: string }
  | { kind: "textBox" }
  | { kind: "ink"; mode: "pen" | "highlighter" | "eraser"; color?: unknown; width?: number };

export interface PointerEvent {
  kind: "down" | "drag" | "up" | "move" | "doubleClick" | "tripleClick" | "contextClick";
  x: number;
  y: number;
  tol?: number;
  mods?: { shift?: boolean; alt?: boolean; cmd?: boolean };
  pressure?: number | null;
}

export interface MasterInfo {
  name: string;
  layouts: { name: string }[];
}

export interface TriggerPlay {
  trigger: number;
  step: number;
  t: number;
}

export interface ShowInfo {
  steps: number;
  auto: boolean[];
  durations: number[];
  triggers?: { shape: number; steps: number; durations: number[] }[];
}

export interface Rendered {
  width: number;
  height: number;
  rgba: Uint8Array;
}

export interface OpenOptions {
  worker?: Worker;
  workerUrl?: string | URL;
  wasmUrl?: string;
}

export class DeckSession {
  load(_name: string, _bytes: Uint8Array): Promise<LoadInfo> {
    return Promise.reject(new EngineError("failed", "the presentation engine is not part of this build"));
  }
  commands(): Promise<CommandInfo[]> {
    return Promise.resolve([]);
  }
  execute<T = unknown>(_id: string, _params?: unknown): Promise<T> {
    return Promise.reject(new EngineError("failed", "the presentation engine is not part of this build"));
  }
  setTool(_tool: Tool): Promise<void> {
    return Promise.resolve();
  }
  pointer<T = unknown>(_event: PointerEvent): Promise<T> {
    return Promise.reject(new EngineError("failed", "the presentation engine is not part of this build"));
  }
  hit(_x: number, _y: number, _tol?: number): Promise<Hit | null> {
    return Promise.resolve(null);
  }
  overlay(): Promise<Overlay> {
    return Promise.resolve({ open: false });
  }
  exportPdf(_params?: unknown): Promise<Uint8Array> {
    return Promise.reject(new EngineError("failed", "the presentation engine is not part of this build"));
  }

  exportPng(_index: number, _scale: number): Promise<Uint8Array> {
    return Promise.reject(new EngineError("failed", "the presentation engine is not part of this build"));
  }

  masters(): Promise<MasterInfo[]> {
    return Promise.reject(new EngineError("failed", "the presentation engine is not part of this build"));
  }

  renderLayout(_master: number, _layout: number, _scale: number): Promise<Rendered> {
    return Promise.reject(new EngineError("failed", "the presentation engine is not part of this build"));
  }

  renderShow(_index: number, _step: number, _t: number, _plays: TriggerPlay[], _scale: number): Promise<Rendered> {
    return Promise.reject(new EngineError("failed", "the presentation engine is not part of this build"));
  }

  showInfo(_index: number): Promise<ShowInfo> {
    return Promise.reject(new EngineError("failed", "the presentation engine is not part of this build"));
  }

  renderStep(_index: number, _step: number, _t: number, _scale: number): Promise<Rendered> {
    return Promise.reject(new EngineError("failed", "the presentation engine is not part of this build"));
  }

  renderTransition(_index: number, _t: number, _scale: number): Promise<Rendered> {
    return Promise.reject(new EngineError("failed", "the presentation engine is not part of this build"));
  }

  render(_index: number, _scale: number, _edit?: boolean): Promise<Rendered> {
    return Promise.reject(new EngineError("failed", "the presentation engine is not part of this build"));
  }
  save(): Promise<Uint8Array> {
    return Promise.reject(new EngineError("failed", "the presentation engine is not part of this build"));
  }
  addFont(_bytes: Uint8Array): Promise<unknown> {
    return Promise.resolve(null);
  }
  close(): void {}
}

export function openDeck(_options: OpenOptions = {}): Promise<DeckSession> {
  return Promise.reject(new EngineError("failed", "the presentation engine is not part of this build"));
}

export const deckFontUrls = { hangul: "", hans: "" };
