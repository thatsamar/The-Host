import "server-only";
import { getCache } from "@vercel/functions";
import type { AnswerPhase, WebSourceRef } from "@/lib/ai/types";
import type { AskEvent } from "./ask";

/**
 * An answer in progress, kept briefly in Vercel's Runtime Cache so a visitor
 * whose phone suspended the page can pick it up on return. It holds the answer
 * only, never the question, photos or earlier turns, and expires on its own.
 */
export interface AnswerSnapshot {
  phase: AnswerPhase | null;
  text: string;
  sources: WebSourceRef[];
  done: boolean;
  error?: string;
}

/** How long a saved answer outlives its last update. */
export const ANSWER_TTL_SECONDS = 15 * 60;
const SAVE_INTERVAL_MS = 1000;

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
export const isAnswerId = (id: unknown): id is string => typeof id === "string" && UUID.test(id);

/**
 * Where saved answers live for this request: Vercel's Runtime Cache, shared by
 * every instance in the region, or (off Vercel, or if it's missing) this
 * instance's own memory, which another instance can't read.
 */
export function answerStore(): "shared" | "instance-memory" {
  const context = (globalThis as Record<symbol, { get?: () => { cache?: unknown } } | undefined>)[
    Symbol.for("@vercel/request-context")
  ]?.get?.();
  return context?.cache ? "shared" : "instance-memory";
}

let warned = false;
function store() {
  if (process.env.VERCEL && !warned && answerStore() === "instance-memory") {
    warned = true;
    console.error("Answer recovery is using this instance's memory: Vercel Runtime Cache isn't available.");
  }
  // The key is the visitor's random answer id, used as is: the default 32-bit
  // key hash could let two visitors' answers collide.
  return getCache({ namespace: "answer", keyHashFunction: (key) => key });
}

// An empty name keeps answer ids out of Vercel's cache observability.
const put = (key: string, value: unknown) => store().set(key, value, { ttl: ANSWER_TTL_SECONDS, name: "" });

export async function loadAnswer(id: string): Promise<AnswerSnapshot | null> {
  return ((await store().get(id)) as AnswerSnapshot | null) ?? null;
}

/** Asks the invocation generating this answer to stop at its next save. */
export async function requestStop(id: string): Promise<void> {
  await put(`${id}:stop`, true);
}

export function applyEvent(snapshot: AnswerSnapshot, event: AskEvent): AnswerSnapshot {
  switch (event.type) {
    case "phase":
      return { ...snapshot, phase: event.phase };
    case "searching":
      return { ...snapshot, phase: "searching" };
    case "text":
      return { ...snapshot, text: snapshot.text + event.text };
    case "sources":
      return { ...snapshot, sources: [...snapshot.sources, ...event.sources] };
    case "done":
      return { ...snapshot, done: true };
    case "error":
      return { ...snapshot, done: true, error: event.message };
  }
}

/** Mirrors one answer into the cache, at most once a second plus once at the end. */
export class AnswerRelay {
  private snapshot: AnswerSnapshot = { phase: null, text: "", sources: [], done: false };
  private lastSave = 0;
  private saving: Promise<void> | null = null;
  private dirty = false;

  constructor(
    private readonly id: string,
    private readonly onStopRequested: () => void,
  ) {}

  /** Saves an empty answer at once, so "not found" means the question never arrived. */
  begin() {
    this.save();
  }

  push(event: AskEvent) {
    this.snapshot = applyEvent(this.snapshot, event);
    if (this.snapshot.done || Date.now() - this.lastSave >= SAVE_INTERVAL_MS) this.save();
    else this.dirty = true;
  }

  /** Saves the final state; never throws, since recovery is best effort. */
  async finish() {
    if (!this.snapshot.done) this.snapshot = { ...this.snapshot, done: true, error: this.snapshot.error ?? "Stopped." };
    this.save();
    while (this.saving) await this.saving;
  }

  private save() {
    if (this.saving) {
      this.dirty = true;
      return;
    }
    this.dirty = false;
    this.lastSave = Date.now();
    const snapshot = this.snapshot;
    this.saving = (async () => {
      try {
        await put(this.id, snapshot);
        if (!snapshot.done && (await store().get(`${this.id}:stop`))) this.onStopRequested();
      } catch (err) {
        console.error("Couldn't save an answer for recovery:", err instanceof Error ? err.message : err);
      }
    })().finally(() => {
      this.saving = null;
      if (this.dirty && (this.snapshot.done || Date.now() - this.lastSave >= SAVE_INTERVAL_MS)) this.save();
    });
  }
}
