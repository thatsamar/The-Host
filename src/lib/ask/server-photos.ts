// Server-side counterpart of photos.ts, for photos that arrive from a
// messaging provider instead of a browser. It produces exactly what the
// browser does: a JPEG at most 1280px on its longest edge for the question,
// and a 512px copy kept for follow-ups, upright and on white. iPhone HEIC
// photos are decoded here (sharp's own HEIF support covers AVIF only).

import decodeHeic from "heic-decode";
import sharp, { type Sharp } from "sharp";
import { imageSchema } from "./images";
import type { AskImage } from "./prompt";

/** The same sizes and quality as the browser's preparePhoto. */
export const FULL_EDGE = 1280;
export const FULL_QUALITY = 80;
export const SMALL_EDGE = 512;
export const SMALL_QUALITY = 70;

/** Largest file accepted before decoding (an iPhone HEIC is usually 1 to 5 MB, a 48 MP JPEG up to about 15 MB). */
export const MAX_INPUT_BYTES = 30 * 1024 * 1024;
/** Largest image accepted, in pixels, so a crafted file can't exhaust memory (a 48 MP iPhone photo is well under). */
export const MAX_INPUT_PIXELS = 60_000_000;

export type PhotoType = "image/jpeg" | "image/png" | "image/webp" | "image/gif" | "image/heic" | "image/avif";

const HEIC_BRANDS = new Set(["heic", "heix", "hevc", "hevx", "heim", "heis", "hevm", "hevs"]);
const AVIF_BRANDS = new Set(["avif", "avis"]);

/** The photo type the bytes show, including the HEIF family iPhones use. */
export function sniffPhotoType(bytes: Uint8Array): PhotoType | undefined {
  const at = (i: number, ...values: number[]) => values.every((v, k) => bytes[i + k] === v);
  if (at(0, 0xff, 0xd8, 0xff)) return "image/jpeg";
  if (at(0, 0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a)) return "image/png";
  if (at(0, 0x47, 0x49, 0x46, 0x38)) return "image/gif";
  if (at(0, 0x52, 0x49, 0x46, 0x46) && at(8, 0x57, 0x45, 0x42, 0x50)) return "image/webp";
  if (bytes.length >= 16 && at(4, 0x66, 0x74, 0x79, 0x70)) {
    // An ISO-BMFF "ftyp" box: the major brand, then compatible brands.
    const size = Math.min(bytes.length, (bytes[0] << 24) | (bytes[1] << 16) | (bytes[2] << 8) | bytes[3]);
    const brands: string[] = [];
    for (let i = 8; i + 4 <= size; i += i === 8 ? 8 : 4) brands.push(String.fromCharCode(...bytes.subarray(i, i + 4)));
    if (brands.some((b) => AVIF_BRANDS.has(b))) return "image/avif";
    if (brands.some((b) => HEIC_BRANDS.has(b) || b === "mif1" || b === "msf1")) return "image/heic";
  }
  return undefined;
}

export type PhotoProblem = "unsupported" | "too_large" | "empty" | "unreadable";
export type PreparedServerPhoto = { ok: true; full: AskImage; small: AskImage; source: PhotoType } | { ok: false; reason: PhotoProblem };

async function heicToRaw(bytes: Uint8Array): Promise<{ data: Uint8Array; width: number; height: number }> {
  const images = await decodeHeic.all({ buffer: bytes });
  try {
    const primary = images[0];
    if (!primary) throw new Error("No image in file");
    if (primary.width * primary.height > MAX_INPUT_PIXELS) throw Object.assign(new Error("Too many pixels"), { tooLarge: true });
    // libheif applies the file's rotation and mirroring, so the pixels come out upright.
    const { data, width, height } = await primary.decode();
    return { data: new Uint8Array(data.buffer, data.byteOffset, data.byteLength), width, height };
  } finally {
    images.dispose();
  }
}

async function encode(source: () => Sharp, edge: number, quality: number): Promise<AskImage> {
  const out = await source()
    .rotate() // EXIF orientation, as the browser's imageOrientation: "from-image"
    .flatten({ background: "#ffffff" }) // transparent PNGs onto white, not black
    .resize({ width: edge, height: edge, fit: "inside", withoutEnlargement: true })
    .jpeg({ quality })
    .toBuffer();
  return { mediaType: "image/jpeg", data: out.toString("base64") };
}

/**
 * Turns a delivered photo into the website's two sizes. Accepts JPEG, PNG,
 * WebP, GIF (first frame), HEIC/HEIF and AVIF; anything else, or anything too
 * large to read safely, is refused with a reason to show.
 */
export async function prepareServerPhoto(bytes: Uint8Array): Promise<PreparedServerPhoto> {
  if (!bytes.length) return { ok: false, reason: "empty" };
  if (bytes.length > MAX_INPUT_BYTES) return { ok: false, reason: "too_large" };
  const type = sniffPhotoType(bytes);
  if (!type) return { ok: false, reason: "unsupported" };
  try {
    let source: () => Sharp;
    if (type === "image/heic") {
      const raw = await heicToRaw(bytes);
      source = () => sharp(raw.data, { raw: { width: raw.width, height: raw.height, channels: 4 } });
    } else {
      source = () => sharp(bytes, { limitInputPixels: MAX_INPUT_PIXELS, animated: false });
    }
    const full = await encode(source, FULL_EDGE, FULL_QUALITY);
    const small = await encode(source, SMALL_EDGE, SMALL_QUALITY);
    if (!imageSchema.safeParse(full).success) return { ok: false, reason: "too_large" };
    return { ok: true, full, small, source: type };
  } catch (err) {
    const message = err instanceof Error ? err.message : "";
    const tooLarge = (err as { tooLarge?: boolean }).tooLarge || /pixel limit/i.test(message);
    return { ok: false, reason: tooLarge ? "too_large" : "unreadable" };
  }
}
