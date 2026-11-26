import { describe, expect, it } from "vitest";
import {
  ACK_TEXTS,
  FALLBACK_TEXT,
  STALLED_MS,
  STALLED_TEXT,
  STILL_THINKING_MS,
  STILL_THINKING_TEXT,
  processSms,
  type SmsDeps,
  type SmsInbound,
} from "../src/lib/sms/handler";
import { MemorySmsStore } from "../src/lib/sms/store";

const sleep = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms));
let sid = 0;

/** A number with Gio picked; `answer` decides how each ask behaves. Timings shortened: 30 ms and 120 ms. */
async function setup(answer: (signal?: AbortSignal) => Promise<string>) {
  const store = new MemorySmsStore();
  const acks: string[] = [];
  const signals: AbortSignal[] = [];
  const deps: SmsDeps = {
    store,
    ask: async (_id, _turns, context) => {
      if (context?.signal) signals.push(context.signal);
      return answer(context?.signal);
    },
    acknowledge: (text) => {
      acks.push(text);
    },
    timing: { stillThinkingMs: 30, stalledMs: 120 },
  };
  const send = (body: string, extra: Partial<SmsInbound> = {}) =>
    processSms({ from: "+15558880000", body, media: [], messageSid: `SMthink${++sid}`, ...extra }, deps);
  await send("START");
  await send("3");
  return { store, acks, signals, send };
}

describe("a slow answer is never a silent one", () => {
  it("waits about 25 seconds before Still thinking..., and gives up at 150", () => {
    expect(STILL_THINKING_MS).toBe(25_000);
    expect(STALLED_MS).toBe(150_000);
    expect(STALLED_MS).toBeLessThan(300_000 - 60_000); // well inside the webhook's maxDuration
  });

  it("sends nothing extra when the answer is quick", async () => {
    const t = await setup(async () => "A low linen sofa.");
    expect(await t.send("What sofa?")).toEqual(["Gio: A low linen sofa."]);
    await sleep(60);
    expect(t.acks).toEqual([ACK_TEXTS[0]]);
  });

  it("sends Still thinking... once, after the ack, then the answer", async () => {
    const t = await setup(async () => {
      await sleep(80);
      return "A low linen sofa.";
    });
    expect(await t.send("What sofa?")).toEqual(["Gio: A low linen sofa."]);
    expect(t.acks).toEqual([ACK_TEXTS[0], STILL_THINKING_TEXT]);
    // History keeps the exchange as usual, without the holding lines.
    const gio = (await t.store.getSession("+15558880000"))!.turnsByAdvisor.gio!;
    expect(gio.map((turn) => turn.text)).toEqual(["What sofa?", "A low linen sofa."]);
  });

  it("gives up on a stalled answer with an apology, stops the model call, and stores nothing of it", async () => {
    const t = await setup((signal) => new Promise((_, reject) => signal?.addEventListener("abort", () => reject(new Error("aborted")))));
    expect(await t.send("What sofa?")).toEqual([STALLED_TEXT]);
    expect(t.acks).toEqual([ACK_TEXTS[0], STILL_THINKING_TEXT]);
    expect(t.signals.at(-1)!.aborted).toBe(true);
    const session = (await t.store.getSession("+15558880000"))!;
    expect(session.turnsByAdvisor.gio ?? []).toEqual([]);
    // The ack still rotates next time.
    expect(session.lastAck).toBe(0);
  });

  it("drops an answer that arrives after the apology", async () => {
    const t = await setup(async () => {
      await sleep(200);
      return "Too late.";
    });
    expect(await t.send("What sofa?")).toEqual([STALLED_TEXT]);
    await sleep(120);
    expect((await t.store.getSession("+15558880000"))!.turnsByAdvisor.gio ?? []).toEqual([]);
  });

  it("keeps the usual fallback for an answer that fails rather than stalls", async () => {
    const t = await setup(async () => {
      throw new Error("ask_error");
    });
    expect(await t.send("What sofa?")).toEqual([FALLBACK_TEXT]);
    expect(t.acks).toEqual([ACK_TEXTS[0]]);
  });

  it("apologises on a stalled handoff too, and keeps the offer so YES can try again", async () => {
    let calls = 0;
    const t = await setup(async (signal) => {
      calls += 1;
      if (calls === 1) return "A rug anchors it.\n[[suggest:martini]]";
      return new Promise((_, reject) => signal?.addEventListener("abort", () => reject(new Error("aborted"))));
    });
    expect((await t.send("What rug?"))[0]).toMatch(/Want me to bring in Martine\?$/);
    expect(await t.send("Yes")).toEqual([STALLED_TEXT]);
    expect((await t.store.getSession("+15558880000"))!.pendingHandoff).toEqual({ from: "gio", to: "martini" });
  });
});
