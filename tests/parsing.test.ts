import { describe, expect, it } from "vitest";
import sharp from "sharp";
import { chunkText, normalizeText } from "@/lib/library/chunk";
import { extractDocx } from "@/lib/library/docx";
import { detectFileKind, safeStorageName } from "@/lib/library/file-types";
import { isBlankImage, prepareImage } from "@/lib/library/images";
import { loadPdf } from "@/lib/library/pdf";
import { LONG_TEXT, makeDocx, makePdf, makePhoto } from "./helpers/fixtures";

describe("detectFileKind", () => {
  it("recognizes every supported type by extension, case-insensitively", () => {
    expect(detectFileKind("Ponti.PDF")?.kind).toBe("pdf");
    expect(detectFileKind("room.jpeg")?.kind).toBe("image");
    expect(detectFileKind("room.webp")?.mime).toBe("image/webp");
    expect(detectFileKind("brief.docx")?.kind).toBe("docx");
    expect(detectFileKind("notes.txt")?.kind).toBe("text");
    expect(detectFileKind("notes.md", "")?.kind).toBe("markdown");
  });

  it("falls back to the browser's MIME type and rejects everything else", () => {
    expect(detectFileKind("scan", "application/pdf")?.kind).toBe("pdf");
    expect(detectFileKind("photo.heic", "image/heic")).toBeNull();
    expect(detectFileKind("sheet.xlsx")).toBeNull();
    expect(detectFileKind("run.exe", "application/octet-stream")).toBeNull();
  });

  it("makes storage-safe names", () => {
    expect(safeStorageName("Hôtel Costes — lobby (2).jpg")).toBe("Hotel-Costes-lobby-2.jpg");
    expect(safeStorageName("../../etc/passwd")).toBe("....etcpasswd");
    expect(safeStorageName("///")).toBe("file");
  });
});

describe("chunkText", () => {
  it("keeps short text as one chunk and normalizes whitespace", () => {
    expect(chunkText("  Hello   world \r\n\r\n\r\n next  ")).toEqual(["Hello world\n\nnext"]);
    expect(chunkText("   ")).toEqual([]);
  });

  it("splits long text into overlapping chunks at natural breaks", () => {
    const sentences = Array.from({ length: 120 }, (_, i) => `Sentence number ${i} about oak, linen and lamplight.`);
    const chunks = chunkText(sentences.join(" "), 1000, 200);
    expect(chunks.length).toBeGreaterThan(5);
    for (const c of chunks) expect(c.length).toBeLessThanOrEqual(1000);
    // Every chunk ends on a sentence boundary except possibly the last.
    for (const c of chunks.slice(0, -1)) expect(c.endsWith(".")).toBe(true);
    // Consecutive chunks overlap.
    for (let i = 1; i < chunks.length; i++) {
      const tail = chunks[i - 1].slice(-60);
      expect(chunks[i].includes(tail.slice(-30))).toBe(true);
    }
    // Nothing is lost.
    const joined = chunks.join(" ");
    for (const s of sentences) expect(joined).toContain(s);
  });

  it("strips soft hyphens from PDF text", () => {
    expect(normalizeText("fur­niture")).toBe("furniture");
  });

  it("rejects an overlap as large as the chunk", () => {
    expect(() => chunkText("x".repeat(50), 10, 10)).toThrow();
  });
});

describe("images", () => {
  it("normalizes to an upright JPEG no larger than the model size", async () => {
    const big = await sharp({ create: { width: 4000, height: 3000, channels: 4, background: { r: 0, g: 0, b: 0, alpha: 0 } } })
      .png()
      .toBuffer();
    const out = await prepareImage(big);
    expect(out.mediaType).toBe("image/jpeg");
    expect(Math.max(out.width, out.height)).toBe(1568);
    const meta = await sharp(out.data).metadata();
    expect(meta.format).toBe("jpeg");
    // Transparent areas become white, not black.
    const { channels } = await sharp(out.data).stats();
    expect(channels[0].mean).toBeGreaterThan(250);
  });

  it("does not enlarge small images and is deterministic", async () => {
    const small = await makePhoto(300, 200);
    const a = await prepareImage(small);
    const b = await prepareImage(small);
    expect([a.width, a.height]).toEqual([300, 200]);
    expect(a.data.equals(b.data)).toBe(true);
  });

  it("detects blank renders", async () => {
    const white = await sharp({ create: { width: 200, height: 200, channels: 3, background: "#ffffff" } }).png().toBuffer();
    expect(await isBlankImage(white)).toBe(true);
    expect(await isBlankImage(await makePhoto(200, 200))).toBe(false);
  });
});

describe("PDF parsing", () => {
  it("extracts per-page text, counts images and renders pages", async () => {
    const pdf = await loadPdf(await makePdf());
    try {
      expect(pdf.pageCount).toBe(4);
      const p1 = await pdf.page(1);
      expect(normalizeText(p1.text)).toContain("Gio Ponti treated the chair");
      expect(p1.imageCount).toBe(0);
      const p2 = await pdf.page(2);
      expect(normalizeText(p2.text).length).toBeLessThan(200);
      expect(p2.imageCount).toBe(1);
      const png = await pdf.render(2, 800);
      const meta = await sharp(png).metadata();
      expect(meta.format).toBe("png");
      expect(Math.max(meta.width!, meta.height!)).toBeGreaterThan(700);
      expect(await isBlankImage(png)).toBe(false);
      expect(await isBlankImage(await pdf.render(3, 400))).toBe(true);
    } finally {
      await pdf.destroy();
    }
  }, 30_000);
});

describe(".docx parsing", () => {
  it("extracts body text and embedded images", async () => {
    const docx = await extractDocx(await makeDocx());
    expect(docx.text).toContain("Walnut table, rush-seat chairs");
    expect(docx.images).toHaveLength(1);
    expect(docx.images[0].contentType).toBe("image/jpeg");
  });
});

describe("fixtures", () => {
  it("long text is long enough to count as a text page", () => {
    expect(LONG_TEXT.length).toBeGreaterThan(200);
  });
});
