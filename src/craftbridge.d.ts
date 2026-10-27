declare module "craftbridge/pdf/worker?worker" {
  const PdfWorker: new () => Worker;
  export default PdfWorker;
}
declare module "craftbridge/deck/worker?worker" {
  const DeckWorker: new () => Worker;
  export default DeckWorker;
}
declare const __CRAFT_PDF__: boolean;
declare const __CRAFT_DECK__: boolean;
