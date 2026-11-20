/**
 * Reading a text as navigation: show the advisors, or switch to one. A text
 * switches only when it is clearly about switching: a bare advisor (number
 * or name, with filler like "please"), or a switch verb followed by an
 * advisor ("talk to Gio", "switch to 2", "bring in Martine"). A text that
 * opens by addressing an advisor ("Martine, what shoes for Milan?") goes to
 * that advisor, who answers it (addressedAdvisor). A name anywhere else in a
 * sentence ("I'm having dinner with Gio") is a question for the current
 * advisor, never a switch.
 */

/** The five advisors, in the order the hub lists them. */
export const SMS_ADVISORS = [
  { id: "tony", name: "Amar", category: "travel" },
  { id: "martini", name: "Martine", category: "style" },
  { id: "gio", name: "Gio", category: "design" },
  { id: "alden", name: "Alden", category: "wine, cocktails & spirits" },
  { id: "goldie", name: "Goldie", category: "sounding board" },
] as const;

export type SmsAdvisorId = (typeof SMS_ADVISORS)[number]["id"];

export type Navigation = { kind: "list" } | { kind: "switch"; advisorId: SmsAdvisorId };

export function isAdvisorId(value: unknown): value is SmsAdvisorId {
  return SMS_ADVISORS.some((a) => a.id === value);
}

// Words that change nothing about what a text means.
const FILLER = String.raw`(?:please|pls|plz|thanks|thank you|thx|now|then|again|instead|ok|okay|hey|hi|hello|yes|sure)`;
// What can come before a switch verb: "can I", "I'd like to", "let me", "please".
const LEAD = String.raw`(?:(?:please|ok|okay|hey|hi|hello|so|can i|could i|may i|i want to|i wanna|i'd like to|i would like to|id like to|let me|lemme)\s+)*`;
// Switch verbs, each with the words that join it to the advisor.
const VERB = String.raw`(?:switch(?: me)?(?: (?:over|back))?(?: to)?|change(?: me)?(?: (?:over|back))?(?: to)?|go(?: back)? to|talk(?: to| with)|speak(?: to| with)|chat(?: to| with)|ask|bring in|bring(?: me)?|hand me(?: over)? to|pass me(?: over)? to|put me(?: through)? to|put me on with|connect me(?: to| with)|get me|give me)`;
// "switch", "menu", "switch advisors", "change advisor", "advisors", "list".
const LIST = String.raw`(?:switch|change|menu|advisors|the advisors|list|switch advisors?|change advisors?|other advisors|show (?:me )?the advisors|who else)`;

const NUMBERS: Record<string, SmsAdvisorId> = { "1": "tony", "2": "martini", "3": "gio", "4": "alden", "5": "goldie" };

/** An advisor named by number, name, or (alone) the area they cover. */
function advisorFrom(word: string, allowCategory: boolean): SmsAdvisorId | null {
  const w = word.trim();
  if (NUMBERS[w]) return NUMBERS[w];
  for (const a of SMS_ADVISORS) {
    if (w === a.name.toLowerCase()) return a.id;
    if (allowCategory && w === a.category) return a.id;
  }
  return null;
}

/** Lowercase, single spaces, no closing punctuation or emoji, straight apostrophes. */
export function tidy(body: string): string {
  return body
    .toLowerCase()
    .replace(/[‘’]/g, "'")
    .replace(/\s+/g, " ")
    .trim()
    .replace(/^[\s.,!?:;-]+|[\s.,!?:;)\-\p{Extended_Pictographic}️]+$/gu, "")
    .trim();
}

const NAMES = String.raw`(?:${SMS_ADVISORS.map((a) => a.name.toLowerCase()).join("|")}|[1-5])`;
const BARE = new RegExp(String.raw`^(?:${FILLER}[\s,]+)*(?:advisor |number |#)?(${NAMES})(?:[\s,]+${FILLER})*$`);
const SWITCH = new RegExp(String.raw`^${LEAD}${VERB}\s+(?:the |advisor |number |#)?(${NAMES})\b(.*)$`);
const LIST_ONLY = new RegExp(String.raw`^(?:${FILLER}[\s,]+)*${LIST}(?:[\s,]+${FILLER})*$`);

/**
 * What a text asks for, if it is navigation: the advisor list, or a switch.
 * Anything else, including a sentence that merely mentions an advisor, is null.
 */
export function readNavigation(body: string): Navigation | null {
  const text = tidy(body);
  if (!text) return null;
  if (LIST_ONLY.test(text)) return { kind: "list" };
  const bare = text.match(BARE);
  if (bare) return { kind: "switch", advisorId: advisorFrom(bare[1], false)! };
  // An area alone ("style", "design") picks its advisor, as it always has.
  const byArea = advisorFrom(text, true);
  if (byArea) return { kind: "switch", advisorId: byArea };
  const verb = text.match(SWITCH);
  if (verb) {
    const rest = verb[2];
    // "ask Alden's opinion" is not a switch; anything after the name must start a new word or clause.
    if (/^'s\b/.test(rest)) return null;
    // A number after a verb is an advisor only on its own: "switch to 2", not "ask 2 questions".
    if (/^[1-5]$/.test(verb[1]) && rest.trim() && !new RegExp(String.raw`^(?:[\s,]+${FILLER})+$`).test(rest)) return null;
    return { kind: "switch", advisorId: advisorFrom(verb[1], false)! };
  }
  return null;
}

/** The five advisors, numbered, as the welcome and the list show them. */
export function advisorList(): string {
  return SMS_ADVISORS.map((a, i) => `${i + 1} ${a.name} - ${a.category}`).join("\n");
}

/**
 * The advisor a question opens by addressing ("Martine, what shoes for
 * Milan?", "hey Gio which rug"), if any: the name first (after at most a
 * greeting), then more words. A bare name is a switch (readNavigation), and a
 * possessive ("Gio's sofa") or a name later in the sentence addresses no one.
 */
export function addressedAdvisor(body: string): SmsAdvisorId | null {
  const text = tidy(body);
  for (const a of SMS_ADVISORS) {
    const name = a.name.toLowerCase();
    if (new RegExp(String.raw`^(?:(?:hi|hey|hello|ok|so)[\s,]+)?${name}\b[\s,:;!?-]+\S`).test(text)) return a.id;
  }
  return null;
}
