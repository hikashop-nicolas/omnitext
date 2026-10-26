// Keyboard shortcuts of the PDF editor, after Adobe Acrobat's: Ctrl/Cmd combinations for view, find and
// editing, and single letters for the tools. The page decides when they apply (not while typing, not
// under a dialog); this only reads a key press.

export type Action =
  | "undo" | "redo" | "find" | "findNext" | "findPrevious"
  | "zoomIn" | "zoomOut" | "fitPage" | "fitWidth" | "actualSize"
  | "firstPage" | "lastPage" | "previousPage" | "nextPage" | "goToPage"
  | "toolSelect" | "toolText" | "toolRedact" | "toolNote" | "toolTextBox" | "toolPen" | "toolStamp" | "toolHighlight" | "toolField"
  | "delete" | "escape" | "bold" | "italic" | "copy" | "nudge"
  | "blankPage" | "deletePage" | "appendPdf" | "help";

export interface Shortcut {
  action: Action;
  /** For "nudge": the direction, one step. */
  dx?: number;
  dy?: number;
}

export interface KeyLike {
  key: string;
  ctrlKey: boolean;
  metaKey: boolean;
  shiftKey: boolean;
  altKey: boolean;
}

const LETTER_TOOLS: Record<string, Action> = {
  v: "toolSelect",
  t: "toolText",
  y: "toolRedact",
  s: "toolNote",
  x: "toolTextBox",
  d: "toolPen",
  k: "toolStamp",
  u: "toolHighlight",
  f: "toolField",
};

/** What a key press means, or null. `mac` makes Cmd the command key, else Ctrl. */
export function shortcutFor(e: KeyLike, mac: boolean): Shortcut | null {
  const mod = mac ? e.metaKey : e.ctrlKey;
  const other = mac ? e.ctrlKey : e.metaKey;
  if (other || e.altKey) return null;
  const k = e.key.length === 1 ? e.key.toLowerCase() : e.key;
  if (mod) {
    if (e.shiftKey) {
      if (k === "z") return { action: "redo" };
      if (k === "n") return { action: "goToPage" };
      if (k === "t") return { action: "blankPage" };
      if (k === "d") return { action: "deletePage" };
      if (k === "i") return { action: "appendPdf" };
      if (k === "g" && mac) return { action: "findPrevious" };
      // zooming in is Ctrl and the plus sign, which needs Shift on most keyboards
      if (k === "+" || k === "=") return { action: "zoomIn" };
      return null;
    }
    if (k === "z") return { action: "undo" };
    if (k === "y" && !mac) return { action: "redo" };
    if (k === "f") return { action: "find" };
    if (k === "g" && mac) return { action: "findNext" };
    if (k === "=" || k === "+") return { action: "zoomIn" };
    if (k === "-" || k === "_") return { action: "zoomOut" };
    if (k === "0") return { action: "fitPage" };
    if (k === "1") return { action: "actualSize" };
    if (k === "2") return { action: "fitWidth" };
    if (k === "b") return { action: "bold" };
    if (k === "i") return { action: "italic" };
    if (k === "c") return { action: "copy" };
    return null;
  }
  if (k === "F3") return { action: e.shiftKey ? "findPrevious" : "findNext" };
  if (k === "F1" || k === "?") return { action: "help" };
  if (k === "Escape") return { action: "escape" };
  if (k === "Delete" || k === "Backspace") return { action: "delete" };
  if (k === "Home") return { action: "firstPage" };
  if (k === "End") return { action: "lastPage" };
  if (k === "ArrowLeft") return { action: "nudge", dx: -1, dy: 0 };
  if (k === "ArrowRight") return { action: "nudge", dx: 1, dy: 0 };
  if (k === "ArrowUp") return { action: "nudge", dx: 0, dy: -1 };
  if (k === "ArrowDown") return { action: "nudge", dx: 0, dy: 1 };
  if (!e.shiftKey && LETTER_TOOLS[k]) return { action: LETTER_TOOLS[k]! };
  return null;
}

/** A shortcut as it is written on a button or in the list: "Mod+Z" is Cmd+Z on a Mac, else Ctrl+Z. */
export function keyLabel(spec: string, mac: boolean): string {
  return spec
    .split(" / ")
    .map((part) => (mac ? part.replace("Mod+", "⌘").replace("Shift+", "⇧") : part.replace("Mod+", "Ctrl+")))
    .join(" / ");
}

export const isMac = (): boolean => typeof navigator !== "undefined" && /mac|iphone|ipad/i.test(navigator.platform || navigator.userAgent);

/** The list the help dialog shows: the label key under "pdfcraft." and the keys. */
export const SHORTCUT_LIST: [labelKey: string, keys: string][] = [
  ["undo", "Mod+Z"],
  ["redo", "Mod+Y / Mod+Shift+Z"],
  ["find", "Mod+F"],
  ["findNext", "F3"],
  ["findPrevious", "Shift+F3"],
  ["zoomIn", "Mod++"],
  ["zoomOut", "Mod+-"],
  ["fitPage", "Mod+0"],
  ["actualSize", "Mod+1"],
  ["fit", "Mod+2"],
  ["firstPage", "Home"],
  ["lastPage", "End"],
  ["previousPage", "←"],
  ["nextPage", "→"],
  ["goToPage", "Mod+Shift+N"],
  ["select", "V"],
  ["addText", "T"],
  ["selectText", "U"],
  ["note", "S"],
  ["textbox", "X"],
  ["pen", "D"],
  ["stamp", "K"],
  ["fieldText", "F"],
  ["redactArea", "Y"],
  ["bold", "Mod+B"],
  ["italic", "Mod+I"],
  ["copy", "Mod+C"],
  ["nudge", "← ↑ → ↓"],
  ["deleteSelection", "Delete"],
  ["addBlank", "Mod+Shift+T"],
  ["deletePage", "Mod+Shift+D"],
  ["appendPdf", "Mod+Shift+I"],
  ["shortcuts", "F1 / ?"],
];
