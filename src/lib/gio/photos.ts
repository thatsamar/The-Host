// Browser-side photo preparation. Phone photos are often 4000px and several
// MB; Gio sees plenty at 1280px, and a smaller copy is kept for follow-up
// questions so the conversation stays under the request size limit.

import type { AskImage } from "./prompt";

export const PHOTO_ACCEPT = "image/*";

export interface PreparedPhoto {
  /** Sent with the question the photo was attached to. */
  full: AskImage;
  /** Resent with later questions in the same visit. */
  small: AskImage;
  /** Object URL for showing the photo on the page. */
  previewUrl: string;
}

async function encode(bitmap: ImageBitmap, maxEdge: number, quality: number): Promise<Blob> {
  const scale = Math.min(1, maxEdge / Math.max(bitmap.width, bitmap.height));
  const width = Math.max(1, Math.round(bitmap.width * scale));
  const height = Math.max(1, Math.round(bitmap.height * scale));
  const canvas = document.createElement("canvas");
  canvas.width = width;
  canvas.height = height;
  const ctx = canvas.getContext("2d");
  if (!ctx) throw new Error("Couldn't prepare the photo.");
  ctx.fillStyle = "#ffffff"; // transparent PNGs onto white, not black
  ctx.fillRect(0, 0, width, height);
  ctx.drawImage(bitmap, 0, 0, width, height);
  return new Promise((resolve, reject) =>
    canvas.toBlob((blob) => (blob ? resolve(blob) : reject(new Error("Couldn't prepare the photo."))), "image/jpeg", quality),
  );
}

function toBase64(blob: Blob): Promise<string> {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => resolve(String(reader.result).split(",", 2)[1] ?? "");
    reader.onerror = () => reject(new Error("Couldn't read the photo."));
    reader.readAsDataURL(blob);
  });
}

export async function preparePhoto(file: File): Promise<PreparedPhoto> {
  let bitmap: ImageBitmap;
  try {
    bitmap = await createImageBitmap(file, { imageOrientation: "from-image" });
  } catch {
    throw new Error("This browser can't read that photo. Try a JPEG or PNG.");
  }
  try {
    const full = await encode(bitmap, 1280, 0.8);
    const small = await encode(bitmap, 512, 0.7);
    return {
      full: { mediaType: "image/jpeg", data: await toBase64(full) },
      small: { mediaType: "image/jpeg", data: await toBase64(small) },
      previewUrl: URL.createObjectURL(full),
    };
  } finally {
    bitmap.close();
  }
}
