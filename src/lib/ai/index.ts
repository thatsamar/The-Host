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

/** `plain`: a careful moment, so errors read plainly rather than in the companion's voice. */
export function getChatProvider(companion: Companion, options: { plain?: boolean } = {}): ChatProvider {
  const env = serverEnv();
  return new AnthropicChatProvider(anthropic(), env.CHAT_MODEL, {
    effort: env.CHAT_EFFORT,
    webSearchMaxUses: env.WEB_SEARCH_MAX_USES ?? companion.webSearchMaxUses,
    name: companion.name,
    ...(companion.errors && !options.plain ? { errors: companion.errors } : {}),
  });
}

export type * from "./types";
