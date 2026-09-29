import "server-only";
import { extractDocx } from "./docx";
import { isBlankImage, prepareImage } from "./images";
import type { LibraryParsers } from "./indexer";
import { loadPdf } from "./pdf";

export const serverParsers: LibraryParsers = {
  loadPdf,
  extractDocx,
  prepareImage: (bytes) => prepareImage(bytes),
  isBlankImage,
};
