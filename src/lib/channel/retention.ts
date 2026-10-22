// How long Cinq keeps anything from a messaging conversation, and how often
// it tries to deliver. Stores enforce these on every read and in sweep();
// the provider and Apple keep their own copies on their own terms.

const MINUTE = 60_000;
const HOUR = 60 * MINUTE;
const DAY = 24 * HOUR;

export interface Retention {
  /** A conversation's context (advisor histories, photos, a waiting question) lasts this long after its last event. */
  contextMs: number;
  /** After an event is handled its content is cleared at once; its id is kept this long to recognise redeliveries. */
  eventIdMs: number;
  /** A delivered, cancelled or abandoned reply's content is cleared at once; its record is kept this long. */
  outboxRecordMs: number;
}

export const DEFAULT_CONTEXT_HOURS = 24;

export function retention(contextHours = process.env.MESSAGES_CONTEXT_HOURS): Retention {
  const n = Number(contextHours);
  const hours = contextHours?.trim() && Number.isFinite(n) && n >= 1 && n <= 72 ? n : DEFAULT_CONTEXT_HOURS;
  return { contextMs: hours * HOUR, eventIdMs: 7 * DAY, outboxRecordMs: 7 * DAY };
}

/** Waits before each retry of a reply that failed to send; after the last, the reply is abandoned. */
export const RETRY_BACKOFF_MS = [10_000, 30_000, 2 * MINUTE, 10 * MINUTE, 30 * MINUTE];
/** The first try plus one per backoff step. */
export const MAX_SEND_ATTEMPTS = RETRY_BACKOFF_MS.length + 1;
