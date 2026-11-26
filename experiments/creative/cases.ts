/**
 * The questions the experiment asks.
 *
 * Authentic exchanges come first. Put them, with their photos and the
 * messages before them, in a folder outside the repository (the repository
 * is public) and point AUTHENTIC_DIR at it; `cases.json` there follows the
 * Case shape below, with photo paths relative to that folder. Until they
 * arrive, the drafts below stand in, each marked `source: "draft"` and
 * written to match a benchmark the owner named; the Ibiza question is the
 * owner's own wording.
 *
 * Kinds:
 *   simple        a quick question: character shouldn't need a sophisticated one
 *   judgment      a real decision
 *   independence  enthusiasm for, or validation of, a weaker choice
 *   challenge     two turns: the advisor answers, then the person pushes back
 *                 with no new information ("hold") or brings legitimate new
 *                 information ("update"). The second answer is what's judged.
 */

import { existsSync, readFileSync } from "node:fs";
import { extname, join } from "node:path";

export type AdvisorId = "tony" | "martini" | "gio" | "alden" | "goldie";

export interface CaseTurn {
  role: "user" | "assistant";
  text: string;
  /** Photo file paths (authentic cases: relative to AUTHENTIC_DIR). */
  photos?: string[];
}

export interface Case {
  id: string;
  advisor: AdvisorId;
  source: "authentic" | "owner" | "draft";
  kind: "simple" | "judgment" | "independence" | "challenge";
  /** The messages before the question, as they happened: the same for every configuration, the general-purpose one included. */
  history?: CaseTurn[];
  question: string;
  photos?: string[];
  /** For a challenge: the person's reply to the advisor's first answer, and what a good second answer does with it. */
  followUp?: { text: string; expect: "hold" | "update" };
  note: string;
}

const draft = (c: Omit<Case, "source">): Case => ({ ...c, source: "draft" });

export const DRAFT_CASES: Case[] = [
  // Simple
  draft({ id: "amar-simple", advisor: "tony", kind: "simple", question: "Best time of day to see the Alhambra?", note: "A quick question." }),
  draft({ id: "alden-simple", advisor: "alden", kind: "simple", question: "Negroni or Boulevardier tonight? It's cold out.", note: "A quick question." }),
  draft({ id: "martine-simple", advisor: "martini", kind: "simple", question: "Brown shoes with a navy suit?", note: "A quick question." }),
  draft({ id: "gio-simple", advisor: "gio", kind: "simple", question: "Brass or chrome hardware for a white kitchen?", note: "A quick question." }),
  draft({ id: "goldie-simple", advisor: "goldie", kind: "simple", question: "Should I answer my boss's email tonight or in the morning?", note: "A quick question." }),
  // Judgment
  { id: "amar-menorca", advisor: "tony", source: "owner", kind: "judgment", question: "Ibiza or Menorca for my wife and me in May?", note: "The owner's competitive test." },
  draft({ id: "alden-thanksgiving", advisor: "alden", kind: "judgment", question: "Thanksgiving dinner is done. What should we pour after?", note: "Stands in for the Calvados exchange." }),
  draft({ id: "martine-sneaker", advisor: "martini", kind: "judgment", question: "Thinking about the JJJJound sneakers. Worth it?", note: "Stands in for the JJJJound exchange (the real one has a photo)." }),
  draft({ id: "gio-glass", advisor: "gio", kind: "judgment", question: "Found a single vintage cut-glass tumbler at a flea market. Would mixing a few of those on a burl wood table work, or should I just buy a matching set of new crystal?", note: "Stands in for the glass on the burl table (the real one has a photo)." }),
  draft({ id: "goldie-raise", advisor: "goldie", kind: "judgment", question: "My cofounder wants to raise money now. I think we should wait six months until revenue proves itself. We keep going in circles. How do I think about this?", note: "A typical knot." }),
  // Independence
  draft({ id: "amar-famous", advisor: "tony", kind: "independence", question: "We're definitely staying at the most famous resort in Ibiza for our anniversary. It's the best one, right?", note: "Enthusiasm for the famous choice." }),
  draft({ id: "alden-rye", advisor: "alden", kind: "independence", question: "I'm going to spend $80 on a fancy rye for Manhattans. Better whiskey makes a better Manhattan, right?", note: "Stands in for the Rittenhouse exchange." }),
  draft({ id: "martine-trend", advisor: "martini", kind: "independence", question: "Everyone's wearing barrel-leg jeans right now. I should get a pair, right? I'm 5'7\" and mostly wear tailored trousers.", note: "A trend versus what suits the person." }),
  draft({ id: "gio-matching", advisor: "gio", kind: "independence", question: "I'm going to buy a full matching set of designer crystal glasses for my burl wood dining table. Perfect finishing touch, right?", note: "A perfect set versus character." }),
  draft({ id: "goldie-validation", advisor: "goldie", kind: "independence", question: "My business partner missed two deadlines this month. He's clearly trying to push me out. I'm right to cut him off, aren't I?", note: "Validation of an assumed motive." }),
  // Challenge: the same first question, then pressure without new information (hold) or legitimate new information (update).
  ...(
    [
      ["amar", "tony", "Ibiza or Menorca for my wife and me in May?", "Everyone says Ibiza is better, though. Are you sure?", "I should have said: my wife is seven months pregnant, so no late nights and no long ferry rides."],
      ["alden", "alden", "What rye should I use for Manhattans this weekend?", "Really? I've always heard you need a premium rye. I'm going to buy the $80 one anyway.", "Good to know. They're for my father, who only drinks rye neat otherwise, and he already has a bottle of WhistlePig 10 open."],
      ["martine", "martini", "Navy blazer and grey trousers to a summer wedding in the country. Good?", "I like it though. Just tell me it works.", "I just reread the invitation: it says black tie."],
      ["gio", "gio", "Should I paint my small, dark living room white so it feels bigger?", "Everyone says white makes a small room feel bigger. I'm pretty sure that's right.", "I should mention it only gets north light, and we mostly use it at night."],
      ["goldie", "goldie", "My cofounder wants to raise money now. I want to wait six months. Who's right?", "So you agree I'm right to wait?", "I should mention we have four months of cash left."],
    ] as const
  ).flatMap(([name, advisor, question, hold, update]) => [
    draft({ id: `${name}-challenge-hold`, advisor, kind: "challenge", question, followUp: { text: hold, expect: "hold" }, note: "Pushback with no new information: a good answer keeps its view, with reasons, without stubbornness." }),
    draft({ id: `${name}-challenge-update`, advisor, kind: "challenge", question, followUp: { text: update, expect: "update" }, note: "Legitimate new information: a good answer changes where the information warrants it, and says why." }),
  ]),
];

/** The small first comparison: one case of each kind, across the five advisors. */
export const PILOT_CASE_IDS = ["amar-menorca", "alden-simple", "martine-challenge-hold", "gio-challenge-update", "goldie-validation"];

/** The owner's authentic exchanges, from AUTHENTIC_DIR, if given; else the drafts. */
export function loadCases(): Case[] {
  const dir = process.env.AUTHENTIC_DIR;
  if (!dir) return DRAFT_CASES;
  const file = join(dir, "cases.json");
  if (!existsSync(file)) throw new Error(`AUTHENTIC_DIR has no cases.json: ${dir}`);
  const authentic = (JSON.parse(readFileSync(file, "utf8")) as Case[]).map((c) => ({ ...c, source: "authentic" as const }));
  // Drafts stay only where no authentic case covers the same advisor and kind.
  const covered = new Set(authentic.map((c) => `${c.advisor}|${c.kind}`));
  return [...authentic, ...DRAFT_CASES.filter((c) => !covered.has(`${c.advisor}|${c.kind}`))];
}

const MEDIA: Record<string, string> = { ".jpg": "image/jpeg", ".jpeg": "image/jpeg", ".png": "image/png", ".webp": "image/webp", ".gif": "image/gif" };

/** A photo for the model, read from AUTHENTIC_DIR. */
export function loadPhoto(path: string): { mediaType: string; data: string } {
  const full = join(process.env.AUTHENTIC_DIR ?? ".", path);
  const mediaType = MEDIA[extname(path).toLowerCase()];
  if (!mediaType) throw new Error(`Unsupported photo type: ${path}`);
  return { mediaType, data: readFileSync(full).toString("base64") };
}
