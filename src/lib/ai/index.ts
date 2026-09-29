import "server-only";
import Anthropic from "@anthropic-ai/sdk";
import { serverEnv } from "@/lib/env";
import { AnthropicBackgroundModel, AnthropicChatProvider } from "./anthropic";
import type { BackgroundModel, ChatProvider, EmbeddingProvider } from "./types";
import { VoyageEmbeddingProvider } from "./voyage";

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

/** Throws a readable error if Voyage isn't configured. */
export function getEmbeddingProvider(): EmbeddingProvider {
  const env = serverEnv();
  if (!env.VOYAGE_API_KEY) {
    throw new Error("Embeddings aren't configured: set VOYAGE_API_KEY to index and search the library.");
  }
  return new VoyageEmbeddingProvider(env.VOYAGE_API_KEY, env.EMBEDDING_MODEL, env.EMBEDDING_DIMENSION, {
    baseUrl: env.VOYAGE_BASE_URL,
  });
}

export type * from "./types";
