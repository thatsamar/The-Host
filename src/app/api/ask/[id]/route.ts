import { signInRequired } from "@/lib/auth/access";
import { answerStore, isAnswerId, loadAnswer, requestStop } from "@/lib/ask/relay";
import { createClient, getUserId } from "@/lib/supabase/server";

const NO_STORE = { "Cache-Control": "no-store" };

async function allowed(): Promise<boolean> {
  if (!signInRequired()) return true;
  return Boolean(await getUserId(await createClient()));
}

/** The answer so far, for a page that lost its connection while it was being written. */
export async function GET(_request: Request, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  if (!isAnswerId(id) || !(await allowed())) return Response.json({ error: "Not found" }, { status: 404, headers: NO_STORE });
  try {
    const answer = await loadAnswer(id);
    // Which store served this, so a deployment can be checked without saving anything.
    const headers = { ...NO_STORE, "X-Answer-Store": answerStore() };
    if (!answer) return Response.json({ error: "Not found", store: answerStore() }, { status: 404, headers });
    return Response.json(answer, { headers });
  } catch (err) {
    console.error("Couldn't read a saved answer:", err instanceof Error ? err.message : err);
    return Response.json({ error: "Try again." }, { status: 503, headers: NO_STORE });
  }
}

/** Stop: ends the answer on the server too, not just on the page. */
export async function DELETE(_request: Request, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  if (!isAnswerId(id) || !(await allowed())) return new Response(null, { status: 404, headers: NO_STORE });
  await requestStop(id).catch((err) =>
    console.error("Couldn't pass on a stop:", err instanceof Error ? err.message : err),
  );
  return new Response(null, { status: 204, headers: NO_STORE });
}
