import { afterEach, describe, expect, it, vi } from "vitest";
import { openExternal, openingExternal } from "./external";

describe("openExternal", () => {
  afterEach(() => vi.unstubAllGlobals());

  it("opens web and mail addresses in a new, detached window and says so while it does", () => {
    const open = vi.fn();
    vi.stubGlobal("window", { open });
    expect(openingExternal()).toBe(false);
    openExternal("https://example.com/a");
    openExternal("mailto:someone@example.com");
    expect(open).toHaveBeenNthCalledWith(1, "https://example.com/a", "_blank", "noopener,noreferrer");
    expect(open).toHaveBeenNthCalledWith(2, "mailto:someone@example.com", "_blank", "noopener,noreferrer");
    expect(openingExternal()).toBe(true);
  });

  it("ignores anything else", () => {
    const open = vi.fn();
    vi.stubGlobal("window", { open });
    for (const bad of ["javascript:alert(1)", "file:///etc/passwd", "data:text/html,x", "ftp://x", ""]) openExternal(bad);
    expect(open).not.toHaveBeenCalled();
  });
});
