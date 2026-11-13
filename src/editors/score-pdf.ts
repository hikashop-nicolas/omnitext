// The MusicXML read from a score PDF when it was opened, by the PDF's bytes: the score editor
// shows it instead of reading the PDF a second time.
export const pdfScoreXml = new WeakMap<ArrayBufferLike, string>();
