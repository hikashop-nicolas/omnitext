import type { FormatModule, ParseResult } from "../core/types";

// A .torrent is opaque bytes to the format layer; the torrent viewer decodes the bencode.
export const torrentImpl: FormatModule = {
  parse: (text): ParseResult => ({ ok: true, model: text, diagnostics: [] }),
  serialize: (model) => String(model),
  parseBinary: (bytes): ParseResult => ({ ok: true, model: bytes, diagnostics: [] }),
  serializeBinary: (model) => model as Uint8Array,
};
