import type { FormatModule, ParseResult } from "../core/types";

// A pass is opaque bytes to the format layer; the wallet viewer unzips and draws it.
export const pkpassImpl: FormatModule = {
  parse: (text): ParseResult => ({ ok: true, model: text, diagnostics: [] }),
  serialize: (model) => String(model),
  parseBinary: (bytes): ParseResult => ({ ok: true, model: bytes, diagnostics: [] }),
  serializeBinary: (model) => model as Uint8Array,
};
