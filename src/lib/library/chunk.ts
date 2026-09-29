// Splits extracted text into overlapping chunks for embedding.
//
// Sizes are in characters (~4 characters per token for English): about 800
// tokens per chunk with ~100 tokens of overlap, so an idea that straddles a
// boundary is still whole in one chunk.

export const CHUNK_SIZE = 3200;
export const CHUNK_OVERLAP = 400;

export function normalizeText(text: string): string {
  return text
    .replace(/\r\n?/g, "\n")
    .replace(/­/g, "") // soft hyphens from PDFs
    .replace(/[ \t\f\v]+/g, " ")
    .replace(/ *\n */g, "\n")
    .replace(/\n{3,}/g, "\n\n")
    .trim();
}

/** Finds a natural break (paragraph, line, sentence, word) at or before `end`. */
function breakPoint(text: string, start: number, end: number): number {
  if (end >= text.length) return text.length;
  const window = text.slice(start, end);
  const minKeep = Math.floor((end - start) * 0.5);
  for (const sep of ["\n\n", "\n", ". ", "? ", "! ", "; ", ", ", " "]) {
    const at = window.lastIndexOf(sep);
    if (at >= minKeep) return start + at + sep.length;
  }
  return end;
}

export function chunkText(raw: string, size = CHUNK_SIZE, overlap = CHUNK_OVERLAP): string[] {
  if (overlap >= size) throw new Error("overlap must be smaller than size");
  const text = normalizeText(raw);
  if (!text) return [];
  if (text.length <= size) return [text];

  const chunks: string[] = [];
  let start = 0;
  while (start < text.length) {
    const end = breakPoint(text, start, start + size);
    const piece = text.slice(start, end).trim();
    if (piece) chunks.push(piece);
    if (end >= text.length) break;
    // Step back by the overlap, then forward to a word boundary.
    let next = Math.max(end - overlap, start + 1);
    const space = text.indexOf(" ", next);
    if (space !== -1 && space < end) next = space + 1;
    start = next;
  }
  return chunks;
}
