declare module "craftbridge/pdf/worker?worker" {
  const PdfWorker: new () => Worker;
  export default PdfWorker;
}
declare const __CRAFT_PDF__: boolean;
