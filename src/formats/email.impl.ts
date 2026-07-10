import type { FormatModule, ParseResult } from "../core/types";

// .eml and .msg are opaque bytes to the format layer; the email viewer parses them
// (postal-mime for .eml, msgreader for .msg).
export const emailImpl: FormatModule = {
  parse: (text): ParseResult => ({ ok: true, model: text, diagnostics: [] }),
  serialize: (model) => String(model),
  parseBinary: (bytes): ParseResult => ({ ok: true, model: bytes, diagnostics: [] }),
  serializeBinary: (model) => model as Uint8Array,
};
