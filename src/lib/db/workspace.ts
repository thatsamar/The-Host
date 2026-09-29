import "server-only";
import { cache } from "react";
import { redirect } from "next/navigation";
import { isHumanSpeaker, type HumanSpeaker } from "@/lib/gio/speakers";
import { createClient, getUserId } from "@/lib/supabase/server";
import type { ChatRow, DecisionRow, FileRow, MemoryRow, MessageRow, ProductRow, ProjectRow, RoomRow } from "./types";

/** Signed-in Supabase client + user id, or a redirect to /login. */
export const requireSession = cache(async () => {
  const supabase = await createClient();
  const userId = await getUserId(supabase);
  if (!userId) redirect("/login");
  return { supabase, userId };
});

export interface Workspace {
  projects: ProjectRow[];
  project: ProjectRow;
  rooms: RoomRow[];
  chats: ChatRow[];
  memories: MemoryRow[];
  decisions: DecisionRow[];
  files: FileRow[];
  products: ProductRow[];
  lastSpeaker: HumanSpeaker;
  userId: string;
}

export const loadWorkspace = cache(async (projectId: string): Promise<Workspace | null> => {
  const { supabase, userId } = await requireSession();
  const [projects, rooms, chats, memories, decisions, profile, files, products] = await Promise.all([
    supabase.from("projects").select("*").order("is_default", { ascending: false }).order("created_at"),
    supabase.from("rooms").select("*").eq("project_id", projectId).order("created_at"),
    supabase
      .from("chats")
      .select("*")
      .eq("project_id", projectId)
      .order("updated_at", { ascending: false })
      .limit(200),
    supabase
      .from("memories")
      .select("id,project_id,room_id,type,content,attributed_to,review_state,source_message_id,source,evidence,created_at,source_message:messages(chat_id)")
      .or(`project_id.eq.${projectId},project_id.is.null`)
      .in("review_state", ["approved", "proposed"])
      .order("created_at", { ascending: false }),
    supabase
      .from("decisions")
      .select("id,project_id,room_id,title,detail,status,review_state,source_message_id,product_id,decided_by,source,evidence,created_at,source_message:messages(chat_id)")
      .eq("project_id", projectId)
      .in("review_state", ["approved", "proposed"])
      .order("created_at", { ascending: false }),
    supabase.from("users").select("last_speaker").eq("id", userId).maybeSingle(),
    supabase
      .from("files")
      .select("id,project_id,room_id,name,mime_type,size_bytes,status,error,progress,chunk_count,page_count,created_at,updated_at")
      .eq("project_id", projectId)
      .order("created_at", { ascending: false }),
    supabase
      .from("products")
      .select("*, source_message:messages(chat_id)")
      .eq("project_id", projectId)
      .order("created_at", { ascending: false }),
  ]);
  for (const r of [projects, rooms, chats, memories, decisions, profile, files, products]) {
    if (r.error) throw new Error(r.error.message);
  }
  const project = (projects.data as ProjectRow[]).find((p) => p.id === projectId);
  if (!project) return null;
  const last = (profile.data as { last_speaker?: string } | null)?.last_speaker;
  return {
    projects: projects.data as ProjectRow[],
    project,
    rooms: rooms.data as RoomRow[],
    chats: chats.data as ChatRow[],
    memories: memories.data as unknown as MemoryRow[],
    decisions: decisions.data as unknown as DecisionRow[],
    files: files.data as FileRow[],
    products: products.data as unknown as ProductRow[],
    lastSpeaker: isHumanSpeaker(last) ? last : "Both",
    userId,
  };
});

export async function loadChat(
  chatId: string,
): Promise<{ chat: ChatRow; messages: MessageRow[]; imageUrls: Record<string, string> } | null> {
  const { supabase } = await requireSession();
  const [chat, messages] = await Promise.all([
    supabase.from("chats").select("*").eq("id", chatId).maybeSingle(),
    supabase.from("messages").select("*").eq("chat_id", chatId).order("created_at"),
  ]);
  if (chat.error) throw new Error(chat.error.message);
  if (messages.error) throw new Error(messages.error.message);
  if (!chat.data) return null;
  const rows = messages.data as MessageRow[];
  // Signed URLs for attached photos (the bucket is private).
  const paths = rows.flatMap((m) => (m.attachments ?? []).map((a) => a.storage_path));
  const imageUrls: Record<string, string> = {};
  if (paths.length) {
    const { data } = await supabase.storage.from("images").createSignedUrls(paths, 60 * 60);
    for (const item of data ?? []) if (item.path && item.signedUrl) imageUrls[item.path] = item.signedUrl;
  }
  return { chat: chat.data as ChatRow, messages: rows, imageUrls };
}

export async function defaultProjectId(): Promise<string | null> {
  const { supabase } = await requireSession();
  const { data, error } = await supabase
    .from("projects")
    .select("id")
    .order("is_default", { ascending: false })
    .order("created_at")
    .limit(1)
    .maybeSingle();
  if (error) throw new Error(error.message);
  return (data as { id: string } | null)?.id ?? null;
}
