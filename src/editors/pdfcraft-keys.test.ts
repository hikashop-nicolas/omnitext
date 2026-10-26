import { describe, expect, it } from "vitest";
import { keyLabel, shortcutFor, type KeyLike } from "./pdfcraft-keys";

const key = (k: string, mods: Partial<KeyLike> = {}): KeyLike => ({ key: k, ctrlKey: false, metaKey: false, shiftKey: false, altKey: false, ...mods });

describe("PDF editor shortcuts", () => {
  it("uses Ctrl on Windows and Linux and Cmd on a Mac", () => {
    expect(shortcutFor(key("z", { ctrlKey: true }), false)?.action).toBe("undo");
    expect(shortcutFor(key("z", { metaKey: true }), true)?.action).toBe("undo");
    expect(shortcutFor(key("z", { ctrlKey: true }), true)).toBeNull();
    expect(shortcutFor(key("Z", { ctrlKey: true, shiftKey: true }), false)?.action).toBe("redo");
    expect(shortcutFor(key("y", { ctrlKey: true }), false)?.action).toBe("redo");
  });

  it("follows Acrobat for view and find", () => {
    const ctrl = (k: string) => shortcutFor(key(k, { ctrlKey: true }), false)?.action;
    expect([ctrl("0"), ctrl("1"), ctrl("2"), ctrl("="), ctrl("-"), ctrl("f")]).toEqual(["fitPage", "actualSize", "fitWidth", "zoomIn", "zoomOut", "find"]);
    expect(shortcutFor(key("+", { ctrlKey: true, shiftKey: true }), false)?.action).toBe("zoomIn");
    expect(shortcutFor(key("N", { ctrlKey: true, shiftKey: true }), false)?.action).toBe("goToPage");
    expect(shortcutFor(key("F3"), false)?.action).toBe("findNext");
    expect(shortcutFor(key("F3", { shiftKey: true }), false)?.action).toBe("findPrevious");
  });

  it("picks a tool with a single letter, and only without modifiers", () => {
    expect(shortcutFor(key("v"), false)?.action).toBe("toolSelect");
    expect(shortcutFor(key("t"), false)?.action).toBe("toolText");
    expect(shortcutFor(key("y"), false)?.action).toBe("toolRedact");
    expect(shortcutFor(key("T", { shiftKey: true }), false)).toBeNull();
    expect(shortcutFor(key("t", { altKey: true }), false)).toBeNull();
    expect(shortcutFor(key("q"), false)).toBeNull();
  });

  it("moves, deletes and leaves with the plain keys", () => {
    expect(shortcutFor(key("ArrowLeft"), false)).toEqual({ action: "nudge", dx: -1, dy: 0 });
    expect(shortcutFor(key("ArrowDown"), false)).toEqual({ action: "nudge", dx: 0, dy: 1 });
    expect(shortcutFor(key("Delete"), false)?.action).toBe("delete");
    expect(shortcutFor(key("Escape"), false)?.action).toBe("escape");
    expect(shortcutFor(key("Home"), false)?.action).toBe("firstPage");
    expect(shortcutFor(key("?", { shiftKey: true }), false)?.action).toBe("help");
  });

  it("writes keys for the platform", () => {
    expect(keyLabel("Mod+Shift+N", false)).toBe("Ctrl+Shift+N");
    expect(keyLabel("Mod+Z", true)).toBe("⌘Z");
    expect(keyLabel("Mod+Y / Mod+Shift+Z", false)).toBe("Ctrl+Y / Ctrl+Shift+Z");
  });
});
