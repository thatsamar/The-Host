import { z } from "zod";
import { getBackgroundModel, getEmbeddingProvider } from "@/lib/ai";
import { SupabaseLibraryStore } from "@/lib/db/library-store";
import { runIndexStep } from "@/lib/library/indexer";
import { serverParsers } from "@/lib/library/parsers";
import { createClient, getUserId } from "@/lib/supabase/server";

// One indexing step. Big files take several steps; the browser keeps calling
// while `more` is true, and progress is saved between steps.
export const maxDuration = 300;
const STEP_BUDGET_MS = 200_000;

const bodySchema = z.object({ fileId: z.string().uuid() });

export async function POST(request: Request) {
  const supabase = await createClient();
  const userId = await getUserId(supabase);
  if (!userId) return Response.json({ error: "Not signed in" }, { status: 401 });

  const parsed = bodySchema.safeParse(await request.json().catch(() => null));
  if (!parsed.success) return Response.json({ error: "Invalid request" }, { status: 400 });

  let embedder;
  try {
    embedder = getEmbeddingProvider();
  } catch (err) {
    // Leave the file queued; it will index once Voyage is configured.
    return Response.json({ error: err instanceof Error ? err.message : "Embeddings unavailable", more: false }, { status: 503 });
  }

  try {
    const result = await runIndexStep(
      {
        store: new SupabaseLibraryStore(supabase),
        embedder,
        background: getBackgroundModel(),
        parsers: serverParsers,
      },
      parsed.data.fileId,
      { budgetMs: STEP_BUDGET_MS },
    );
    return Response.json(result);
  } catch (err) {
    return Response.json({ error: err instanceof Error ? err.message : "Indexing failed" }, { status: 500 });
  }
}

/** Files waiting to be indexed, across every project, oldest first. */
export async function GET() {
  const supabase = await createClient();
  const userId = await getUserId(supabase);
  if (!userId) return Response.json({ error: "Not signed in" }, { status: 401 });
  const { data, error } = await supabase
    .from("files")
    .select("id,status,lease_until")
    .in("status", ["pending", "processing"])
    .order("created_at", { ascending: true })
    .limit(100);
  if (error) return Response.json({ error: error.message }, { status: 500 });
  return Response.json({ queue: data ?? [] });
}
