import "server-only";
import { definePDFJSModule, extractText, getDocumentProxy, getResolvedPDFJS, renderPageAsImage } from "unpdf";

// Page rendering needs the official PDF.js build (the legacy build runs in
// Node) plus @napi-rs/canvas.
let configured: Promise<void> | undefined;
function configure() {
  configured ??= definePDFJSModule(() => import("pdfjs-dist/legacy/build/pdf.mjs"));
  return configured;
}

export interface PdfPageInfo {
  text: string;
  imageCount: number;
  width: number;
  height: number;
}

export interface LoadedPdf {
  pageCount: number;
  page(pageNumber: number): Promise<PdfPageInfo>;
  /** Renders a page to PNG with its long edge near `targetEdge` pixels. */
  render(pageNumber: number, targetEdge?: number): Promise<Buffer>;
  destroy(): Promise<void>;
}

export async function loadPdf(bytes: Uint8Array): Promise<LoadedPdf> {
  await configure();
  // PDF.js may transfer (detach) the buffer it is given, so hand it a copy.
  const pdf = await getDocumentProxy(new Uint8Array(bytes));
  const pdfjs = await getResolvedPDFJS();
  const imageOps = new Set<number>([
    pdfjs.OPS.paintImageXObject,
    pdfjs.OPS.paintInlineImageXObject,
    pdfjs.OPS.paintImageXObjectRepeat,
  ]);
  let texts: string[] | undefined;

  return {
    pageCount: pdf.numPages,
    async page(pageNumber) {
      texts ??= (await extractText(pdf, { mergePages: false })).text;
      const page = await pdf.getPage(pageNumber);
      const ops = await page.getOperatorList();
      const viewport = page.getViewport({ scale: 1 });
      return {
        text: texts[pageNumber - 1] ?? "",
        imageCount: ops.fnArray.filter((fn: number) => imageOps.has(fn)).length,
        width: viewport.width,
        height: viewport.height,
      };
    },
    async render(pageNumber, targetEdge = 1568) {
      const page = await pdf.getPage(pageNumber);
      const viewport = page.getViewport({ scale: 1 });
      const scale = Math.min(4, Math.max(0.5, targetEdge / Math.max(viewport.width, viewport.height)));
      const png = await renderPageAsImage(pdf, pageNumber, {
        canvasImport: () => import("@napi-rs/canvas"),
        scale,
      });
      return Buffer.from(png);
    },
    async destroy() {
      await pdf.loadingTask.destroy();
    },
  };
}
