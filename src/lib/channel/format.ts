// Advisors write Markdown for the website. A messaging app shows plain text,
// so the marks come off and the answer is grouped by paragraph into messages
// no longer than the provider allows. Nothing is summarized or cut.

/** Markdown to plain text a phone shows cleanly. Links keep their address so the provider can show a rich link. */
export function toPlainText(markdown: string): string {
  const lines = markdown.replace(/\r\n?/g, "\n").split("\n");
  const out: string[] = [];
  let fenced = false;
  for (let line of lines) {
    if (/^\s*```/.test(line)) {
      fenced = !fenced;
      continue;
    }
    if (!fenced) {
      line = line
        .replace(/^\s{0,3}#{1,6}\s+/, "")
        .replace(/^\s{0,3}>\s?/, "")
        .replace(/^(\s*)[-*+]\s+/, "$1• ")
        .replace(/!\[([^\]]*)\]\((\S+?)\)/g, "$1 $2")
        .replace(/\[([^\]]+)\]\((\S+?)\)/g, (_, label: string, url: string) => (label === url ? url : `${label} (${url})`))
        .replace(/\*\*(.+?)\*\*/g, "$1")
        .replace(/__(.+?)__/g, "$1")
        .replace(/(^|[^*\w])\*(?!\s)(.+?)(?<!\s)\*(?!\w)/g, "$1$2")
        .replace(/`([^`]+)`/g, "$1");
      if (/^\s*([-*_])(\s*\1){2,}\s*$/.test(line)) line = "";
    }
    out.push(line.replace(/\s+$/, ""));
  }
  return out.join("\n").replace(/\n{3,}/g, "\n\n").trim();
}

function splitLong(paragraph: string, max: number): string[] {
  if (paragraph.length <= max) return [paragraph];
  const pieces: string[] = [];
  let current = "";
  // Sentences first, then words, then characters: whatever keeps it readable.
  for (const sentence of paragraph.match(/[^.!?\n]+[.!?]*\s*|\n/g) ?? [paragraph]) {
    if ((current + sentence).length <= max) {
      current += sentence;
      continue;
    }
    if (current.trim()) pieces.push(current.trim());
    current = "";
    if (sentence.length <= max) current = sentence;
    else
      for (const word of sentence.split(/(\s+)/)) {
        if ((current + word).length <= max) {
          current += word;
          continue;
        }
        if (current.trim()) pieces.push(current.trim());
        let rest = word.trim() ? word : "";
        while (rest.length > max) {
          pieces.push(rest.slice(0, max));
          rest = rest.slice(max);
        }
        current = rest;
      }
  }
  if (current.trim()) pieces.push(current.trim());
  return pieces;
}

/**
 * Groups an answer's paragraphs into messages of up to `preferred`
 * characters, never more than `max`. A heading-like line stays with the
 * paragraph after it; a short answer stays one message.
 */
export function splitMessages(text: string, preferred: number, max: number): string[] {
  const limit = Math.max(1, Math.min(preferred, max));
  const paragraphs = text.split(/\n{2,}/).map((p) => p.trim()).filter(Boolean);
  const groups: string[] = [];
  let current = "";
  for (let i = 0; i < paragraphs.length; i++) {
    let paragraph = paragraphs[i];
    // A short line with no ending punctuation reads as a heading: keep it with what follows.
    while (i + 1 < paragraphs.length && paragraph.length <= 80 && !/[.!?:;)]$/.test(paragraph) && !paragraph.includes("\n")) {
      paragraph = `${paragraph}\n\n${paragraphs[++i]}`;
    }
    for (const piece of splitLong(paragraph, max)) {
      const joined = current ? `${current}\n\n${piece}` : piece;
      if (joined.length <= limit || !current) current = joined.length <= max ? joined : piece;
      else {
        groups.push(current);
        current = piece;
      }
    }
  }
  if (current) groups.push(current);
  return groups;
}
