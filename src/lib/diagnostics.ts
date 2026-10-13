// What server logs may say about a failure: fixed codes, numbers and
// identifiers only. Error messages are never logged, since some (an API
// validation error, a tool input the SDK couldn't parse) can quote what the
// person asked; answer ids never are either, since they unlock a saved answer.

const TOKEN = /^[A-Za-z][A-Za-z0-9_.-]{0,63}$/;

/** A code-like value (an error class, an API error type, a request id), or nothing. */
export const safeToken = (value: unknown): string | undefined =>
  typeof value === "string" && TOKEN.test(value) ? value : undefined;

/** The error's class name, e.g. "TypeError", never its message. */
export const errorClass = (err: unknown): string =>
  (err instanceof Error && safeToken(err.name)) || (err === null ? "null" : typeof err);
