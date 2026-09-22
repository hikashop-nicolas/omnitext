/// <reference types="vite/client" />
import { describe, it, expect } from "vitest";
import { FormatRegistry } from "../core/registries";
import type { FormatDescriptor } from "../core/types";
import { makeTextFormats } from "./codemirror-formats";
import { makeViewerFormats, makeGenericViewerFormats } from "./binary-viewers";

// Content detection runs every registered format's detector and the highest score wins, so
// a check on one detector is not enough: issue #43 was fixed in json and then reappeared
// through json5. These run the whole set, as the app registers it.
const modules = import.meta.glob<Record<string, unknown>>(["./*.ts", "!./*.test.ts", "!./*.impl.ts"], { eager: true });

function allFormats(): FormatRegistry {
  const reg = new FormatRegistry();
  const seen = new Set<string>();
  const add = (f: FormatDescriptor) => {
    if (seen.has(f.manifest.id)) return;
    seen.add(f.manifest.id);
    reg.register(f);
  };
  for (const mod of Object.values(modules)) {
    for (const v of Object.values(mod)) {
      const f = v as FormatDescriptor;
      if (f && typeof f === "object" && f.manifest?.kind === "format" && typeof f.detect === "function") add(f);
    }
  }
  for (const f of [...makeTextFormats(), ...makeViewerFormats(), ...makeGenericViewerFormats()]) add(f);
  return reg;
}

const detected = (sample: string) => allFormats().detect({ sample })?.descriptor.manifest.id ?? "plain text";

describe("content detection across every format", () => {
  it("registers the formats it is meant to test", () => {
    expect(allFormats().list().length).toBeGreaterThan(40);
  });

  it("leaves a kernel log as plain text (issue #43)", () => {
    const log = [
      "[    0.000000] Booting Linux on physical CPU 0x0000000000 [0x51df805e]",
      "[    0.000000] Linux version 5.4.210 (build@host) #1 SMP PREEMPT",
      "[    0.012000] healthd: battery l=87 v=4105 t=31.2 h=2 st=3",
      "[    0.024000] Kernel command line: console=ttyMSM0,115200n8",
    ].join("\n");
    expect(detected(log)).toBe("plain text");
    expect(detected(log + "\0".repeat(200))).toBe("plain text"); // with its NUL padding
  });

  it("still detects real JSON", () => {
    expect(detected('{\n  "device": "demo",\n  "logs": [1, 2, 3]\n}')).toBe("json");
  });
});
