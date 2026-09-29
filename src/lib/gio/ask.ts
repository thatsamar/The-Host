import type { ChatProvider, WebSourceRef } from "@/lib/ai/types";
import { assemblePrompt, type AskTurn } from "./prompt";

export type AskEvent =
  | { type: "text"; text: string }
  | { type: "searching"; query: string }
  | { type: "sources"; sources: WebSourceRef[] }
  | { type: "done" }
  | { type: "error"; message: string };

/**
 * Answers the latest question in a visit's conversation. Nothing is read from
 * or written to storage: the conversation arrives whole with each request.
 */
export async function* askGio(
  deps: { provider: ChatProvider; systemPrompt: string; webSearch?: boolean; signal?: AbortSignal },
  turns: AskTurn[],
): AsyncGenerator<AskEvent> {
  const request = assemblePrompt({ systemPrompt: deps.systemPrompt, turns, webSearch: deps.webSearch });
  if (request.messages.at(-1)?.role !== "user") {
    yield { type: "error", message: "Add a photo or a question." };
    return;
  }
  try {
    for await (const event of deps.provider.streamChat({ ...request, signal: deps.signal })) {
      if (event.type === "text") yield event;
      else if (event.type === "web_search") yield { type: "searching", query: event.query };
      else if (event.type === "web_results") yield { type: "sources", sources: event.sources };
    }
    yield { type: "done" };
  } catch (err) {
    yield { type: "error", message: errorMessage(err) };
  }
}

export function errorMessage(err: unknown): string {
  if (err instanceof Error && err.name === "AbortError") return "Stopped.";
  if (!(err instanceof Error)) return "Something went wrong talking to Gio.";
  const status = (err as { status?: number }).status;
  if (status === 401) return "The Anthropic API key isn't valid. Check ANTHROPIC_API_KEY in Vercel, then redeploy.";
  if (/credit balance/i.test(err.message))
    return "The Anthropic account is out of credit. Add credit at platform.claude.com → Billing.";
  if (status === 404 && /model/i.test(err.message))
    return "Anthropic doesn't recognise the model name. Check GIO_CHAT_MODEL in Vercel (or remove it to use the default).";
  if (status === 429) return "Anthropic is rate-limiting this account. Wait a minute and try again.";
  if (status === 529 || status === 503) return "Anthropic is busy right now. Try again in a moment.";
  return err.message;
}
