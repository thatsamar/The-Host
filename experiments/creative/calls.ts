/** One model call, streamed to the end, and what it cost: shared by the run and the automated checks. */

import { callCost } from "@/lib/ops/rates";
import type { ChatProvider, ChatRequest } from "@/lib/ai/types";

/** Assumed list price per web search, for the budget only (not in the rates table). */
export const SEARCH_USD = 0.01;

export async function complete(provider: ChatProvider, request: ChatRequest): Promise<{ text: string; usage: Record<string, unknown>; model: string | null; searches: number }> {
  let text = "";
  let usage: Record<string, unknown> = {};
  let model: string | null = null;
  let searches = 0;
  for await (const event of provider.streamChat(request)) {
    if (event.type === "text") text += event.text;
    else if (event.type === "done") {
      usage = event.usage;
      model = event.model;
      searches = event.webSearches.length;
    }
  }
  return { text, usage, model, searches };
}

export const costOf = (model: string | null, usage: Record<string, unknown>, searches: number) => {
  const n = (k: string) => (typeof usage[k] === "number" ? (usage[k] as number) : 0);
  return (callCost({ model: model ?? undefined, input: n("input_tokens"), output: n("output_tokens"), cache_read: n("cache_read_input_tokens"), cache_write: n("cache_creation_input_tokens") }) ?? 0) + searches * SEARCH_USD;
};
