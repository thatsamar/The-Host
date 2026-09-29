import "server-only";
import sharp from "sharp";

// Claude reads images best at up to ~1568px on the long edge; larger images
// are downscaled by the API anyway and cost more to send.
export const MODEL_IMAGE_MAX_EDGE = 1568;

export interface PreparedImage {
  data: Buffer;
  mediaType: "image/jpeg";
  width: number;
  height: number;
}

/**
 * Normalizes any supported image (JPEG, PNG, WebP, GIF, rendered PDF page) to
 * an upright JPEG no larger than the model's preferred size. Deterministic, so
 * the same input always yields the same bytes.
 */
export async function prepareImage(input: Buffer | Uint8Array | ArrayBuffer, maxEdge = MODEL_IMAGE_MAX_EDGE): Promise<PreparedImage> {
  const buffer = Buffer.isBuffer(input) ? input : Buffer.from(input instanceof ArrayBuffer ? new Uint8Array(input) : input);
  const { data, info } = await sharp(buffer, { animated: false, limitInputPixels: 268_402_689 })
    .rotate() // respect EXIF orientation from phone cameras
    .resize({ width: maxEdge, height: maxEdge, fit: "inside", withoutEnlargement: true })
    .flatten({ background: "#ffffff" }) // transparent PNGs onto white, not black
    .jpeg({ quality: 85, mozjpeg: true })
    .toBuffer({ resolveWithObject: true });
  return { data, mediaType: "image/jpeg", width: info.width, height: info.height };
}

/** Pixel size without decoding the whole image. */
export async function imageSize(input: Buffer): Promise<{ width: number; height: number }> {
  const meta = await sharp(input).metadata();
  return { width: meta.width ?? 0, height: meta.height ?? 0 };
}

/** True for an effectively empty page render (all one color). */
export async function isBlankImage(input: Buffer): Promise<boolean> {
  const { channels } = await sharp(input).stats();
  return channels.slice(0, 3).every((c) => c.stdev < 2);
}
