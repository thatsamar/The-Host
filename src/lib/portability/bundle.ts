// The export format: every table as plain rows, without user ids, embeddings
// or derived search chunks (re-indexing rebuilds those). Original files are
// listed but not included; they stay in Storage.

import { z } from "zod";
import type { DataStore, Row } from "./store";

export const EXPORT_FORMAT = "gio-export";
export const EXPORT_VERSION = 1;

export const EXPORT_COLUMNS = {
  projects: "id,name,location,brief,is_default,created_at,updated_at",
  rooms: "id,project_id,name,notes,created_at",
  chats: "id,project_id,room_id,title,source,external_id,created_at,updated_at",
  messages: "id,chat_id,role,speaker,content,attachments,metadata,created_at",
  memories:
    "id,project_id,room_id,type,content,attributed_to,review_state,source,evidence,source_message_id,created_at,updated_at",
  decisions:
    "id,project_id,room_id,title,detail,status,review_state,product_id,source_message_id,decided_by,source,evidence,created_at,updated_at",
  products:
    "id,project_id,room_id,name,designer,vendor,url,dimensions,material_color,provenance,price_amount,price_currency,price_basis,price_source_url,placement,rationale,verdict,status,source_message_id,created_at,updated_at",
  files: "id,project_id,room_id,name,mime_type,size_bytes,status,page_count,chunk_count,created_at",
  system_prompt_versions: "id,content,label,note,created_at",
} as const;

export type ExportTable = keyof typeof EXPORT_COLUMNS;
export const EXPORT_TABLES = Object.keys(EXPORT_COLUMNS) as ExportTable[];

const rows = z.array(z.record(z.string(), z.unknown()));

export const BundleSchema = z.object({
  format: z.literal(EXPORT_FORMAT),
  version: z.number().int(),
  exported_at: z.string(),
  system_prompt: z.string().nullable(),
  projects: rows,
  rooms: rows,
  chats: rows,
  messages: rows,
  memories: rows,
  decisions: rows,
  products: rows,
  files: rows,
  system_prompt_versions: rows,
});
export type ExportBundle = z.infer<typeof BundleSchema>;

export function emptyBundle(): ExportBundle {
  return {
    format: EXPORT_FORMAT,
    version: EXPORT_VERSION,
    exported_at: new Date().toISOString(),
    system_prompt: null,
    projects: [],
    rooms: [],
    chats: [],
    messages: [],
    memories: [],
    decisions: [],
    products: [],
    files: [],
    system_prompt_versions: [],
  };
}

export async function collectExport(store: DataStore, now = new Date()): Promise<ExportBundle> {
  const bundle = emptyBundle();
  bundle.exported_at = now.toISOString();
  for (const table of EXPORT_TABLES) {
    (bundle[table] as Row[]) = await store.selectAll(table, EXPORT_COLUMNS[table]);
  }
  const settings = await store.selectAll("settings", "key,value");
  const prompt = settings.find((s) => s.key === "system_prompt")?.value;
  bundle.system_prompt = typeof prompt === "string" ? prompt : null;
  return bundle;
}

export function toJson(bundle: ExportBundle): string {
  return JSON.stringify(bundle, null, 2);
}

export class BundleFormatError extends Error {}

export function parseBundle(data: unknown): ExportBundle {
  const parsed = BundleSchema.safeParse(data);
  if (!parsed.success) {
    throw new BundleFormatError("That file isn't a Gio export (or it was changed in a way that can't be read).");
  }
  if (parsed.data.version > EXPORT_VERSION) {
    throw new BundleFormatError("This export was made by a newer version of Gio.");
  }
  return parsed.data;
}
