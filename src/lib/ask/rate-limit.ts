// A per-visitor cap on questions, so an open app can't be run up by one
// person. Counts live in each server instance's memory, which is enough to
// stop a runaway visitor; the Anthropic spend limit is the real backstop.

export const DEFAULT_QUESTIONS_PER_HOUR = 40;
const HOUR = 60 * 60 * 1000;

export function createRateLimiter(options: { limit: number; windowMs?: number; now?: () => number }) {
  const { limit, windowMs = HOUR, now = Date.now } = options;
  const hits = new Map<string, number[]>();
  return function check(key: string): { ok: true } | { ok: false; retryAfterSeconds: number } {
    if (limit <= 0) return { ok: true };
    const t = now();
    const recent = (hits.get(key) ?? []).filter((at) => t - at < windowMs);
    if (recent.length >= limit) {
      hits.set(key, recent);
      return { ok: false, retryAfterSeconds: Math.ceil((recent[0] + windowMs - t) / 1000) };
    }
    recent.push(t);
    hits.set(key, recent);
    // Forget idle visitors now and then so the map can't grow without bound.
    if (hits.size > 10_000) for (const [k, times] of hits) if (t - times[times.length - 1] >= windowMs) hits.delete(k);
    return { ok: true };
  };
}

/** The visitor's address as Vercel reports it. */
export function visitorKey(headers: Headers): string {
  return headers.get("x-forwarded-for")?.split(",")[0]?.trim() || headers.get("x-real-ip")?.trim() || "unknown";
}

export function questionsPerHour(value = process.env.QUESTIONS_PER_HOUR): number {
  const n = Number(value);
  return value?.trim() && Number.isFinite(n) && n >= 0 ? Math.floor(n) : DEFAULT_QUESTIONS_PER_HOUR;
}
