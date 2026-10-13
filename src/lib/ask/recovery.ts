// How the page decides, without a live connection, what happened to an answer.
// Pure and clock-injected so the timing rules can be tested; the page supplies
// the network, visibility and clock.

import type { AnswerSnapshot } from "./relay";

// The server sends something at least every 10 seconds; this much silence on a
// live connection means it died.
export const SILENCE_MS = 30_000;
// Before the server has answered at all, allow for sending the request itself:
// a fixed wait plus time to upload the body on a slow phone connection.
export const CONNECT_BASE_MS = 60_000;
export const SLOW_UPLOAD_BYTES_PER_SECOND = 16_000;
// The server saves a live answer at least every 10 seconds; a saved answer that
// hasn't moved for this long was cut off and won't finish.
export const STALE_MS = 45_000;
// The server ends every answer within 280 seconds of receiving it; past this,
// one still in progress never will finish.
export const ANSWER_LIMIT_MS = 6 * 60_000;
// Consecutive "not found" replies before deciding the question never arrived.
export const RECOVERY_MISSES = 5;
// With no reply at all for this long on a visible page, stop trying.
export const UNREACHABLE_MS = 2 * 60_000;
export const RECOVERY_POLL_MS = 1200;

/** How long to wait for the server to start answering a request of this size. */
export const connectTimeoutMs = (bodyBytes: number) =>
  CONNECT_BASE_MS + Math.ceil((bodyBytes / SLOW_UPLOAD_BYTES_PER_SECOND) * 1000);

/** Whether a visible page should stop waiting on its live connection and collect the answer instead. */
export function connectionAbandoned(state: { connected: boolean; lastEventAt: number; bodyBytes: number; now: number }) {
  const limit = state.connected ? SILENCE_MS : connectTimeoutMs(state.bodyBytes);
  return state.now - state.lastEventAt > limit;
}

export type SavedRead = { status: "found"; saved: AnswerSnapshot } | { status: "missing" } | { status: "unreachable" };

export type RecoveryResult =
  | { outcome: "answered" }
  | { outcome: "stopped" }
  /** The server ended the answer itself (an error, the time limit, a Stop); nothing is left running. */
  | { outcome: "failed"; reason: "server"; error: string }
  /** The question never arrived, or no reply came back. */
  | { outcome: "failed"; reason: "lost" }
  /** The answer stopped moving, or outlived the server's own limit, so it won't finish. */
  | { outcome: "failed"; reason: "stale" };

/**
 * Collects an answer the server kept writing while the page was away. It always
 * reads the saved answer before applying any deadline, so a page that returns
 * late still shows an answer that finished. Deadlines count from when the server
 * received the question (the connection), not from when the page started sending.
 */
export async function recoverAnswer(deps: {
  /** When the server answered the request, if it did before the connection went. */
  connectedAt?: number;
  read: () => Promise<SavedRead>;
  visible: () => boolean;
  wait: (ms: number) => Promise<void>;
  now: () => number;
  stopped: () => boolean;
  /** Each saved copy as it's read, so text written so far shows. */
  onProgress: (saved: AnswerSnapshot) => void;
}): Promise<RecoveryResult> {
  let deadline: number | undefined;
  let misses = 0;
  let seen = "";
  let movedAt = 0;
  let unreachableSince: number | undefined;

  while (!deps.stopped()) {
    if (deps.visible()) {
      const result = await deps.read();
      if (deps.stopped()) break;
      const now = deps.now();
      if (result.status === "unreachable") {
        unreachableSince ??= now;
        if (now - unreachableSince > UNREACHABLE_MS) return { outcome: "failed", reason: "lost" };
      } else {
        unreachableSince = undefined;
        if (result.status === "missing") {
          if (++misses >= RECOVERY_MISSES) return { outcome: "failed", reason: "lost" };
        } else {
          misses = 0;
          const { saved } = result;
          deps.onProgress(saved);
          if (saved.done) {
            if (!saved.error) return { outcome: "answered" };
            return saved.error === "Stopped." ? { outcome: "stopped" } : { outcome: "failed", reason: "server", error: saved.error };
          }
          // Still in progress: only now do deadlines apply. If the connection went
          // before the server answered, it received the question by this read.
          deadline ??= (deps.connectedAt ?? now) + ANSWER_LIMIT_MS;
          const mark = String(saved.updatedAt ?? `${saved.phase}|${saved.text.length}|${saved.sources.length}`);
          if (mark !== seen) {
            seen = mark;
            movedAt = now;
          } else if (now - movedAt > STALE_MS) {
            return { outcome: "failed", reason: "stale" };
          }
          if (now > deadline) return { outcome: "failed", reason: "stale" };
        }
      }
    }
    await deps.wait(RECOVERY_POLL_MS);
  }
  return { outcome: "stopped" };
}
