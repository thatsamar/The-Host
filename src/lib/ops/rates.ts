/**
 * Model prices for the dashboard's cost estimate, in US dollars per million
 * tokens: Anthropic's first-party list prices as published on 2026-11-03.
 * Cache-write prices aren't listed per model here, so they use the usual
 * 1.25x of input and are marked as estimates. Check against
 * https://platform.claude.com/docs/en/about-claude/pricing when prices change.
 * A model not listed is counted in tokens only, never guessed in dollars.
 */
export interface ModelRate {
  input: number;
  output: number;
  cacheRead: number;
  cacheWrite: number;
}

const rate = (input: number, output: number, cacheRead = input * 0.1): ModelRate => ({ input, output, cacheRead, cacheWrite: input * 1.25 });

const RATES: [string, ModelRate][] = [
  ["claude-fable-5-2", rate(8, 40, 0.2)],
  ["claude-fable-5-1", rate(10, 50)],
  ["claude-fable-5", rate(10, 50)],
  ["claude-opus-5-5", rate(4, 20, 0.2)],
  ["claude-opus-5", rate(5, 25)],
  ["claude-opus-4-8", rate(5, 25)],
  ["claude-opus-4-7", rate(5, 25)],
  ["claude-opus-4-6", rate(5, 25)],
  ["claude-sonnet-5-5", rate(2, 10, 0.1)],
  ["claude-sonnet-5", rate(2, 10)],
  ["claude-sonnet-4-6", rate(3, 15)],
  ["claude-haiku-5-5", rate(0.1, 0.5)],
  ["claude-haiku-4-5", rate(1, 5)],
];
// Longest first, so "claude-opus-5-5" isn't read as "claude-opus-5".
RATES.sort((a, b) => b[0].length - a[0].length);

export function modelRate(model: string | undefined): ModelRate | null {
  if (!model) return null;
  return RATES.find(([id]) => model === id || model.startsWith(`${id}-`) || model.startsWith(`${id}@`))?.[1] ?? null;
}

/** Estimated dollars for one call's tokens, or null when the model has no listed price. */
export function callCost(call: { model?: string; input?: number; output?: number; cache_read?: number; cache_write?: number }): number | null {
  const r = modelRate(call.model);
  if (!r) return null;
  const m = 1_000_000;
  return ((call.input ?? 0) * r.input + (call.output ?? 0) * r.output + (call.cache_read ?? 0) * r.cacheRead + (call.cache_write ?? 0) * r.cacheWrite) / m;
}
