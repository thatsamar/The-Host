// Indexes one library file into searchable chunks, in bounded steps.
//
// A file is split into numbered units: the text of a .txt/.md file, one
// uploaded image, each PDF page, or a .docx's body text plus each embedded
// image. A step claims the file with a short lease, processes units until its
// time budget runs out, embeds and stores the chunks, and records the next
// unit in `files.progress`. The next step resumes there, so large image-heavy
// PDFs finish across several serverless invocations.

import type { BackgroundModel, EmbeddingProvider } from "@/lib/ai/types";
import { chunkText, normalizeText } from "./chunk";
import { describeImage } from "./describe";
import type { DocxContent } from "./docx";
import { detectFileKind, type FileKind } from "./file-types";
import type { LoadedPdf } from "./pdf";

export interface IndexProgress {
  next_unit?: number;
  total_units?: number;
  warnings?: string[];
}

export interface LibraryFile {
  id: string;
  user_id: string;
  project_id: string;
  room_id: string | null;
  name: string;
  mime_type: string;
  storage_path: string;
  status: "uploading" | "pending" | "processing" | "indexed" | "failed";
  progress: IndexProgress;
  attempts: number;
  error: string | null;
}

export interface NewImageAsset {
  user_id: string;
  project_id: string;
  room_id: string | null;
  file_id: string | null;
  message_id?: string | null;
  page: number | null;
  unit: number | null;
  storage_path: string;
  mime_type: string;
  width: number;
  height: number;
  description: string | null;
  source: "upload" | "pdf_page" | "docx_image" | "chat";
  metadata?: Record<string, unknown>;
}

export interface NewChunk {
  user_id: string;
  file_id: string | null;
  image_asset_id: string | null;
  project_id: string;
  room_id: string | null;
  source_type: "text" | "visual_description";
  content: string;
  page: number | null;
  unit: number;
  chunk_index: number;
  token_count: number;
  metadata: Record<string, unknown>;
  embedding: number[];
}

/** Storage and database operations the indexer needs. Mocked in tests. */
export interface LibraryStore {
  claimFile(fileId: string, leaseSeconds: number): Promise<LibraryFile | null>;
  getFile(fileId: string): Promise<LibraryFile | null>;
  download(bucket: "files" | "images", path: string): Promise<Buffer>;
  upload(bucket: "images", path: string, data: Buffer, contentType: string): Promise<void>;
  /** Removes chunks and image assets (and their stored images) with unit >= `unit`. */
  clearUnitsFrom(fileId: string, unit: number): Promise<void>;
  insertImageAsset(row: NewImageAsset): Promise<{ id: string }>;
  insertChunks(rows: NewChunk[]): Promise<void>;
  countChunks(fileId: string): Promise<number>;
  updateFile(fileId: string, patch: Record<string, unknown>): Promise<void>;
}

/** Heavy parsers, injected so tests and the server can supply them. */
export interface LibraryParsers {
  loadPdf(bytes: Uint8Array): Promise<LoadedPdf>;
  extractDocx(bytes: Buffer): Promise<DocxContent>;
  prepareImage(bytes: Buffer): Promise<{ data: Buffer; mediaType: "image/jpeg"; width: number; height: number }>;
  isBlankImage(bytes: Buffer): Promise<boolean>;
}

export interface IndexerDeps {
  store: LibraryStore;
  embedder: EmbeddingProvider;
  background: BackgroundModel;
  parsers: LibraryParsers;
  now?: () => number;
}

export interface StepResult {
  status: LibraryFile["status"];
  progress: IndexProgress;
  /** True when another step is needed to finish the file. */
  more: boolean;
  /** True when another tab or request holds the lease. */
  busy?: boolean;
  error?: string | null;
}

/** PDF pages with at least this much text are indexed as text. */
export const MIN_PAGE_TEXT = 200;
/** Pages with images and less text than this are also described visually. */
export const MAX_TEXT_FOR_MIXED_PAGE = 1500;
export const MAX_PDF_PAGES = 600;
export const MAX_ATTEMPTS = 30;
const UNITS_PER_BATCH = 6;
const VISUAL_CONCURRENCY = 3;
const MAX_WARNINGS = 20;

interface Parsed {
  kind: FileKind;
  bytes: Buffer;
  totalUnits: number;
  pdf?: LoadedPdf;
  docx?: DocxContent;
}

interface UnitResult {
  drafts: Omit<NewChunk, "embedding">[];
  warnings: string[];
}

async function mapLimit<T, R>(items: T[], limit: number, fn: (item: T) => Promise<R>): Promise<R[]> {
  const results = new Array<R>(items.length);
  let next = 0;
  const workers = Array.from({ length: Math.min(limit, items.length) }, async () => {
    while (next < items.length) {
      const i = next++;
      results[i] = await fn(items[i]);
    }
  });
  await Promise.all(workers);
  return results;
}

function message(err: unknown): string {
  return err instanceof Error ? err.message : String(err);
}

export function embedText(file: { name: string }, draft: { content: string; page: number | null; source_type: string }): string {
  const where = `${file.name}${draft.page ? `, page ${draft.page}` : ""}`;
  return draft.source_type === "visual_description"
    ? `Image from ${where}.\n\n${draft.content}`
    : `From ${where}.\n\n${draft.content}`;
}

async function parse(file: LibraryFile, bytes: Buffer, parsers: LibraryParsers): Promise<Parsed> {
  const detected = detectFileKind(file.name, file.mime_type);
  if (!detected) throw new Error(`Unsupported file type: ${file.name}`);
  const kind = detected.kind;
  switch (kind) {
    case "pdf": {
      const pdf = await parsers.loadPdf(new Uint8Array(bytes));
      return { kind, bytes, pdf, totalUnits: Math.min(pdf.pageCount, MAX_PDF_PAGES) };
    }
    case "docx": {
      const docx = await parsers.extractDocx(bytes);
      return { kind, bytes, docx, totalUnits: 1 + docx.images.length };
    }
    default:
      return { kind, bytes, totalUnits: 1 };
  }
}

function textDrafts(file: LibraryFile, unit: number, text: string, page: number | null, kind: FileKind) {
  return chunkText(text).map((content, i) => ({
    user_id: file.user_id,
    file_id: file.id,
    image_asset_id: null,
    project_id: file.project_id,
    room_id: file.room_id,
    source_type: "text" as const,
    content,
    page,
    unit,
    chunk_index: i,
    token_count: Math.ceil(content.length / 4),
    metadata: { file_name: file.name, kind },
  }));
}

async function visualDraft(
  deps: IndexerDeps,
  file: LibraryFile,
  unit: number,
  source: NewImageAsset["source"],
  raw: Buffer,
  page: number | null,
  nearbyText: string | undefined,
  kind: FileKind,
): Promise<Omit<NewChunk, "embedding"> | null> {
  const image = await deps.parsers.prepareImage(raw);
  if (source === "pdf_page" && (await deps.parsers.isBlankImage(image.data))) return null;
  const description = await describeImage(
    deps.background,
    { mediaType: image.mediaType, data: image.data.toString("base64") },
    { source: file.name, page, nearbyText },
  );
  const storagePath = `${file.user_id}/files/${file.id}/u${unit}.jpg`;
  await deps.store.upload("images", storagePath, image.data, image.mediaType);
  const asset = await deps.store.insertImageAsset({
    user_id: file.user_id,
    project_id: file.project_id,
    room_id: file.room_id,
    file_id: file.id,
    page,
    unit,
    storage_path: storagePath,
    mime_type: image.mediaType,
    width: image.width,
    height: image.height,
    description,
    source,
  });
  return {
    user_id: file.user_id,
    file_id: file.id,
    image_asset_id: asset.id,
    project_id: file.project_id,
    room_id: file.room_id,
    source_type: "visual_description",
    content: description,
    page,
    unit,
    chunk_index: 0,
    token_count: Math.ceil(description.length / 4),
    metadata: { file_name: file.name, kind, image_source: source },
  };
}

async function processUnit(deps: IndexerDeps, file: LibraryFile, parsed: Parsed, unit: number): Promise<UnitResult> {
  const warnings: string[] = [];
  switch (parsed.kind) {
    case "text":
    case "markdown": {
      const text = parsed.bytes.toString("utf8").replace(/^﻿/, "");
      return { drafts: textDrafts(file, unit, text, null, parsed.kind), warnings };
    }
    case "image": {
      // The whole file is this image, so a failed description fails the file.
      const draft = await visualDraft(deps, file, unit, "upload", parsed.bytes, null, undefined, parsed.kind);
      return { drafts: draft ? [draft] : [], warnings };
    }
    case "docx": {
      if (unit === 0) return { drafts: textDrafts(file, unit, parsed.docx!.text, null, parsed.kind), warnings };
      const image = parsed.docx!.images[unit - 1];
      try {
        const draft = await visualDraft(deps, file, unit, "docx_image", image.data, null, undefined, parsed.kind);
        return { drafts: draft ? [draft] : [], warnings };
      } catch (err) {
        return { drafts: [], warnings: [`Image ${unit}: ${message(err)}`] };
      }
    }
    case "pdf": {
      const pageNumber = unit + 1;
      const info = await parsed.pdf!.page(pageNumber);
      const text = normalizeText(info.text);
      const drafts: Omit<NewChunk, "embedding">[] = [];
      if (text.length >= MIN_PAGE_TEXT) drafts.push(...textDrafts(file, unit, text, pageNumber, parsed.kind));
      const visual = text.length < MIN_PAGE_TEXT || (info.imageCount > 0 && text.length < MAX_TEXT_FOR_MIXED_PAGE);
      if (visual) {
        try {
          const png = await parsed.pdf!.render(pageNumber);
          const draft = await visualDraft(deps, file, unit, "pdf_page", png, pageNumber, text, parsed.kind);
          if (draft) drafts.push(draft);
        } catch (err) {
          warnings.push(`Page ${pageNumber}: ${message(err)}`);
        }
      }
      return { drafts, warnings };
    }
  }
}

export async function runIndexStep(
  deps: IndexerDeps,
  fileId: string,
  options: { budgetMs: number; leaseSeconds?: number },
): Promise<StepResult> {
  const now = deps.now ?? Date.now;
  const started = now();
  const leaseSeconds = options.leaseSeconds ?? Math.ceil(options.budgetMs / 1000) + 60;
  const { store } = deps;

  const file = await store.claimFile(fileId, leaseSeconds);
  if (!file) {
    const current = await store.getFile(fileId);
    if (!current) throw new Error("File not found");
    const inFlight = current.status === "pending" || current.status === "processing";
    return {
      status: current.status,
      progress: current.progress,
      more: inFlight,
      busy: current.status === "processing",
      error: current.error,
    };
  }

  const progress: IndexProgress = { ...file.progress };
  const warnings = [...(progress.warnings ?? [])];
  let parsed: Parsed | undefined;
  try {
    if (file.attempts > MAX_ATTEMPTS) throw new Error("Indexing kept failing; gave up. Try re-uploading the file.");

    const bytes = await store.download("files", file.storage_path);
    parsed = await parse(file, bytes, deps.parsers);
    const total = parsed.totalUnits;
    let next = progress.next_unit ?? 0;
    if (parsed.pdf && parsed.pdf.pageCount > MAX_PDF_PAGES && next === 0) {
      warnings.push(`Only the first ${MAX_PDF_PAGES} of ${parsed.pdf.pageCount} pages are indexed.`);
    }

    // Anything at or past the resume point is from an interrupted step.
    await store.clearUnitsFrom(file.id, next);

    progress.total_units = total;
    // Always finish at least one batch per step so every step makes progress.
    let batches = 0;
    while (next < total && (batches++ === 0 || now() - started < options.budgetMs)) {
      const units = Array.from({ length: Math.min(UNITS_PER_BATCH, total - next) }, (_, i) => next + i);
      const results = await mapLimit(units, VISUAL_CONCURRENCY, (u) => processUnit(deps, file, parsed!, u));
      const drafts = results.flatMap((r) => r.drafts);
      warnings.push(...results.flatMap((r) => r.warnings));
      if (drafts.length) {
        const vectors = await deps.embedder.embed(
          drafts.map((d) => embedText(file, d)),
          "document",
        );
        await store.insertChunks(drafts.map((d, i) => ({ ...d, embedding: vectors[i] })));
      }
      next = units[units.length - 1] + 1;
      Object.assign(progress, { next_unit: next, total_units: total, warnings: warnings.slice(-MAX_WARNINGS) });
      await store.updateFile(file.id, {
        progress,
        lease_until: new Date(now() + leaseSeconds * 1000).toISOString(),
      });
    }

    if (next < total) {
      // Out of time: release the lease so the next step can resume at once.
      await store.updateFile(file.id, { status: "processing", lease_until: new Date(now() - 1000).toISOString() });
      return { status: "processing", progress, more: true };
    }

    const chunkCount = await store.countChunks(file.id);
    if (chunkCount === 0) {
      throw new Error(
        warnings.length ? `Nothing could be indexed. ${warnings[0]}` : "No text or images found in this file.",
      );
    }
    await store.updateFile(file.id, {
      status: "indexed",
      progress,
      chunk_count: chunkCount,
      page_count: parsed.pdf?.pageCount ?? null,
      indexed_at: new Date(now()).toISOString(),
      lease_until: null,
      error: null,
    });
    return { status: "indexed", progress, more: false };
  } catch (err) {
    const error = message(err);
    await store.updateFile(file.id, { status: "failed", error, lease_until: null, progress });
    return { status: "failed", progress, more: false, error };
  } finally {
    await parsed?.pdf?.destroy().catch(() => undefined);
  }
}
