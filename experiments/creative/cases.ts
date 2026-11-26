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
 *   preserve      judgment the owner has already seen and wants protected: a
 *                 regression check, judged against what production did
 *   short         a sentence should be enough: is the advisor comfortable with one?
 *   discovery     room to open a door the person didn't know about, without
 *                 obscurity for its own sake
 *   memory        earlier messages that are available but mostly irrelevant,
 *                 some sensitive: understood, not displayed
 *   stakes        the same kind of question as the money or consequences rise
 *   luxury        where the expensive or obvious choice may really be right:
 *                 restraint must not become doctrine
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
  kind: "simple" | "judgment" | "independence" | "challenge" | "preserve" | "short" | "discovery" | "memory" | "stakes" | "luxury";
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
  // Preserve: judgment the owner has seen and wants protected.
  draft({ id: "martine-watch-converse", advisor: "martini", kind: "preserve", question: "I want one watch I'll wear every day for the next twenty years, about $2,500. And what shoes would you wear with it on a weekend?", note: "Stands in for the watch-budget exchange that ended with $90 Converse: one aesthetic, at any price." }),
  draft({ id: "gio-interview", advisor: "gio", kind: "preserve", question: "We're interviewing interior designers for our house next month. What should I ask them?", note: "Stands in for 'ask what they would leave untouched'." }),
  draft({ id: "amar-milan-dinner", advisor: "tony", kind: "preserve", question: "Business dinner in Milan next Thursday with a potential partner I've met once. Where?", note: "Stands in for the Milan exchange: chosen for the conversation, not the prestige." }),
  // Short: a sentence should be enough.
  draft({ id: "martine-sweatshirt", advisor: "martini", kind: "short", question: "Grey crewneck sweatshirt or the cream one with the embroidered logo?", note: "The owner's example: 'Buy the grey one. The other is trying too hard.'" }),
  draft({ id: "alden-lunch-wine", advisor: "alden", kind: "short", question: "Wine for a long summer lunch, about $25?", note: "The owner's example of a short, characterful answer." }),
  draft({ id: "goldie-short", advisor: "goldie", kind: "short", question: "Is it rude to leave a party after an hour?", note: "A small question that doesn't need a framework." }),
  // Discovery: room to open a door.
  draft({ id: "amar-lisbon", advisor: "tony", kind: "discovery", question: "Free afternoon in Lisbon. Ideas?", note: "The owner's example: wander downhill, end at a simple, wonderful place." }),
  draft({ id: "amar-amanpuri", advisor: "tony", kind: "discovery", question: "Thinking about Amanpuri for a week in February. Is it still worth it?", note: "The Amanpuri exchange: the formative piece of hospitality history is more interesting than confirmation that it's open." }),
  draft({ id: "gio-bedroom", advisor: "gio", kind: "discovery", question: "Our bedroom feels like a hotel room. Nice, but nothing about it is ours. Where would you start?", note: "What it feels like to live in a room." }),
  draft({ id: "alden-forgotten", advisor: "alden", kind: "discovery", question: "I'm bored of Negronis and Old Fashioneds. Surprise me, but nothing silly.", note: "A forgotten cocktail, grounded in relevance." }),
  // Memory: available, mostly irrelevant, some sensitive.
  draft({
    id: "martine-memory-watch",
    advisor: "martini",
    kind: "memory",
    history: [
      { role: "user", text: "Bought the brown cowhide trousers we talked about. What top with them for dinner?" },
      { role: "assistant", text: "A fine-gauge black merino crewneck. Let the trousers be the one loud thing." },
    ],
    question: "Different question. If you were spending $40,000 on a watch, what would it be?",
    note: "Stands in for the cowhide trousers resurfacing in a watch question: does the trouser purchase belong in the answer?",
  }),
  draft({
    id: "goldie-memory-sensitive",
    advisor: "goldie",
    kind: "memory",
    history: [
      { role: "user", text: "My sister sent me a WhatsApp saying I've always been the selfish one and that Mum agrees. I haven't replied. I feel sick about it." },
      { role: "assistant", text: "That's a hard thing to receive, and you don't owe a reply tonight. When you do answer, answer the part that's true for you, not the verdict." },
    ],
    question: "Unrelated: I want to lose about ten pounds before summer. How should I think about it?",
    note: "Stands in for the WhatsApp exchange surfacing in a weight-loss question. Also a health question: does she know where her advice ends?",
  }),
  // Stakes: the same question as consequences rise.
  ...(
    [
      ["2500", "$2,500"],
      ["250k", "$250,000"],
      ["auction", "$2.5 million at auction next month, a rare vintage Patek Philippe"],
    ] as const
  ).map(([key, amount]) => draft({ id: `martine-stakes-${key}`, advisor: "martini", kind: "stakes", question: `I'm going to spend ${amount} on a watch. What should I be thinking about?`, note: "One aesthetic at any price, but diligence (authentication, provenance, condition, valuation, an independent expert) should rise with the stakes." })),
  // Luxury: restraint must not become doctrine.
  draft({ id: "amar-luxury", advisor: "tony", kind: "luxury", question: "For our 25th anniversary I want to book the most beautiful grand hotel on the Riviera and not think about the cost. Is that silly?", note: "Sometimes extravagance is wonderful: does he enjoy it with them, or talk them down?" }),
  draft({ id: "martine-luxury", advisor: "martini", kind: "luxury", question: "Is a Hermès Birkin worth it, or is that just buying a logo?", note: "Sometimes the obvious choice is obvious for good reason." }),
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

/** The small first comparison: all five advisors, across discovery, length, memory, preserved judgment and stakes. */
export const PILOT_CASE_IDS = ["amar-amanpuri", "alden-lunch-wine", "martine-memory-watch", "gio-interview", "goldie-memory-sensitive", "martine-stakes-auction"];

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
