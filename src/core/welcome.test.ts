import { describe, expect, it } from "vitest";
import { welcomeWanted, type BlankStart } from "./welcome";

const blank: BlankStart = { filename: null, text: "", binary: false, formatId: null, recovered: false };

describe("when the start screen shows", () => {
  it("shows for the empty unnamed document the app starts with", () => {
    expect(welcomeWanted(blank)).toBe(true);
  });

  it("stays away from anything the user opened, created or had recovered", () => {
    expect(welcomeWanted({ ...blank, filename: "notes.txt" }), "a named file, even an empty one").toBe(false);
    expect(welcomeWanted({ ...blank, text: "draft" }), "text in it").toBe(false);
    expect(welcomeWanted({ ...blank, binary: true }), "a binary document").toBe(false);
    expect(welcomeWanted({ ...blank, formatId: "markdown" }), "a new Markdown file is a choice, not a blank start").toBe(false);
    expect(welcomeWanted({ ...blank, recovered: true }), "recovered work").toBe(false);
  });
});
