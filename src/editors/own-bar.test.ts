// @vitest-environment happy-dom
import { describe, expect, it } from "vitest";
import { adoptViewButton } from "./own-bar";

function host(): { status: HTMLElement; button: HTMLElement; slot: HTMLElement } {
  document.body.innerHTML =
    '<footer id="status"><span id="status-text"></span><button id="view-btn"></button></footer><div id="slot"></div>';
  return {
    status: document.getElementById("status")!,
    button: document.getElementById("view-btn")!,
    slot: document.getElementById("slot")!,
  };
}

describe("adoptViewButton", () => {
  it("moves the view button into the viewer's bar and hides the status bar's place", () => {
    const { button, slot } = host();
    adoptViewButton(slot);
    expect(button.parentElement).toBe(slot);
    expect(document.body.classList.contains("ot-own-bar")).toBe(true);
  });

  it("puts the button back in the status bar, last, when the viewer goes", () => {
    const { status, button, slot } = host();
    const restore = adoptViewButton(slot);
    restore();
    expect(button.parentElement).toBe(status);
    expect(status.lastElementChild).toBe(button);
    expect(document.body.classList.contains("ot-own-bar")).toBe(false);
  });

  it("still works without the button, as in a test host", () => {
    document.body.innerHTML = '<div id="slot"></div>';
    const restore = adoptViewButton(document.getElementById("slot")!);
    expect(document.body.classList.contains("ot-own-bar")).toBe(true);
    restore();
    expect(document.body.classList.contains("ot-own-bar")).toBe(false);
  });
});
