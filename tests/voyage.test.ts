import { describe, expect, it } from "vitest";
import { VoyageEmbeddingProvider } from "@/lib/ai/voyage";

function fakeFetch(handler: (body: { input: string[]; [k: string]: unknown }, call: number) => Response) {
  const calls: { url: string; init: RequestInit; body: { input: string[]; [k: string]: unknown } }[] = [];
  const fn = async (url: string, init: RequestInit) => {
    const body = JSON.parse(String(init.body));
    calls.push({ url, init, body });
    return handler(body, calls.length);
  };
  return { fn, calls };
}

const vectors = (n: number, dim: number, reverse = false) => {
  const data = Array.from({ length: n }, (_, i) => ({ index: i, embedding: new Array(dim).fill(i) }));
  return { data: reverse ? data.reverse() : data };
};

const noSleep = async () => {};

describe("VoyageEmbeddingProvider", () => {
  it("sends the documented request shape and returns vectors in input order", async () => {
    const { fn, calls } = fakeFetch((b) => Response.json(vectors(b.input.length, 4, true)));
    const voyage = new VoyageEmbeddingProvider("key", "voyage-4", 4, { fetch: fn, sleep: noSleep });
    const out = await voyage.embed(["a", "b", "c"], "document");
    expect(out.map((v) => v[0])).toEqual([0, 1, 2]);
    expect(calls[0].url).toBe("https://api.voyageai.com/v1/embeddings");
    expect(calls[0].body).toEqual({ input: ["a", "b", "c"], model: "voyage-4", input_type: "document", output_dimension: 4, truncation: true });
    expect((calls[0].init.headers as Record<string, string>).Authorization).toBe("Bearer key");
  });

  it("batches large inputs", async () => {
    const { fn, calls } = fakeFetch((b) => Response.json(vectors(b.input.length, 2)));
    const voyage = new VoyageEmbeddingProvider("key", "voyage-4", 2, { fetch: fn, sleep: noSleep });
    const out = await voyage.embed(Array.from({ length: 150 }, (_, i) => `t${i}`), "query");
    expect(out).toHaveLength(150);
    expect(calls.map((c) => c.body.input.length)).toEqual([64, 64, 22]);
    expect(calls[0].body.input_type).toBe("query");
  });

  it("retries rate limits and server errors, then succeeds", async () => {
    const { fn, calls } = fakeFetch((b, n) => (n < 3 ? new Response("busy", { status: n === 1 ? 429 : 503 }) : Response.json(vectors(b.input.length, 2))));
    const voyage = new VoyageEmbeddingProvider("key", "voyage-4", 2, { fetch: fn, sleep: noSleep });
    expect(await voyage.embed(["x"], "query")).toHaveLength(1);
    expect(calls).toHaveLength(3);
  });

  it("gives a clear error for a bad key and doesn't retry it", async () => {
    const { fn, calls } = fakeFetch(() => new Response("nope", { status: 401 }));
    const voyage = new VoyageEmbeddingProvider("key", "voyage-4", 2, { fetch: fn, sleep: noSleep });
    await expect(voyage.embed(["x"], "query")).rejects.toThrow("VOYAGE_API_KEY");
    expect(calls).toHaveLength(1);
  });

  it("refuses vectors whose size doesn't match the database column", async () => {
    const { fn } = fakeFetch((b) => Response.json(vectors(b.input.length, 8)));
    const voyage = new VoyageEmbeddingProvider("key", "voyage-4", 1024, { fetch: fn, sleep: noSleep });
    await expect(voyage.embed(["x"], "query")).rejects.toThrow(/EMBEDDING_DIMENSION is 1024/);
  });

  it("returns nothing for no input without calling the API", async () => {
    const { fn, calls } = fakeFetch(() => Response.json({ data: [] }));
    const voyage = new VoyageEmbeddingProvider("key", "voyage-4", 2, { fetch: fn, sleep: noSleep });
    expect(await voyage.embed([], "document")).toEqual([]);
    expect(calls).toHaveLength(0);
  });
});
