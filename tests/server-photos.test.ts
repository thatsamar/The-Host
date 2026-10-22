import { readFileSync } from "node:fs";
import { describe, expect, it, vi } from "vitest";
import sharp from "sharp";
import { FULL_EDGE, SMALL_EDGE, prepareServerPhoto, sniffPhotoType } from "@/lib/ask/server-photos";
import { imageSchema } from "@/lib/ask/images";

// Decoding HEIC in WebAssembly takes a moment under a full parallel run.
vi.setConfig({ testTimeout: 30_000 });

// A 2016 x 1512 HEIC made for this test (pillow-heif), with a red block in its top-left corner.
const HEIC = new Uint8Array(readFileSync(new URL("./fixtures/iphone-photo.heic", import.meta.url)));

const bytesOf = (b64: string) => Buffer.from(b64, "base64");
const sizeOf = async (b64: string) => sharp(bytesOf(b64)).metadata();
const pixel = async (b64: string, x: number, y: number) => {
  const { data, info } = await sharp(bytesOf(b64)).raw().toBuffer({ resolveWithObject: true });
  const i = (y * info.width + x) * info.channels;
  return [data[i], data[i + 1], data[i + 2]];
};

describe("photos from a messaging provider, prepared on the server like the website's", () => {
  it("decodes an iPhone HEIC photo into the website's two JPEG sizes, upright", async () => {
    expect(sniffPhotoType(HEIC)).toBe("image/heic");
    const result = await prepareServerPhoto(HEIC);
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.source).toBe("image/heic");
    expect(result.full.mediaType).toBe("image/jpeg");
    expect(imageSchema.safeParse(result.full).success).toBe(true);
    expect(await sizeOf(result.full.data)).toMatchObject({ format: "jpeg", width: FULL_EDGE, height: 960 });
    expect(await sizeOf(result.small.data)).toMatchObject({ format: "jpeg", width: SMALL_EDGE, height: 384 });
    const [r, g, b] = await pixel(result.full.data, 20, 20);
    expect(r).toBeGreaterThan(180);
    expect(g + b).toBeLessThan(150);
  });

  it("shrinks a large photo and turns it the way its EXIF orientation says", async () => {
    // 4000 x 3000 stored sideways, with orientation 6 (rotate 90° clockwise to view).
    const sideways = await sharp({ create: { width: 4000, height: 3000, channels: 3, background: "#3366aa" } })
      .composite([{ input: { create: { width: 400, height: 300, channels: 3, background: "#ff0000" } }, left: 0, top: 0 }])
      .jpeg({ quality: 90 })
      .withMetadata({ orientation: 6 })
      .toBuffer();
    const result = await prepareServerPhoto(new Uint8Array(sideways));
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(await sizeOf(result.full.data)).toMatchObject({ width: 960, height: 1280 });
    // The red corner, top-left as stored, is top-right once upright.
    const [r] = await pixel(result.full.data, 950, 10);
    expect(r).toBeGreaterThan(180);
  });

  it("puts a transparent PNG on white and keeps small photos their own size", async () => {
    const png = await sharp({ create: { width: 300, height: 200, channels: 4, background: { r: 0, g: 0, b: 0, alpha: 0 } } }).png().toBuffer();
    const result = await prepareServerPhoto(new Uint8Array(png));
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(await sizeOf(result.full.data)).toMatchObject({ width: 300, height: 200 });
    expect(await pixel(result.full.data, 5, 5)).toEqual([255, 255, 255]);
  });

  it("refuses what isn't a photo, or is too big to read safely", async () => {
    expect(await prepareServerPhoto(new TextEncoder().encode("%PDF-1.7 not a photo"))).toEqual({ ok: false, reason: "unsupported" });
    expect(await prepareServerPhoto(new Uint8Array())).toEqual({ ok: false, reason: "empty" });
    // A broken file of a known type.
    expect(await prepareServerPhoto(new Uint8Array([0xff, 0xd8, 0xff, 0xe0, 1, 2, 3]))).toEqual({ ok: false, reason: "unreadable" });
    // A PNG header claiming 20000 x 20000 pixels.
    const huge = await sharp({ create: { width: 10, height: 10, channels: 3, background: "#000" } }).png().toBuffer();
    huge.writeUInt32BE(20000, 16);
    huge.writeUInt32BE(20000, 20);
    expect(await prepareServerPhoto(new Uint8Array(huge))).toMatchObject({ ok: false });
  });
});
