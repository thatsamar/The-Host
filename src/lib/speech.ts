/**
 * Reading an answer aloud with the browser's own voice (Web Speech API):
 * nothing leaves the device and nothing is paid for. These helpers turn an
 * answer's Markdown into plain sentences a voice can read.
 */

/** Some browsers stop a single long utterance partway, so read in pieces of at most this many characters. */
export const MAX_SPOKEN_CHUNK = 220;

/** The words of a Markdown answer, without the symbols a voice would read out. */
export function speakableText(markdown: string): string {
  return (
    markdown
      // Code blocks and inline code: keep the words, drop the fences and ticks.
      .replace(/```[^\n]*\n?/g, "")
      .replace(/`([^`]*)`/g, "$1")
      // Images and links: keep the label, never read the address.
      .replace(/!\[([^\]]*)\]\([^)]*\)/g, "$1")
      .replace(/\[([^\]]+)\]\([^)]*\)/g, "$1")
      .replace(/https?:\/\/\S+/g, "")
      // Table rules and cell bars.
      .replace(/^\s*\|?\s*:?-{2,}:?\s*(\|\s*:?-{2,}:?\s*)*\|?\s*$/gm, "")
      .replace(/^[ \t]*\|/gm, "")
      .replace(/\|[ \t]*$/gm, "")
      .replace(/[ \t]*\|[ \t]*/g, ", ")
      // Headings, quotes, list markers and horizontal rules.
      .replace(/^\s{0,3}#{1,6}\s+/gm, "")
      .replace(/^\s*>\s?/gm, "")
      .replace(/^\s*(?:[-*_]\s*){3,}$/gm, "")
      .replace(/^\s*(?:[-*+]|\d+[.)])\s+/gm, "")
      // Emphasis and strikethrough.
      .replace(/(\*\*|__)(.+?)\1/g, "$2")
      .replace(/\*(.+?)\*/g, "$1")
      .replace(/(?<!\w)_(.+?)_(?!\w)/g, "$1")
      .replace(/~~(.+?)~~/g, "$1")
      // A heading or list item with no closing stop still deserves a pause.
      .split(/\n+/)
      .map((line) => line.replace(/^[,\s]+|[,\s]+$/g, ""))
      .filter(Boolean)
      .map((line) => (/[.!?:;…]["”’)]?$/.test(line) ? line : `${line}.`))
      .join(" ")
      .replace(/\s{2,}/g, " ")
      .trim()
  );
}

/** Split text into pieces of at most `max` characters, at sentence ends where possible, then at commas or spaces. */
export function spokenChunks(text: string, max = MAX_SPOKEN_CHUNK): string[] {
  const sentences = text.match(/[^.!?…]+[.!?…]+["”’)]*\s*|[^.!?…]+$/g) ?? [];
  const chunks: string[] = [];
  let current = "";
  const push = (piece: string) => {
    const trimmed = piece.trim();
    if (trimmed) chunks.push(trimmed);
  };
  for (const sentence of sentences) {
    if ((current + sentence).length <= max) {
      current += sentence;
      continue;
    }
    push(current);
    current = "";
    let rest = sentence;
    while (rest.length > max) {
      const window = rest.slice(0, max);
      const cut = Math.max(window.lastIndexOf(", "), window.lastIndexOf(" "));
      const at = cut > max / 3 ? cut + 1 : max;
      push(rest.slice(0, at));
      rest = rest.slice(at);
    }
    current = rest;
  }
  push(current);
  return chunks;
}
