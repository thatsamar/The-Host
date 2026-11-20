/**
 * Routing a question when no advisor has been picked: the customer never has
 * to pick first. A question that opens by naming an advisor goes to them; a
 * greeting goes to Goldie, who orients; anything else goes to a short model
 * call that names the best fit, and to Goldie when that is unclear or fails.
 * A wrong route is fine: the advisor can offer a handoff.
 */

import { addressedAdvisor, SMS_ADVISORS, tidy, type SmsAdvisorId } from "./navigation";

/** Where a question goes when nothing else fits: the sounding board, Cinq's generalist. */
export const DEFAULT_ADVISOR: SmsAdvisorId = "goldie";

const GREETING = /^(?:hi|hello|hey|hiya|howdy|yo|sup|hola|good (?:morning|afternoon|evening)|hi there|hello there|hey there)(?:[\s,]+(?:there|cinq|everyone|all))?$/;

/** Whether a text is only a greeting ("hi", "hello there", "good morning"). */
export function isGreeting(body: string): boolean {
  return GREETING.test(tidy(body));
}

/** A route that needs no model: an addressed advisor, or Goldie for a greeting. Null means ask the router. */
export function routeShortcut(body: string): SmsAdvisorId | null {
  const text = tidy(body);
  if (!text || GREETING.test(text)) return DEFAULT_ADVISOR;
  return addressedAdvisor(text);
}

/** The router's instructions: one id back, nothing else. */
export const ROUTER_PROMPT = [
  "You route a question to one of Cinq's five advisors. Reply with only the advisor's id, nothing else.",
  "tony: travel: where to go, stay, eat and what to do; trips, cities, hotels, restaurants, bars as places.",
  "martini: personal style: clothes, outfits, shoes, accessories, grooming, what to wear.",
  "gio: design: homes and interiors, furniture, rooms, colours, lighting, art for the home.",
  "alden: drinks: wine, cocktails and spirits, what to order or pour, pairings.",
  "goldie: a sounding board for personal and professional situations and decisions, and anything that fits none of the others.",
  "If the question fits none of the first four clearly, reply goldie.",
].join("\n");

/** Read the router's reply: the first advisor id (or name) it gives, otherwise Goldie. */
export function readRoute(reply: string): SmsAdvisorId {
  const words = reply.toLowerCase().match(/[a-z]+/g) ?? [];
  for (const w of words) {
    const advisor = SMS_ADVISORS.find((a) => a.id === w || a.name.toLowerCase() === w);
    if (advisor) return advisor.id;
  }
  return DEFAULT_ADVISOR;
}

/** How long routing may take before the question goes to Goldie instead. */
export const ROUTE_TIMEOUT_MS = 8_000;

/**
 * Route a question: a shortcut if one applies, otherwise `classify` (a short
 * model call given ROUTER_PROMPT), falling back to Goldie on failure or delay.
 */
export async function routeQuestion(
  question: string,
  photoCount: number,
  classify?: (question: string) => Promise<string>,
): Promise<SmsAdvisorId> {
  const shortcut = question.trim() ? routeShortcut(question) : null;
  if (shortcut) return shortcut;
  if (!classify) return DEFAULT_ADVISOR;
  const asked = question.trim() || `(${photoCount === 1 ? "A photo" : `${photoCount} photos`} with no question.)`;
  let timer: ReturnType<typeof setTimeout> | undefined;
  try {
    const reply = await Promise.race([
      classify(asked),
      new Promise<string>((_, reject) => {
        timer = setTimeout(() => reject(new Error("route_timeout")), ROUTE_TIMEOUT_MS);
      }),
    ]);
    return readRoute(reply);
  } catch {
    return DEFAULT_ADVISOR;
  } finally {
    clearTimeout(timer);
  }
}

/**
 * Each advisor's one-line self-introduction, before their first routed answer
 * to a number. Short and plain GSM-7 (commas, not dashes), so it costs the
 * first text as little room as possible.
 */
export const INTRODUCTIONS: Record<SmsAdvisorId, string> = {
  tony: "I'm Amar, travel at Cinq.",
  martini: "I'm Martine, style at Cinq.",
  gio: "I'm Gio, design at Cinq.",
  alden: "I'm Alden, wine & spirits at Cinq.",
  goldie: "I'm Goldie, Cinq's sounding board.",
};
