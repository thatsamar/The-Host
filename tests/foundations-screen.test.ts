import { describe, expect, it } from "vitest";
import type { AskEvent } from "@/lib/ask/ask";
import { buildLeakIndex, checkLeak } from "@/lib/foundations/leak-guard";
import { CONTINUE_INSTRUCTION, continuationTurns, HOLD_WORDS, screenAnswer, type ScreenStats } from "@/lib/foundations/screen";
import { collect } from "./helpers/fakes";

// Stand-in text only: real foundations never enter the repository.
const FOUNDATION =
  "Stand-in principle one. A lantern is better judged at dusk than at noon, because the light it gives depends on the dark around it. " +
  "Stand-in principle two. Kettles, harbours and the patience of slow bread on a cold morning in a small kitchen teach more than any manual.";
const SECRET = "a lantern is better judged at dusk than at noon, because the light it gives depends on the dark around it.";
const index = buildLeakIndex(FOUNDATION);

/** A model's events: the text in small pieces, then done. */
async function* stream(text: string, end: AskEvent = { type: "done" }): AsyncGenerator<AskEvent> {
  yield { type: "phase", phase: "writing" };
  for (const piece of text.match(/[\s\S]{1,7}/g) ?? []) yield { type: "text", text: piece };
  yield end;
}

const textOf = (events: AskEvent[]) => events.flatMap((e) => (e.type === "text" ? [e.text] : [])).join("");
const normalized = (s: string) => s.toLowerCase().replace(/[^a-z ]+/g, " ").replace(/\s+/g, " ");

describe("pre-release screening on the website", () => {
  it("releases a clean answer unchanged, holding back only its last words until the end", async () => {
    const answer = "Go in the evening, when the lamps come on and the street settles. ".repeat(6).trim();
    const releases: string[] = [];
    let seen = "";
    for await (const e of screenAnswer(stream(answer), { index, continueFrom: () => stream("unused") })) {
      if (e.type === "text") {
        releases.push(e.text);
        seen += e.text;
      }
    }
    expect(seen).toBe(answer);
    // Something came out before the end, and what was held at most was the hold-back.
    expect(releases.length).toBeGreaterThan(1);
    const beforeEnd = releases.slice(0, -1).join("");
    expect(answer.slice(beforeEnd.length).split(/\s+/).filter(Boolean).length).toBeLessThanOrEqual(HOLD_WORDS + 1);
  });

  it("never releases a matching span, and continues once in the advisor's own words", async () => {
    const answer = `Go at dusk. The lamps are lit by then. As I always say, ${SECRET} That is the whole trick.`;
    const continuations: string[] = [];
    const stats: ScreenStats = { hits: 0, continued: false };
    const events = await collect(
      screenAnswer(stream(answer), {
        index,
        stats,
        continueFrom: (clean) => {
          continuations.push(clean);
          return stream("Evening light flatters old glass, so that is when to look.");
        },
      }),
    );
    const out = textOf(events);
    expect(normalized(out)).not.toContain(normalized("better judged at dusk than at noon"));
    expect(checkLeak(out, index).leaked).toBe(false);
    // Cut at the last clean sentence, then the continuation.
    expect(continuations).toEqual(["Go at dusk. The lamps are lit by then."]);
    expect(out).toBe("Go at dusk. The lamps are lit by then. Evening light flatters old glass, so that is when to look.");
    expect(events.at(-1)).toEqual({ type: "done" });
    expect(stats).toMatchObject({ hits: 1, continued: true });
  });

  it("ends cleanly at the cut when the continuation matches again", async () => {
    const answer = `First, go late. ${SECRET}`;
    const stats: ScreenStats = { hits: 0, continued: false };
    const events = await collect(screenAnswer(stream(answer), { index, stats, continueFrom: () => stream(`Again: ${SECRET}`) }));
    expect(textOf(events)).toBe("First, go late.");
    expect(events.at(-1)).toEqual({ type: "done" });
    expect(stats).toMatchObject({ hits: 2, continued: true });
  });

  it("ends cleanly at the cut when the continuation fails", async () => {
    const events = await collect(
      screenAnswer(stream(`First, go late. ${SECRET}`), { index, continueFrom: () => stream("", { type: "error", message: "Overloaded." }) }),
    );
    expect(textOf(events)).toBe("First, go late.");
    expect(events.at(-1)).toEqual({ type: "done" });
  });

  it("says no answer came back when nothing clean could be released", async () => {
    const events = await collect(screenAnswer(stream(SECRET), { index, continueFrom: () => stream(SECRET) }));
    expect(textOf(events)).toBe("");
    expect(events.at(-1)).toMatchObject({ type: "error", message: "No answer came back. Try again." });
  });

  it("catches several shorter phrases, cutting before the one that tips it", async () => {
    const answer =
      "Think of kettles, harbours and the patience of slow bread. Also the light it gives depends on the dark, mostly. And on a cold morning in a small kitchen, everything is clearer.";
    const events = await collect(screenAnswer(stream(answer), { index, continueFrom: () => stream("Mornings are honest.") }));
    const out = textOf(events);
    expect(out).not.toContain("cold morning in a small kitchen");
    expect(out.endsWith("Mornings are honest.")).toBe(true);
  });

  it("passes a stop through, releasing only checked text and asking no continuation", async () => {
    let asked = 0;
    const events = await collect(
      screenAnswer(stream("Go at dusk, it is calmer then.", { type: "error", message: "Stopped." }), { index, continueFrom: () => (asked++, stream("never")) }),
    );
    expect(textOf(events)).toBe("Go at dusk, it is calmer then.");
    expect(events.at(-1)).toEqual({ type: "error", message: "Stopped." });
    expect(asked).toBe(0);
  });

  it("passes a stop (or the time limit) during the continuation through, after the clean text", async () => {
    const events = await collect(
      screenAnswer(stream(`Go at dusk. ${SECRET}`), { index, continueFrom: () => stream(" Evening light is kind", { type: "error", message: "Stopped." }) }),
    );
    expect(textOf(events)).toBe("Go at dusk. Evening light is kind");
    expect(events.at(-1)).toEqual({ type: "error", message: "Stopped." });
  });

  it("keeps an ordinary error from the model, with the clean text before it", async () => {
    const events = await collect(screenAnswer(stream("Go at dusk, it is calmer.", { type: "error", message: "This answer reached its length limit before it finished." }), { index, continueFrom: () => stream("x") }));
    expect(textOf(events)).toBe("Go at dusk, it is calmer.");
    expect(events.at(-1)).toMatchObject({ type: "error" });
  });

  it("ignores common phrases the foundation happens to share", async () => {
    const common = buildLeakIndex("At the end of the day it is what it is, and you have to do what you can with what you have.");
    const answer = "At the end of the day it is what it is, and you have to do what you can with what you have. Book the earlier table.";
    expect(checkLeak(answer, common).leaked).toBe(false);
    expect(textOf(await collect(screenAnswer(stream(answer), { index: common, continueFrom: () => stream("x") })))).toBe(answer);
  });

  it("asks for the continuation with the clean text and an instruction that names nothing private", () => {
    const turns = [{ role: "user" as const, text: "Where should I go?" }];
    expect(continuationTurns(turns, "Go at dusk.")).toEqual([...turns, { role: "assistant", text: "Go at dusk." }, { role: "user", text: CONTINUE_INSTRUCTION }]);
    expect(continuationTurns(turns, "")).toEqual([{ role: "user", text: `Where should I go?\n\n(${CONTINUE_INSTRUCTION})` }]);
  });

  it("adds little work: a long answer against a long foundation screens in milliseconds", async () => {
    const big = Array.from({ length: 4000 }, (_, i) => `stand${i % 997} word${(i * 7) % 991} item${(i * 13) % 983}`).join(" ");
    const bigIndex = buildLeakIndex(big);
    const answer = "Go in the evening, when the lamps come on and the street settles down for the night. ".repeat(80);
    const began = performance.now();
    const out = textOf(await collect(screenAnswer(stream(answer), { index: bigIndex, continueFrom: () => stream("x") })));
    const ms = performance.now() - began;
    expect(out).toBe(answer);
    expect(ms).toBeLessThan(500);
  });
});
