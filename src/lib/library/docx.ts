import "server-only";
import mammoth from "mammoth";
import { imageSize } from "./images";

export interface DocxContent {
  text: string;
  images: { data: Buffer; contentType: string }[];
}

// Icons, bullets and rules are small; skip images under this many pixels on
// their shorter edge.
const MIN_IMAGE_EDGE = 150;
export const MAX_DOCX_IMAGES = 40;

export async function extractDocx(buffer: Buffer): Promise<DocxContent> {
  const [{ value: text }, images] = await Promise.all([
    mammoth.extractRawText({ buffer }),
    (async () => {
      const found: { data: Buffer; contentType: string }[] = [];
      await mammoth.convertToHtml(
        { buffer },
        {
          convertImage: mammoth.images.imgElement(async (image) => {
            if (found.length < MAX_DOCX_IMAGES && /^image\/(jpeg|png|gif|webp)$/.test(image.contentType)) {
              const data = await image.readAsBuffer();
              const { width, height } = await imageSize(data).catch(() => ({ width: 0, height: 0 }));
              if (Math.min(width, height) >= MIN_IMAGE_EDGE) found.push({ data, contentType: image.contentType });
            }
            return { src: "" };
          }),
        },
      );
      return found;
    })(),
  ]);
  return { text, images };
}
