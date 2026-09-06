import { describe, expect, it } from "vitest";
import { extensionOf, formatRequestUrl, REPO_URL } from "./links";

// The binary fallback offers to ask for a format Omnitext could not open. The promise
// attached to that offer is that the request carries the extension and the browser's type
// guess and nothing else, so these check what actually ends up in the URL.

describe("format request link", () => {
  it("asks about the extension on the project's own issue tracker", () => {
    const url = new URL(formatRequestUrl(".foo", "application/x-foo"));
    expect(url.origin + url.pathname).toBe(`${REPO_URL}/issues/new`);
    expect(url.searchParams.get("title")).toContain(".foo");
    expect(url.searchParams.get("body")).toContain("application/x-foo");
  });

  it("still produces a usable link for a file with no extension or type", () => {
    const url = new URL(formatRequestUrl("", undefined));
    expect(url.searchParams.get("title")).toBe("Support unknown files");
    expect(url.searchParams.get("body")).toContain("(none)");
  });
});

describe("extension of a filename", () => {
  // The point of taking the extension apart here is that the rest of the name, which is the
  // part that can be private, never reaches the link.
  it("keeps the extension and drops the name it came from", () => {
    expect(extensionOf("holiday-budget.foo")).toBe(".foo");
    const url = formatRequestUrl(extensionOf("holiday-budget.foo"));
    expect(url).toContain(".foo");
    expect(url).not.toContain("holiday-budget");
  });

  it("lowercases, takes only the last extension, and tolerates odd names", () => {
    expect(extensionOf("REPORT.FOO")).toBe(".foo");
    expect(extensionOf("archive.tar.gz")).toBe(".gz");
    expect(extensionOf("no-extension")).toBe("");
    expect(extensionOf(".hidden")).toBe(""); // a dotfile is a name, not an extension
    expect(extensionOf("")).toBe("");
  });
});
