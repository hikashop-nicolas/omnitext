import { describe, it, expect } from "vitest";
import { convertKind, kindOf } from "./tree.impl";

describe("tree editor: value / list / object conversion", () => {
  it("wraps a value into a list or an object, keeping it", () => {
    expect(convertKind("demo", "list")).toEqual({ value: ["demo"] });
    expect(convertKind(42, "object")).toEqual({ value: { field: 42 } });
    expect(convertKind("", "list")).toEqual({ value: [] }); // a fresh "+ item" becomes an empty list
  });

  it("unwraps only when nothing is lost", () => {
    expect(convertKind([], "value")).toEqual({ value: "" });
    expect(convertKind(["only"], "value")).toEqual({ value: "only" });
    expect(convertKind([1, 2], "value")).toBeNull();
    expect(convertKind([{ a: 1 }], "value")).toBeNull();
  });

  it("turns a list into an object by index, but not an object into a list", () => {
    expect(convertKind(["a", "b"], "object")).toEqual({ value: { 0: "a", 1: "b" } });
    expect(convertKind({ a: 1 }, "list")).toBeNull(); // the key "a" would be lost
    expect(convertKind({}, "list")).toEqual({ value: [] });
  });

  it("names kinds", () => {
    expect([kindOf("x"), kindOf(null), kindOf([]), kindOf({})]).toEqual(["value", "value", "list", "object"]);
  });
});
