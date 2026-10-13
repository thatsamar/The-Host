import { describe, expect, it } from "vitest";
import type { AnswerSnapshot } from "@/lib/ask/relay";
import {
  ANSWER_LIMIT_MS,
  CONNECT_BASE_MS,
  SILENCE_MS,
  STALE_MS,
  UNREACHABLE_MS,
  connectTimeoutMs,
  connectionAbandoned,
  recoverAnswer,
  type SavedRead,
} from "@/lib/ask/recovery";

const MIN = 60_000;
const answer = (over: Partial<AnswerSnapshot>): AnswerSnapshot => ({ phase: "writing", text: "", sources: [], done: false, ...over });

/** Runs recovery on a fake clock; `script` decides what each read returns at that moment. */
async function recoverAt(options: {
  start: number;
  connectedAt?: number;
  script: (now: number) => SavedRead;
  visible?: (now: number) => boolean;
}) {
  let now = options.start;
  const reads: number[] = [];
  const progress: AnswerSnapshot[] = [];
  const result = await recoverAnswer({
    connectedAt: options.connectedAt,
    read: async () => {
      reads.push(now);
      return options.script(now);
    },
    visible: () => options.visible?.(now) ?? true,
    wait: async (ms) => void (now += ms),
    now: () => now,
    stopped: () => false,
    onProgress: (saved) => progress.push(saved),
  });
  return { result, reads, progress, endedAt: now };
}

describe("returning to the page after the connection went", () => {
  it("shows an answer that finished while away, even seven minutes later", async () => {
    const done = answer({ text: "The full plan.", done: true });
    const { result, reads, progress } = await recoverAt({
      start: 7 * MIN,
      connectedAt: 0,
      script: () => ({ status: "found", saved: done }),
    });
    expect(result).toEqual({ outcome: "answered" });
    expect(reads).toHaveLength(1);
    expect(progress.at(-1)?.text).toBe("The full plan.");
  });

  it("shows how the server ended an answer, seven minutes later, as settled rather than lost", async () => {
    const ended = answer({ text: "Start with drainage.", done: true, error: "Gio ran out of time before finishing this answer. Try again." });
    const { result, reads, progress } = await recoverAt({
      start: 7 * MIN,
      connectedAt: 0,
      script: () => ({ status: "found", saved: ended }),
    });
    expect(result).toEqual({ outcome: "failed", reason: "server", error: ended.error });
    expect(reads).toHaveLength(1);
    expect(progress.at(-1)?.text).toBe("Start with drainage.");
  });

  it("keeps collecting an unfinished answer that is still moving, until it finishes", async () => {
    // Back after 90 s; the answer finishes 60 s later.
    const { result, progress } = await recoverAt({
      start: 90_000,
      connectedAt: 0,
      script: (now) =>
        now < 150_000
          ? { status: "found", saved: answer({ text: "Start".padEnd(Math.floor(now / 1000), "."), updatedAt: now }) }
          : { status: "found", saved: answer({ text: "Start with the east strip.", done: true }) },
    });
    expect(result).toEqual({ outcome: "answered" });
    expect(progress.at(-1)?.text).toBe("Start with the east strip.");
  });

  it("gives up on an answer still unfinished seven minutes after the server got it, keeping its text", async () => {
    const { result, reads, progress } = await recoverAt({
      start: 7 * MIN,
      connectedAt: 0,
      script: (now) => ({ status: "found", saved: answer({ text: "Start with", updatedAt: now }) }),
    });
    expect(result).toEqual({ outcome: "failed", reason: "stale" });
    expect(reads).toHaveLength(1); // read first, then the deadline applies
    expect(progress.at(-1)?.text).toBe("Start with");
  });

  it("gives up on an unfinished answer that stops moving", async () => {
    const stuck = answer({ text: "Start with", updatedAt: 1 });
    const { result, endedAt } = await recoverAt({ start: 60_000, connectedAt: 0, script: () => ({ status: "found", saved: stuck }) });
    expect(result).toEqual({ outcome: "failed", reason: "stale" });
    expect(endedAt - 60_000).toBeGreaterThan(STALE_MS);
    expect(endedAt - 60_000).toBeLessThan(STALE_MS + 5_000);
  });

  it("waits while the page is hidden and reads as soon as it's back", async () => {
    const done = answer({ text: "Done.", done: true });
    const { result, reads } = await recoverAt({
      start: 0,
      connectedAt: 0,
      visible: (now) => now >= 8 * MIN,
      script: () => ({ status: "found", saved: done }),
    });
    expect(result).toEqual({ outcome: "answered" });
    expect(reads).toHaveLength(1);
    expect(reads[0]).toBeGreaterThanOrEqual(8 * MIN);
  });

  it("decides the question never arrived after repeated not-found replies", async () => {
    const { result } = await recoverAt({ start: 0, script: () => ({ status: "missing" }) });
    expect(result).toEqual({ outcome: "failed", reason: "lost" });
  });

  it("stops trying when the server can't be reached at all", async () => {
    const { result, endedAt } = await recoverAt({ start: 0, script: () => ({ status: "unreachable" }) });
    expect(result).toEqual({ outcome: "failed", reason: "lost" });
    expect(endedAt).toBeGreaterThan(UNREACHABLE_MS);
  });
});

describe("a slow photo upload", () => {
  const photos = 2_650_000; // three phone photos, as sent
  const textOnly = 1_000;

  it("gets time to upload in proportion to its size", () => {
    expect(connectTimeoutMs(textOnly)).toBeLessThan(CONNECT_BASE_MS + 1_000);
    expect(connectTimeoutMs(photos)).toBeGreaterThan(CONNECT_BASE_MS + 150_000);
  });

  it("isn't abandoned while three photos are still uploading, but a stuck text question is", () => {
    const uploading = { connected: false, lastEventAt: 0, now: 150_000 };
    expect(connectionAbandoned({ ...uploading, bodyBytes: photos })).toBe(false);
    expect(connectionAbandoned({ ...uploading, bodyBytes: textOnly })).toBe(true);
    expect(connectionAbandoned({ connected: false, lastEventAt: 0, now: 300_000, bodyBytes: photos })).toBe(true);
  });

  it("once connected, is judged on the server's heartbeat, not upload size", () => {
    const live = { connected: true, lastEventAt: 0, bodyBytes: photos };
    expect(connectionAbandoned({ ...live, now: SILENCE_MS - 1_000 })).toBe(false);
    expect(connectionAbandoned({ ...live, now: SILENCE_MS + 1_000 })).toBe(true);
  });

  it("when the connection went during the upload, times the answer from when the server had it, not from sending", async () => {
    // Sent at 0; upload took minutes; the connection went before the server replied.
    // The page reads at 6.5 min: in progress; the server finishes it a minute later.
    const { result } = await recoverAt({
      start: 6.5 * MIN,
      connectedAt: undefined,
      script: (now) =>
        now < 7.5 * MIN
          ? { status: "found", saved: answer({ phase: "thinking", updatedAt: now }) }
          : { status: "found", saved: answer({ text: "The plan.", done: true }) },
    });
    expect(result).toEqual({ outcome: "answered" });
  });

  it("still bounds an unconnected answer by the server's limit from the first read", async () => {
    const { result, endedAt } = await recoverAt({
      start: 6.5 * MIN,
      connectedAt: undefined,
      script: (now) => ({ status: "found", saved: answer({ phase: "thinking", updatedAt: now }) }),
    });
    expect(result).toEqual({ outcome: "failed", reason: "stale" });
    expect(endedAt).toBeGreaterThan(6.5 * MIN + ANSWER_LIMIT_MS);
  });
});
