import { describe, expect, it } from "vitest";
import { fitToBudget } from "@/lib/gio/budget";

const img = (size: number) => ({ mediaType: "image/jpeg", data: "a".repeat(size) });

describe("fitToBudget", () => {
  it("leaves a request that fits alone", () => {
    const turns = [{ role: "user" as const, text: "Hi", images: [img(10)] }];
    expect(fitToBudget(turns, 100)).toEqual(turns);
  });

  it("drops the oldest photos first and leaves a note in their place", () => {
    const out = fitToBudget(
      [
        { role: "user", text: "", images: [img(40), img(40)] },
        { role: "assistant", text: "Nice." },
        { role: "user", text: "And this?", images: [img(40)] },
        { role: "assistant", text: "Better." },
        { role: "user", text: "Now?", images: [img(40)] },
      ],
      150,
    );
    expect(out[0]).toEqual({ role: "user", text: "(2 photos were shared here earlier.)", images: [] });
    expect(out[2].images).toHaveLength(1);
    expect(out[4].images).toHaveLength(1);
  });

  it("never drops the latest question's photos; says so when they alone are too big", () => {
    expect(() => fitToBudget([{ role: "user", text: "", images: [img(200)] }], 100)).toThrow(/too large/);
  });
});
