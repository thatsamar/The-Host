import { z } from "zod";
import type { AskImage } from "./prompt";

// What a photo must be before it reaches a model, wherever it came from: the
// website sends photos the browser has already shrunk (photos.ts); a messaging
// channel hands over the bytes its provider delivered. Both end up here.

export const IMAGE_MEDIA_TYPES = ["image/jpeg", "image/png", "image/webp", "image/gif"] as const;
export type ImageMediaType = (typeof IMAGE_MEDIA_TYPES)[number];

/** Longest base64 string accepted for one photo (about 4.5 MB of image). */
export const MAX_IMAGE_BASE64_CHARS = 6_000_000;
/** The same limit in bytes, before base64 encoding. */
export const MAX_IMAGE_BYTES = Math.floor((MAX_IMAGE_BASE64_CHARS / 4) * 3);

/** One photo as the ask route accepts it. */
export const imageSchema = z.object({
  mediaType: z.enum(IMAGE_MEDIA_TYPES),
  data: z.string().min(1).max(MAX_IMAGE_BASE64_CHARS).regex(/^[A-Za-z0-9+/=]+$/),
});

/** The image type the bytes themselves show, whatever the sender called it. */
export function sniffImageType(bytes: Uint8Array): ImageMediaType | undefined {
  const at = (i: number, ...values: number[]) => values.every((v, k) => bytes[i + k] === v);
  if (at(0, 0xff, 0xd8, 0xff)) return "image/jpeg";
  if (at(0, 0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a)) return "image/png";
  if (at(0, 0x47, 0x49, 0x46, 0x38)) return "image/gif";
  if (at(0, 0x52, 0x49, 0x46, 0x46) && at(8, 0x57, 0x45, 0x42, 0x50)) return "image/webp";
  return undefined;
}

export type ImageCheck = { ok: true; image: AskImage } | { ok: false; reason: "unsupported" | "too_large" | "empty" };

/**
 * Turns delivered bytes into a photo the model can take, by the same rules as
 * the website: a supported type (read from the bytes, not trusted from the
 * sender) and within the size limit. Nothing is resized here.
 */
export function imageFromBytes(bytes: Uint8Array): ImageCheck {
  if (!bytes.length) return { ok: false, reason: "empty" };
  const mediaType = sniffImageType(bytes);
  if (!mediaType) return { ok: false, reason: "unsupported" };
  if (bytes.length > MAX_IMAGE_BYTES) return { ok: false, reason: "too_large" };
  const image = { mediaType, data: Buffer.from(bytes).toString("base64") };
  return imageSchema.safeParse(image).success ? { ok: true, image } : { ok: false, reason: "too_large" };
}
