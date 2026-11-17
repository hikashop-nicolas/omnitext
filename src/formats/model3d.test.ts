import { describe, expect, it } from "vitest";
import { model3dFormat } from "./model3d";

const bytes = (s: string): Uint8Array => Uint8Array.from(s, (c) => c.charCodeAt(0));

describe("3D model format", () => {
  it("claims .stl models whatever their header says", () => {
    expect(model3dFormat.sniffBytes!(bytes("COLOR=\xc8\xc8\xc8\xff\0\0\0\0"))).toBe(true);
    expect(model3dFormat.sniffBytes!(bytes("solid lighthouse\n"))).toBe(true);
    expect(model3dFormat.sniffBytes!(new Uint8Array(16))).toBe(true);
  });

  it("leaves Spruce subtitle .stl files to the subtitle editor", () => {
    expect(model3dFormat.sniffBytes!(bytes("00:00:01:00,00:00:03:12,Hello"))).toBe(false);
    expect(model3dFormat.sniffBytes!(bytes("$FontName = Arial\n"))).toBe(false);
    expect(model3dFormat.sniffBytes!(bytes("// Spruce subtitle file\n"))).toBe(false);
  });
});
