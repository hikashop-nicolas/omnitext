import { describe, expect, it } from "vitest";
import { FormatRegistry } from "../core/registries";
import { xlsxFormat } from "./xlsx";

describe(".xlsm and Excel templates", () => {
  it("open in the spreadsheet editor", () => {
    const reg = new FormatRegistry();
    reg.register(xlsxFormat);
    for (const name of ["a.xlsm", "a.xltx", "a.xltm", "A.XLSM"]) {
      expect(reg.detect({ filename: name, bytes: new Uint8Array() } as never)?.descriptor.manifest.id).toBe("xlsx");
    }
  });
});
