import { describe, expect, it } from "vitest";
import { imageFromBytes, imageSchema, MAX_IMAGE_BYTES, sniffImageType } from "@/lib/ask/images";

describe("one photo check for every channel", () => {
  it("reads the type from the bytes, not the sender's label", () => {
    expect(sniffImageType(new Uint8Array([0xff, 0xd8, 0xff, 0xe0]))).toBe("image/jpeg");
    expect(sniffImageType(new Uint8Array([0x47, 0x49, 0x46, 0x38, 0x39, 0x61]))).toBe("image/gif");
    expect(sniffImageType(new Uint8Array([0x52, 0x49, 0x46, 0x46, 0, 0, 0, 0, 0x57, 0x45, 0x42, 0x50]))).toBe("image/webp");
    // HEIC, PDF, HTML: not something the advisors can read.
    expect(sniffImageType(new Uint8Array([0, 0, 0, 0x18, 0x66, 0x74, 0x79, 0x70, 0x68, 0x65, 0x69, 0x63]))).toBeUndefined();
    expect(sniffImageType(new TextEncoder().encode("%PDF-1.7"))).toBeUndefined();
  });

  it("accepts what the website accepts, and nothing larger", () => {
    const jpeg = new Uint8Array([0xff, 0xd8, 0xff, 0xe0, 1, 2, 3]);
    const ok = imageFromBytes(jpeg);
    expect(ok).toMatchObject({ ok: true, image: { mediaType: "image/jpeg" } });
    if (ok.ok) expect(imageSchema.safeParse(ok.image).success).toBe(true);
    const big = new Uint8Array(MAX_IMAGE_BYTES + 1);
    big.set([0xff, 0xd8, 0xff]);
    expect(imageFromBytes(big)).toEqual({ ok: false, reason: "too_large" });
    expect(imageFromBytes(new Uint8Array())).toEqual({ ok: false, reason: "empty" });
  });
});
