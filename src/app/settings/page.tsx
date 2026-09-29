import type { Metadata } from "next";
import { SettingsView, type SettingsData } from "@/components/settings/settings-view";
import { getOrSeedSystemPrompt } from "@/lib/db/supabase-repository";
import type { DecisionRow, FileRow, MemoryRow, ProjectRow, RoomRow } from "@/lib/db/types";
import { requireSession } from "@/lib/db/workspace";
import { DEFAULT_SYSTEM_PROMPT } from "@/lib/gio/default-system-prompt";

export const metadata: Metadata = { title: "Settings · Gio" };

export default async function SettingsPage({ searchParams }: PageProps<"/settings">) {
  const { supabase, userId } = await requireSession();
  const { tab } = await searchParams;
  const [prompt, versions, projects, rooms, memories, decisions, files] = await Promise.all([
    getOrSeedSystemPrompt(supabase, userId),
    supabase.from("system_prompt_versions").select("id,content,label,note,created_at").order("created_at", { ascending: false }).limit(200),
    supabase.from("projects").select("*").order("is_default", { ascending: false }).order("created_at"),
    supabase.from("rooms").select("*").order("created_at"),
    supabase
      .from("memories")
      .select("id,project_id,room_id,type,content,attributed_to,review_state,source_message_id,source,evidence,created_at,source_message:messages(chat_id)")
      .order("created_at", { ascending: false }),
    supabase
      .from("decisions")
      .select("id,project_id,room_id,title,detail,status,review_state,source_message_id,product_id,decided_by,source,evidence,created_at,source_message:messages(chat_id)")
      .order("created_at", { ascending: false }),
    supabase
      .from("files")
      .select("id,project_id,room_id,name,mime_type,size_bytes,status,error,progress,chunk_count,page_count,created_at,updated_at")
      .order("created_at", { ascending: false }),
  ]);
  for (const r of [versions, projects, rooms, memories, decisions, files]) if (r.error) throw new Error(r.error.message);

  const data: SettingsData = {
    userId,
    prompt,
    defaultPrompt: DEFAULT_SYSTEM_PROMPT,
    versions: versions.data as SettingsData["versions"],
    projects: projects.data as ProjectRow[],
    rooms: rooms.data as RoomRow[],
    memories: memories.data as unknown as MemoryRow[],
    decisions: decisions.data as unknown as DecisionRow[],
    files: files.data as FileRow[],
  };
  return <SettingsView data={data} initialTab={typeof tab === "string" ? tab : undefined} />;
}
