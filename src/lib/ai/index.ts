import "server-only";
import Anthropic from "@anthropic-ai/sdk";
import { serverEnv } from "@/lib/env";
import { AnthropicChatProvider } from "./anthropic";
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

export function getChatProvider(): ChatProvider {
  const env = serverEnv();
  return new AnthropicChatProvider(anthropic(), env.GIO_CHAT_MODEL, {
    effort: env.GIO_CHAT_EFFORT,
    webSearchMaxUses: env.GIO_WEB_SEARCH_MAX_USES,
  });
}

export type * from "./types";
