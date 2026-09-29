import type { BackgroundModel, EmbeddingProvider } from "@/lib/ai/types";
import type { LibraryFile, LibraryStore, NewChunk, NewImageAsset } from "@/lib/library/indexer";

/** Deterministic fake embeddings: a bag-of-words hash into `dimension` slots. */
export class FakeEmbedder implements EmbeddingProvider {
  readonly model = "fake-embed";
  calls: { texts: string[]; inputType: string }[] = [];
  constructor(readonly dimension = 16) {}
  async embed(texts: string[], inputType: "document" | "query") {
    this.calls.push({ texts, inputType });
    return texts.map((t) => {
      const v = new Array(this.dimension).fill(0);
      for (const word of t.toLowerCase().match(/[a-z]+/g) ?? []) {
        let h = 0;
        for (const ch of word) h = (h * 31 + ch.charCodeAt(0)) >>> 0;
        v[h % this.dimension] += 1;
      }
      return v;
    });
  }
}

/** Describes images with a fixed sentence; can be told to fail. */
export class FakeDescriber implements BackgroundModel {
  calls = 0;
  async extract<T>(): Promise<T> {
    throw new Error("not used");
  }
  failOn = new Set<number>();
  async complete(input: Parameters<BackgroundModel["complete"]>[0]) {
    this.calls++;
    if (this.failOn.has(this.calls)) throw new Error("describer unavailable");
    const hasImage = input.content.some((p) => p.type === "image");
    const prompt = input.content.find((p) => p.type === "text");
    const source = prompt && prompt.type === "text" ? prompt.text.split("\n")[0] : "";
    return hasImage
      ? `Subject: a warm lounge with a green circular rug. Materials: walnut, plaster, linen. ${source}`
      : "Untitled";
  }
}

export class MemoryLibraryStore implements LibraryStore {
  files = new Map<string, LibraryFile & { lease_until?: string | null; [k: string]: unknown }>();
  objects = new Map<string, Buffer>();
  chunks: (NewChunk & { id: string })[] = [];
  assets: (NewImageAsset & { id: string })[] = [];
  private seq = 0;

  addFile(file: Partial<LibraryFile> & { name: string; mime_type: string }, bytes: Buffer): LibraryFile {
    const id = `file-${++this.seq}`;
    const row: LibraryFile = {
      id,
      user_id: "user-1",
      project_id: "project-1",
      room_id: null,
      storage_path: `user-1/project-1/${id}/${file.name}`,
      status: "pending",
      progress: {},
      attempts: 0,
      error: null,
      ...file,
    };
    this.files.set(id, { ...row, lease_until: null });
    this.objects.set(`files:${row.storage_path}`, bytes);
    return row;
  }

  async getFile(id: string) {
    const f = this.files.get(id);
    return f ? { ...f } : null;
  }

  async claimFile(id: string, leaseSeconds: number) {
    const f = this.files.get(id);
    if (!f) return null;
    const leaseLive = f.lease_until && new Date(f.lease_until).getTime() > Date.now();
    if (!(f.status === "pending" || (f.status === "processing" && !leaseLive))) return null;
    Object.assign(f, {
      status: "processing",
      lease_until: new Date(Date.now() + leaseSeconds * 1000).toISOString(),
      attempts: f.attempts + 1,
      error: null,
    });
    return { ...f };
  }

  async download(bucket: string, path: string) {
    const data = this.objects.get(`${bucket}:${path}`);
    if (!data) throw new Error(`missing ${bucket}:${path}`);
    return data;
  }

  async upload(bucket: string, path: string, data: Buffer) {
    this.objects.set(`${bucket}:${path}`, data);
  }

  async clearUnitsFrom(fileId: string, unit: number) {
    this.chunks = this.chunks.filter((c) => !(c.file_id === fileId && c.unit >= unit));
    for (const a of this.assets.filter((a) => a.file_id === fileId && (a.unit ?? 0) >= unit)) {
      this.objects.delete(`images:${a.storage_path}`);
    }
    this.assets = this.assets.filter((a) => !(a.file_id === fileId && (a.unit ?? 0) >= unit));
  }

  async insertImageAsset(row: NewImageAsset) {
    const id = `asset-${++this.seq}`;
    this.assets.push({ ...row, id });
    return { id };
  }

  async insertChunks(rows: NewChunk[]) {
    for (const r of rows) this.chunks.push({ ...r, id: `chunk-${++this.seq}` });
  }

  async countChunks(fileId: string) {
    return this.chunks.filter((c) => c.file_id === fileId).length;
  }

  async updateFile(id: string, patch: Record<string, unknown>) {
    Object.assign(this.files.get(id)!, patch);
  }
}
