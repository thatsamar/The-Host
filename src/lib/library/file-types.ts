// What the library accepts. Shared by the upload UI, server actions and the
// indexer so all three agree.

export type FileKind = "pdf" | "image" | "docx" | "text" | "markdown";

export const MAX_UPLOAD_BYTES = 50 * 1024 * 1024; // matches the `files` bucket limit

export const IMAGE_MIME_TYPES = ["image/jpeg", "image/png", "image/webp", "image/gif"] as const;

const EXTENSION_KINDS: Record<string, { kind: FileKind; mime: string }> = {
  pdf: { kind: "pdf", mime: "application/pdf" },
  jpg: { kind: "image", mime: "image/jpeg" },
  jpeg: { kind: "image", mime: "image/jpeg" },
  png: { kind: "image", mime: "image/png" },
  webp: { kind: "image", mime: "image/webp" },
  gif: { kind: "image", mime: "image/gif" },
  docx: { kind: "docx", mime: "application/vnd.openxmlformats-officedocument.wordprocessingml.document" },
  txt: { kind: "text", mime: "text/plain" },
  md: { kind: "markdown", mime: "text/markdown" },
  markdown: { kind: "markdown", mime: "text/markdown" },
};

/** `accept` attribute for the library upload input. */
export const LIBRARY_ACCEPT = Object.keys(EXTENSION_KINDS)
  .map((ext) => `.${ext}`)
  .join(",");

function extension(name: string): string {
  const dot = name.lastIndexOf(".");
  return dot >= 0 ? name.slice(dot + 1).toLowerCase() : "";
}

/**
 * Resolves a file's kind and canonical MIME type from its name, falling back
 * to the browser-reported type. Browsers often report "" for .md files.
 */
export function detectFileKind(name: string, reportedMime = ""): { kind: FileKind; mime: string } | null {
  const byExt = EXTENSION_KINDS[extension(name)];
  if (byExt) return byExt;
  const mime = reportedMime.toLowerCase();
  if (mime === "application/pdf") return { kind: "pdf", mime };
  if ((IMAGE_MIME_TYPES as readonly string[]).includes(mime)) return { kind: "image", mime };
  if (mime === EXTENSION_KINDS.docx.mime) return { kind: "docx", mime };
  if (mime === "text/markdown") return { kind: "markdown", mime };
  if (mime === "text/plain") return { kind: "text", mime };
  return null;
}

/** Keeps storage keys to safe characters while staying readable. */
export function safeStorageName(name: string): string {
  const cleaned = name
    .normalize("NFKD")
    .replace(/[^\w.\- ]+/g, "")
    .trim()
    .replace(/\s+/g, "-");
  return (cleaned || "file").slice(-120);
}
