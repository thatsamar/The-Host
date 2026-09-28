import "server-only";
import Anthropic from "@anthropic-ai/sdk";
import { serverEnv } from "@/lib/env";
import { AnthropicBackgroundModel, AnthropicChatProvider } from "./anthropic";
import type { BackgroundModel, ChatProvider } from "./types";

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

export function getBackgroundModel(): BackgroundModel {
  return new AnthropicBackgroundModel(anthropic(), serverEnv().GIO_BACKGROUND_MODEL);
}

export type * from "./types";
