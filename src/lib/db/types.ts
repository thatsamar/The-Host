import type { HumanSpeaker, Speaker } from "@/lib/gio/speakers";

// Row shapes for the tables in supabase/migrations. Kept by hand and small on
// purpose; only the columns the app reads are typed as required.

export interface ProjectRow {
  id: string;
  user_id: string;
  name: string;
  location: string | null;
  brief: string | null;
  is_default: boolean;
  created_at: string;
  updated_at: string;
}

export interface RoomRow {
  id: string;
  project_id: string;
  name: string;
  notes: string | null;
  created_at: string;
}

export interface FileRow {
  id: string;
  project_id: string;
  room_id: string | null;
  name: string;
  mime_type: string;
  size_bytes: number;
  status: "uploading" | "pending" | "processing" | "indexed" | "failed";
  error: string | null;
  progress: { next_unit?: number; total_units?: number; warnings?: string[] };
  chunk_count: number;
  page_count: number | null;
  created_at: string;
  updated_at: string;
}

export interface ChatRow {
  id: string;
  project_id: string;
  room_id: string | null;
  title: string | null;
  source: string;
  created_at: string;
  updated_at: string;
}

export interface MessageAttachment {
  image_asset_id?: string;
  storage_path: string;
  mime_type: string;
  name?: string;
}

export interface WebSource {
  title: string;
  url: string;
}

export interface MessageReference {
  file_name: string;
  file_id: string | null;
  page: number | null;
  source_type: "text" | "visual_description";
  similarity: number;
  with_image: boolean;
}

export interface MessageMetadata {
  model?: string;
  stop_reason?: string | null;
  usage?: Record<string, unknown>;
  web_searches?: string[];
  web_sources?: WebSource[];
  references?: MessageReference[];
  retrieval_error?: string;
  mode?: import("@/lib/gio/modes").ChatMode;
  /** Memory and decision proposals created from this exchange. */
  proposals?: { memories: number; decisions: number };
  error?: string;
}

export interface MessageRow {
  id: string;
  chat_id: string;
  role: "user" | "assistant";
  speaker: Speaker;
  content: string;
  attachments: MessageAttachment[];
  metadata: MessageMetadata;
  created_at: string;
}

export const MEMORY_TYPES = [
  "design_preference",
  "courtney_preference",
  "amar_preference",
  "shared_preference",
  "rejected_idea",
  "approved_decision",
  "project_constraint",
  "budget_philosophy",
  "material",
  "vendor",
  "dimension",
  "paint_color",
  "furniture_under_consideration",
] as const;
export type MemoryType = (typeof MEMORY_TYPES)[number];

export interface MemoryRow {
  id: string;
  project_id: string | null;
  room_id: string | null;
  type: MemoryType;
  content: string;
  attributed_to: HumanSpeaker | null;
  review_state: "proposed" | "approved" | "dismissed";
  source_message_id: string | null;
  source?: "extracted" | "manual" | "import";
  evidence?: string | null;
  /** Joined: the chat the source message belongs to. */
  source_message?: { chat_id: string } | null;
  created_at: string;
}

export interface DecisionRow {
  id: string;
  project_id: string;
  room_id: string | null;
  title: string;
  detail: string | null;
  status: "approved" | "keep_looking" | "rejected" | "pending";
  review_state: "proposed" | "approved" | "dismissed";
  source_message_id: string | null;
  product_id?: string | null;
  decided_by?: HumanSpeaker | null;
  source?: "extracted" | "manual" | "import";
  evidence?: string | null;
  source_message?: { chat_id: string } | null;
  created_at: string;
}

export interface ProductRow {
  id: string;
  project_id: string;
  room_id: string | null;
  name: string;
  designer: string | null;
  vendor: string | null;
  url: string | null;
  dimensions: string | null;
  material_color: string | null;
  provenance: "vintage" | "new" | "antique" | "custom" | "unknown" | null;
  price_amount: number | null;
  price_currency: string | null;
  price_basis: "sourced" | "estimated" | null;
  price_source_url: string | null;
  placement: string | null;
  rationale: string | null;
  verdict: "invest" | "save" | "skip" | null;
  status: "considering" | "approved" | "rejected" | "purchased";
  source_message_id: string | null;
  source_message?: { chat_id: string } | null;
  created_at: string;
}
