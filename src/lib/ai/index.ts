import "server-only";
import Anthropic from "@anthropic-ai/sdk";
import { serverEnv } from "@/lib/env";
import { AnthropicChatProvider } from "./anthropic";
import type { Companion } from "@/lib/companions/types";
import type { ChatProvider } from "./types";

let client: Anthropic | undefined;

function anthropic(): Anthropic {
  const env = serverEnv();
  client ??= new Anthropic({
    apiKey: env.ANTHROPIC_API_KEY,
    ...(env.ANTHROPIC_BASE_URL ? { baseURL: env.ANTHROPIC_BASE_URL } : {}),
  });
  return client;
}

export function getChatProvider(companion: Companion): ChatProvider {
  const env = serverEnv();
  return new AnthropicChatProvider(anthropic(), env.CHAT_MODEL, {
    effort: env.CHAT_EFFORT,
    webSearchMaxUses: env.WEB_SEARCH_MAX_USES ?? companion.webSearchMaxUses,
    name: companion.name,
  });
}

export type * from "./types";
