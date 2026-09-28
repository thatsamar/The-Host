import type { EmbeddingProvider } from "./types";

// Voyage AI embeddings over REST: POST {baseUrl}/embeddings with snake_case
// fields (input, model, input_type, output_dimension, truncation).
const DEFAULT_BASE_URL = "https://api.voyageai.com/v1";
// The API accepts at most 128 inputs per request; stay well under the
// per-request token cap too.
const BATCH_SIZE = 64;
const MAX_RETRIES = 3;

type FetchLike = (input: string, init: RequestInit) => Promise<Response>;

export class VoyageError extends Error {
  constructor(
    message: string,
    readonly status?: number,
  ) {
    super(message);
  }
}

export class VoyageEmbeddingProvider implements EmbeddingProvider {
  private readonly baseUrl: string;
  private readonly fetchImpl: FetchLike;
  private readonly sleep: (ms: number) => Promise<void>;

  constructor(
    private readonly apiKey: string,
    readonly model: string,
    readonly dimension: number,
    options: { baseUrl?: string; fetch?: FetchLike; sleep?: (ms: number) => Promise<void> } = {},
  ) {
    this.baseUrl = (options.baseUrl ?? DEFAULT_BASE_URL).replace(/\/$/, "");
    this.fetchImpl = options.fetch ?? ((input, init) => fetch(input, init));
    this.sleep = options.sleep ?? ((ms) => new Promise((r) => setTimeout(r, ms)));
  }

  async embed(texts: string[], inputType: "document" | "query"): Promise<number[][]> {
    const out: number[][] = [];
    for (let i = 0; i < texts.length; i += BATCH_SIZE) {
      out.push(...(await this.embedBatch(texts.slice(i, i + BATCH_SIZE), inputType)));
    }
    return out;
  }

  private async embedBatch(input: string[], inputType: "document" | "query"): Promise<number[][]> {
    if (!input.length) return [];
    const body = JSON.stringify({
      input,
      model: this.model,
      input_type: inputType,
      output_dimension: this.dimension,
      truncation: true,
    });

    for (let attempt = 0; ; attempt++) {
      let response: Response;
      try {
        response = await this.fetchImpl(`${this.baseUrl}/embeddings`, {
          method: "POST",
          headers: { "Content-Type": "application/json", Authorization: `Bearer ${this.apiKey}` },
          body,
        });
      } catch (err) {
        if (attempt < MAX_RETRIES) {
          await this.sleep(1000 * 2 ** attempt);
          continue;
        }
        throw new VoyageError(`Couldn't reach Voyage AI: ${err instanceof Error ? err.message : String(err)}`);
      }

      if (response.ok) {
        const json = (await response.json()) as { data?: { embedding?: number[]; index?: number }[] };
        const data = [...(json.data ?? [])].sort((a, b) => (a.index ?? 0) - (b.index ?? 0));
        if (data.length !== input.length) {
          throw new VoyageError(`Voyage returned ${data.length} embeddings for ${input.length} inputs`);
        }
        return data.map((d) => {
          const vector = d.embedding ?? [];
          if (vector.length !== this.dimension) {
            throw new VoyageError(
              `Voyage returned ${vector.length}-dimension vectors; EMBEDDING_DIMENSION is ${this.dimension}.`,
            );
          }
          return vector;
        });
      }

      const retryable = response.status === 429 || response.status >= 500;
      if (retryable && attempt < MAX_RETRIES) {
        await this.sleep(1000 * 2 ** attempt);
        continue;
      }
      const detail = await response.text().catch(() => "");
      if (response.status === 401 || response.status === 403) {
        throw new VoyageError("Voyage AI rejected the API key. Check VOYAGE_API_KEY.", response.status);
      }
      throw new VoyageError(`Voyage AI error ${response.status}: ${detail.slice(0, 200)}`, response.status);
    }
  }
}
