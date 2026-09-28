// Builds real test files in memory: a photo-like JPEG, PDFs with text,
// image-only and blank pages, and a .docx with text and an embedded image.
import sharp from "sharp";
import { Document, ImageRun, Packer, Paragraph } from "docx";
import { PDFDocument, StandardFonts } from "pdf-lib";

export async function makePhoto(width = 1200, height = 800, color = { r: 140, g: 90, b: 60 }): Promise<Buffer> {
  const svg = `<svg width="${width}" height="${height}"><circle cx="${width / 2}" cy="${height / 2}" r="${Math.min(width, height) / 3}" fill="#6b6d47"/><rect x="20" y="20" width="${width / 5}" height="${height / 6}" fill="#e2dbcf"/></svg>`;
  return sharp({ create: { width, height, channels: 3, background: color } })
    .composite([{ input: Buffer.from(svg) }])
    .jpeg({ quality: 90 })
    .toBuffer();
}

export const LONG_TEXT =
  "Gio Ponti treated the chair as a study in lightness: thin legs, a lifted seat, nothing wasted. ".repeat(12);

/**
 * Page 1: text only. Page 2: a full-page photo with a short caption.
 * Page 3: blank. Page 4: text plus a photo (mixed page).
 */
export async function makePdf(): Promise<Buffer> {
  const doc = await PDFDocument.create();
  const font = await doc.embedFont(StandardFonts.TimesRoman);
  const lines = (text: string) => text.match(/.{1,85}(\s|$)/g)!.map((l) => l.trim());
  const writeLines = (page: ReturnType<typeof doc.addPage>, text: string, top: number) =>
    lines(text).forEach((l, i) => page.drawText(l, { x: 40, y: top - i * 14, size: 11, font }));

  writeLines(doc.addPage([612, 792]), LONG_TEXT, 740);

  const photo = await doc.embedJpg(await makePhoto());
  const p2 = doc.addPage([612, 792]);
  p2.drawImage(photo, { x: 50, y: 200, width: 500, height: 333 });
  p2.drawText("Fig. 2 — Hotel Saint Cecilia lounge", { x: 50, y: 180, size: 9, font });

  doc.addPage([612, 792]);

  const p4 = doc.addPage([612, 792]);
  writeLines(p4, "Plaster walls take the late light. ".repeat(10), 740);
  p4.drawImage(photo, { x: 50, y: 150, width: 500, height: 333 });

  return Buffer.from(await doc.save());
}

export async function makeDocx(): Promise<Buffer> {
  const image = await makePhoto(800, 600, { r: 110, g: 31, b: 37 });
  const doc = new Document({
    sections: [
      {
        children: [
          new Paragraph("Dining room brief"),
          new Paragraph("Walnut table, rush-seat chairs, a low pendant at 30 inches above the top."),
          new Paragraph({ children: [new ImageRun({ type: "jpg", data: image, transformation: { width: 400, height: 300 } })] }),
        ],
      },
    ],
  });
  return Packer.toBuffer(doc);
}

/** A text-only PDF with `pages` pages, each naming its page number. */
export async function makeTextPdf(pages: number): Promise<Buffer> {
  const doc = await PDFDocument.create();
  const font = await doc.embedFont(StandardFonts.TimesRoman);
  for (let i = 1; i <= pages; i++) {
    const page = doc.addPage([612, 792]);
    const text = `Page ${i}. Limewash walls and oak floors in room ${i}. `.repeat(8);
    text.match(/.{1,85}(\s|$)/g)!.forEach((l, j) => page.drawText(l.trim(), { x: 40, y: 740 - j * 14, size: 11, font }));
  }
  return Buffer.from(await doc.save());
}
