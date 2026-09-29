import { getBackgroundModel } from "@/lib/ai";
import { SupabaseChatRepository } from "@/lib/db/supabase-repository";
import { runExtractionStep, type ExtractionChat, type ExtractionStore } from "@/lib/memory/import-extraction";
import { createClient, getUserId, type ServerSupabase } from "@/lib/supabase/server";

// One step of memory extraction over imported conversations. The browser
// keeps calling while chats are waiting; progress is saved between steps.
export const maxDuration = 300;
const STEP_BUDGET_MS = 200_000;

function supabaseExtractionStore(supabase: ServerSupabase, userId: string): ExtractionStore {
  const repo = new SupabaseChatRepository(supabase, userId);
  return {
    listMessages: (chatId) => repo.listMessages(chatId),
    listKnownMemory: (projectId) => repo.listKnownMemory(projectId),
    insertProposals: (input) => repo.insertProposals(input),
    async claimChat(leaseSeconds) {
      const { data, error } = await supabase
        .from("chats")
        .select("id, project_id, room_id, extraction_next, extraction_status, extraction_lease_until, projects(name)")
        .in("extraction_status", ["pending", "running"])
        .order("created_at", { ascending: true })
        .limit(25);
      if (error) throw new Error(error.message);
      const now = new Date();
      for (const row of (data ?? []) as unknown as (ExtractionChat & {
        extraction_status: string;
        extraction_lease_until: string | null;
        projects: { name: string } | null;
      })[]) {
        const free = !row.extraction_lease_until || new Date(row.extraction_lease_until) < now;
        if (!free) continue;
        const { data: claimed } = await supabase
          .from("chats")
          .update({ extraction_status: "running", extraction_lease_until: new Date(now.getTime() + leaseSeconds * 1000).toISOString() })
          .eq("id", row.id)
          .or(`extraction_lease_until.is.null,extraction_lease_until.lt."${now.toISOString()}"`)
          .select("id")
          .maybeSingle();
        if (claimed) {
          return {
            id: row.id,
            project_id: row.project_id,
            room_id: row.room_id,
            extraction_next: row.extraction_next,
            project_name: row.projects?.name ?? "Project",
          };
        }
      }
      return null;
    },
    async updateChat(chatId, patch) {
      const { error } = await supabase.from("chats").update(patch).eq("id", chatId);
      if (error) throw new Error(error.message);
    },
  };
}

/** How much imported history is still waiting for extraction. */
export async function GET() {
  const supabase = await createClient();
  const userId = await getUserId(supabase);
  if (!userId) return Response.json({ error: "Not signed in" }, { status: 401 });
  const [waiting, done, failed] = await Promise.all(
    [["pending", "running"], ["done"], ["failed"]].map(async (states) => {
      const { count } = await supabase.from("chats").select("id", { count: "exact", head: true }).in("extraction_status", states);
      return count ?? 0;
    }),
  );
  return Response.json({ waiting, done, failed });
}

export async function POST() {
  const supabase = await createClient();
  const userId = await getUserId(supabase);
  if (!userId) return Response.json({ error: "Not signed in" }, { status: 401 });
  try {
    const result = await runExtractionStep(
      { store: supabaseExtractionStore(supabase, userId), background: getBackgroundModel() },
      { budgetMs: STEP_BUDGET_MS },
    );
    return Response.json(result);
  } catch (err) {
    return Response.json({ error: err instanceof Error ? err.message : "Extraction failed" }, { status: 500 });
  }
}
