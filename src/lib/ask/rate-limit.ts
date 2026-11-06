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

/**
 * A per-visitor cap on an amount (characters read aloud) rather than a count,
 * in the same in-memory way as createRateLimiter. The provider's own spend
 * limit is the real backstop.
 */
export function createUsageLimiter(options: { limit: number; windowMs?: number; now?: () => number }) {
  const { limit, windowMs = HOUR, now = Date.now } = options;
  const usage = new Map<string, [at: number, amount: number][]>();
  return function use(key: string, amount: number): { ok: true } | { ok: false; retryAfterSeconds: number } {
    if (limit <= 0) return { ok: true };
    const t = now();
    const recent = (usage.get(key) ?? []).filter(([at]) => t - at < windowMs);
    const used = recent.reduce((sum, [, n]) => sum + n, 0);
    if (used + amount > limit) {
      usage.set(key, recent);
      return { ok: false, retryAfterSeconds: Math.max(1, Math.ceil(((recent[0]?.[0] ?? t) + windowMs - t) / 1000)) };
    }
    recent.push([t, amount]);
    usage.set(key, recent);
    if (usage.size > 10_000) for (const [k, list] of usage) if (t - list[list.length - 1][0] >= windowMs) usage.delete(k);
    return { ok: true };
  };
}

/** Characters each visitor may have read aloud in a natural voice per hour. */
export const DEFAULT_SPOKEN_CHARS_PER_HOUR = 30_000;

export function spokenCharsPerHour(value = process.env.SPOKEN_CHARS_PER_HOUR): number {
  const n = Number(value);
  return value?.trim() && Number.isFinite(n) && n >= 0 ? Math.floor(n) : DEFAULT_SPOKEN_CHARS_PER_HOUR;
}
