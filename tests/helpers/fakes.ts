import type { ChatProvider, ChatRequest, ChatStreamEvent } from "@/lib/ai/types";

export class ScriptedProvider implements ChatProvider {
  requests: ChatRequest[] = [];
  constructor(private readonly script: (req: ChatRequest) => ChatStreamEvent[] | Error) {}

  async *streamChat(request: ChatRequest): AsyncIterable<ChatStreamEvent> {
    this.requests.push(request);
    const result = this.script(request);
    if (result instanceof Error) throw result;
    for (const event of result) yield event;
  }
}

export function replyWith(text: string, extra: Partial<Extract<ChatStreamEvent, { type: "done" }>> = {}) {
  const chunks = text.match(/[\s\S]{1,8}/g) ?? [];
  return (): ChatStreamEvent[] => [
    ...chunks.map((t) => ({ type: "text" as const, text: t })),
    {
      type: "done",
      text,
      model: "test-model",
      stopReason: "end_turn",
      usage: { input_tokens: 10, output_tokens: 5 },
      webSearches: [],
      webSources: [],
      ...extra,
    },
  ];
}

export async function collect<T>(gen: AsyncIterable<T>): Promise<T[]> {
  const out: T[] = [];
  for await (const item of gen) out.push(item);
  return out;
}
