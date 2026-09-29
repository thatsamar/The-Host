import { describe, expect, it } from "vitest";
import { readNdjson } from "@/lib/ask/ndjson";
import { collect } from "./helpers/fakes";

function streamOf(chunks: string[]) {
  const enc = new TextEncoder();
  return new ReadableStream<Uint8Array>({
    start(controller) {
      chunks.forEach((c) => controller.enqueue(enc.encode(c)));
      controller.close();
    },
  });
}

describe("readNdjson", () => {
  it("parses lines split across chunks, including multibyte characters", async () => {
    const out = await collect(readNdjson(streamOf(['{"a":1}\n{"b":"caf', 'é — ok"}\n', '\n{"c":3}'])));
    expect(out).toEqual([{ a: 1 }, { b: "café — ok" }, { c: 3 }]);
  });
});
