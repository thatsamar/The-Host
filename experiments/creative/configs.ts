/**
 * The configurations compared. Production is main at the frozen benchmark
 * (BASELINE.md): the owner's briefs with their influences, today's date and
 * Goldie's safety boundary. Every brief is used exactly as it is in
 * production, except in I (Amar's approved identity clarification).
 *
 * Two families, never mixed when attributing a difference:
 *
 * Controlled: no web search for any of them (identical research inputs:
 * none), and the same CONSTANTS block (factual integrity, privacy, safety)
 * and today's date for all, so the only thing that varies is the
 * instruction layer named.
 *   A  production's instructions by text (B = A's own answer before the rewrite and trim)
 *   C  A without the shared voice instruction (the length budget stays)
 *   V  A with the shared voice replaced by "your own voice"
 *   L  A without the short-text block: no shared voice, no length limit, no rewrite
 *   F  A without the optional closing "The call"
 *   K  A without Gio's per-piece purchase checklist (Gio only)
 *   N  A without prescribed answer shapes, for all five: the question decides
 *      the shape (one thing, two very different ones, nothing, or something
 *      unexpected), and price appears when it is relevant
 *   R  A with research as the advisor's resource, not its voice
 *   M  A with discretion about what the person has said before
 *   S  A with diligence that rises with the stakes
 *   I  A with Amar's identity clarification (Amar's questions only)
 *   AF A with Cinq's philosophy after the brief (needs PHILOSOPHY_FILE)
 *   X  A with I, V, F, N, R, M and S together (and the philosophy, if given)
 *   D  the brief with only essential supporting instructions, no length limit
 *   DF D with Cinq's philosophy after the brief
 *   E  the brief, minimally instructed
 *   O  the original brief (as of October 3; Alden's first, October 14), with D's essentials
 *   H  any earlier brief (BRIEF_VERSION: a date or commit), with D's essentials;
 *      only with BRIEF_VERSION set. With D (today's brief, same essentials),
 *      O and H show what each revision improved or lost
 *   G  a general-purpose assistant, no brief, given the same personal context
 *   G0 an ordinary general-purpose assistant: no brief and none of the person's
 *      earlier messages. G against G0 is the value of memory; A against G is
 *      the value of the advisor.
 *
 * Each of V, F, K, N, R, M, S and I changes one thing, so its effect can be
 * judged on its own before X combines them. None tells an advisor to be
 * more romantic, curious or intriguing: the hypothesis is that those
 * qualities are already in the briefs and are being diluted, so the
 * variants remove or correct what dilutes them.
 *
 * The intellectual foundation (FOUNDATION_DIR, outside the repository: one
 * <advisor>.md per advisor, written or approved by the owner). Without it
 * these don't run. It goes right after the brief, as what informs the
 * advisor's thinking, never as a catalogue of approved recommendations.
 *   DE D with the advisor's foundation material
 *   OE O (the original brief) with the foundation material
 *   AE A (production) with the foundation material
 *
 * End-to-end: what a person would actually get, research included.
 *   P  production by text exactly as it is today (web search on)
 *   RS P with research as the advisor's resource (R's change, web search on)
 *   PR P with research led by the advisor's point of view (Alden first)
 *   RF P with the foundation material and research led by it
 *   DS D with the advisor's production web search
 *
 * A, C, V, F, K, N, R, M, S, I, AF, X, P and RS go through production's text
 * pipeline (label, the 450-character check, the rewrite, the trim); the
 * others are shown as the advisor's own answer, as plain text.
 */

import { existsSync, readFileSync } from "node:fs";
import type { ContextBlock } from "@/lib/ai/types";
import { assemblePrompt, dateBlock, type AskTurn } from "@/lib/ask/prompt";
import { CORRECTIONS } from "@/lib/ask/safeguards";
import { APP_JUDGMENT } from "@/lib/ask/prompt";
import { COMPANIONS } from "@/lib/companions";
import { cinqAdvisors } from "@/lib/companions/cinq";
import type { Companion } from "@/lib/companions/types";
import { shortTextVoice, textChannelNotes } from "@/lib/sms/handoff";
import { answerBudget } from "@/lib/sms/short";
import { speakerLabel } from "@/lib/sms/handler";
import type { AdvisorId } from "./cases";

export type ConfigId =
  | "A" | "C" | "V" | "L" | "F" | "K" | "N" | "R" | "M" | "S" | "I" | "AF" | "X" | "D" | "DF" | "E" | "O" | "H" | "DE" | "OE" | "AE" | "G" | "G0" | "P" | "RS" | "PR" | "RF" | "DS"
  // The intellectual study (INTELLECT.md): sources of differentiation, and fair general-purpose baselines.
  | "A0" | "AW" | "NJ" | "NX" | "DJ" | "DC" | "GJ" | "GS" | "G0S"
  // The website, as production answers there: no text-only block, no length limit, no rewrite.
  | "W" | "WC"
  // The owner's approved foundation (FOUNDATION_DIR), on the website, with the simplified variant, and given to a general assistant as plain context.
  | "WE" | "WFE" | "GE" | "GSE" | "ACE"
  // The radical alternative (owner, Nov 27): a distilled brief (FOUNDATION_DIR/<id>-distilled.md), the foundation, the safeguards; and the brief with the foundation and nothing else.
  | "WR" | "AR" | "WBE"
  // Refined C, the working experimental architecture (owner, Nov 27): see refined() below.
  | "W1" | "W1L" | "W1T" | "W1N" | "W1V" | "W1S" | "W1X" | "WEX" | "A1" | "A1L" | "A1J"
  // The fair general control by text: the foundation and the same one-text channel and pipeline as A1.
  | "GT"
  // Refined C with the owner's three corrections (the confirmation run): W2, W2X (two searches), W2L (second layer), A2 by text.
  | "W2" | "W2X" | "W2L" | "A2"
  // Forced behaviour made conditional (FORCED-BEHAVIOUR.md): shared layers only, and with the owner's briefs too.
  | "WF" | "WFB" | "AC" | "ACB";

export interface Config {
  id: ConfigId;
  name: string;
  family: "controlled" | "end-to-end";
  textPipeline: boolean;
  webSearch: boolean;
  /** Only for some advisors (I is Amar's). */
  advisors?: AdvisorId[];
  /** G0: an ordinary general-purpose assistant, without the person's earlier messages (the follow-ups in a sequence still happen). */
  withoutHistory?: boolean;
  /** AW: production's memory as it really is by text: only the last 24 hours of earlier messages (`recentTurns`), by each turn's `daysAgo`. */
  productionWindow?: boolean;
  /** The photo-only prompt, where a configuration changes it (each advisor's `photosOnly`). */
  photosOnly?: (advisor: AdvisorId) => ((count: number) => string) | undefined;
  /** The number of web searches allowed per answer, where a configuration sets it (W1X, WEX: research exhausted on purpose). */
  maxSearches?: number;
  /** Only where the case has earlier messages (A0, AW): elsewhere it would repeat A. */
  needsHistory?: boolean;
  system: (advisor: AdvisorId, now: Date) => ContextBlock[];
}

const budget = (id: AdvisorId) => answerBudget(speakerLabel(id), null);
const turn: AskTurn[] = [{ role: "user", text: "x" }];

function splitSentences(paragraph: string): string[] {
  return paragraph.match(/[^.]+(?:\.(?!\w)|$)(?:\s|$)/g)?.map((s) => s.trim()).filter(Boolean) ?? [paragraph];
}

/** The production text-only block, with chosen sentences of its short-text paragraph removed. */
function channelWithout(id: AdvisorId, drop: (sentence: string) => boolean): ContextBlock {
  const notes = textChannelNotes(id, undefined, [], budget(id));
  const voice = shortTextVoice(budget(id));
  return {
    ...notes,
    body: notes.body
      .split("\n")
      .map((line) => (line === voice ? splitSentences(voice).filter((s) => !drop(s)).join(" ") : line))
      .filter((line) => line.trim())
      .join("\n"),
  };
}

const VOICE = [/^Write like a well-informed friend/, /^End with a hook/, /^Never sound like an agent/];
const isVoice = (s: string) => VOICE.some((re) => re.test(s));
const isShortText = (s: string) => /^Here every answer is one short text/.test(s) || /^Design the text for that length/.test(s) || isVoice(s);

/**
 * Factual integrity, privacy and safety: identical in every controlled
 * configuration, so none gains or loses on these.
 */
export const CONSTANTS = [
  "Never invent facts, makers, provenance, vintages, prices, access or experiences, and never claim to have been somewhere or to have tasted, worn or seen something yourself. Be decisive in your opinions and honest about what you cannot establish.",
  "Use what the person has told you only to help them, and don't ask for more personal information than the advice needs.",
  "Only if someone describes a genuine risk to their own or someone else's safety, say plainly that it needs real help now and point them to emergency services (911 in the US and Canada).",
].join("\n");

const TEXT_NOTE = "You are answering by text message. Write plain text: no headings, no bullet lists, no Markdown.";
const ESSENTIALS = ["People message you by text, sometimes with photos. Read photos closely and refer only to what you can actually see.", TEXT_NOTE].join("\n");

const block = (label: string, title: string, body: string, cacheable = true): ContextBlock => ({ label, title, body, cacheable });
const constants = () => block("constants", "CONSTANTS", CONSTANTS);

/** Amar's brief with the approved identity clarification: where "Amar" means the man, "Amar Lalvani"; where it means the advisor, "you". */
export function amarClarified(brief: string): string {
  const edits: [string, string][] = [
    ["Amar has spent thirty years", "Amar Lalvani has spent thirty years"],
    ["Amar eats at the best restaurants", "Amar Lalvani eats at the best restaurants"],
    ["steer everyone toward Amar’s own preferences", "steer everyone toward Amar Lalvani’s own preferences"],
    ["Be curious about places outside Amar’s established preferences", "Be curious about places outside Amar Lalvani’s established preferences"],
    ["Use them to enrich Amar’s own judgment and voice", "Use them to enrich your own judgment and voice"],
  ];
  let out = brief;
  for (const [from, to] of edits) {
    if (!out.includes(from)) throw new Error(`Amar's brief no longer contains: ${from}`);
    out = out.replace(from, to);
  }
  return out;
}

function productionText(id: AdvisorId, opts: { channel?: ContextBlock; webSearch: boolean; companion?: Companion; now?: Date }): ContextBlock[] {
  return assemblePrompt({ companion: opts.companion ?? COMPANIONS[id], turns: turn, webSearch: opts.webSearch, channel: opts.channel ?? textChannelNotes(id, undefined, [], budget(id)), now: opts.now }).system;
}

/** Replace one exact passage in a block, failing loudly if production's wording has moved. */
function replaceIn(blocks: ContextBlock[], label: string, from: string, to: string): ContextBlock[] {
  return blocks.map((b) => {
    if (b.label !== label) return b;
    if (!b.body.includes(from)) throw new Error(`${label} no longer contains: ${from.slice(0, 80)}`);
    return { ...b, body: b.body.replace(from, to) };
  });
}

type Edit = (id: AdvisorId, blocks: ContextBlock[]) => ContextBlock[];

/** V: the shared text voice ("a well-informed friend with good taste... natural, warm"), sent last to all five, replaced by the advisor's own. */
export const OWN_VOICE = "Write in your own voice, as your instructions above describe you, texting someone you know, opinionated where you have a real view.";
const editVoice: Edit = (_id, blocks) => {
  const voice = blocks.find((b) => b.label === "channel_notes")?.body.match(/Write like a well-informed friend[^.]*\./)?.[0];
  if (!voice) throw new Error("The shared text voice has moved.");
  return replaceIn(blocks, "channel_notes", voice, OWN_VOICE);
};

/** F: the optional closing "The call", which gives all five the same ending. */
const editCall: Edit = (_id, blocks) => {
  const call = blocks.find((b) => b.label === "app_capabilities")?.body.match(/For a substantial answer, when it would help the person act, you may end with a short section headed The call[^\n]*?Never add it merely to satisfy a format\. /)?.[0];
  if (!call) throw new Error("The call paragraph has moved.");
  return replaceIn(blocks, "app_capabilities", call, "");
};

/** K: Gio's checklist for every piece (dimensions, material, vintage, price, placement, why, invest/save/skip). */
export const GIO_CHECKLIST = "When the person is deciding what to buy, give for each piece: Dimensions; Material/color; Vintage vs. new; Approximate price (sourced, with where it came from, or marked as an estimate); Placement; Why it belongs; Invest / save / skip.";
const editChecklist: Edit = (id, blocks) => (id === "gio" ? replaceIn(blocks, "app_capabilities", GIO_CHECKLIST + "\n", "") : blocks);

/** N: no prescribed answer shape. The question decides it, for all five; price when relevant. */
export const SHAPE = "Let the question decide the shape of the answer. Sometimes recommend one thing unequivocally; sometimes set out two genuinely different possibilities; sometimes say not to buy anything; sometimes introduce something the person hadn't considered. Give the details that decide it where they matter, and the price when it is relevant to the decision.";
const SHAPES: Partial<Record<AdvisorId, [string, string][]>> = {
  martini: [["Then give one strong recommendation and at most two meaningfully different alternatives.\n\nInclude:\nwhat to buy\nbrand or source\nnew vs. vintage\nmaterial\ncolor\nfit\napproximate price\nhow often it is likely to be worn, only from what the person has told you\nwhat it works with\nwhether to invest, save, or skip\nwhy it earns or does not earn the money", SHAPE]],
  gio: [["Prefer one strong recommendation and at most two meaningfully different alternatives.\n\nInclude:\n- dimensions\n- material/color\n- vintage vs. new\n- approximate price\n- placement\n- why it belongs\n- whether the spend is justified\n- invest/save/skip", `${SHAPE} For a piece, the details that matter are usually dimensions, material, placement and why it belongs.`]],
  alden: [
    ["Open with what you would order, open, buy, or make, in the first person, and why it beats the nearest rival for this person, meal, moment, and price. If one ordering", "Say what you would order, open, buy, or make, in the first person, and why, in whatever shape the moment calls for. If one ordering"],
  ],
  goldie: [
    ["Then offer the one practical move you would recommend,", "Then, when a move would help, offer the one practical move you would recommend,"],
    ["End with the one move you would make.", "When a move would help, end with the one you would make; sometimes the better answer is a question, or to leave something alone."],
  ],
};
const shapedBrief = (id: AdvisorId, prompt: string): string => (SHAPES[id] ?? []).reduce((out, [from, to]) => {
  if (!out.includes(from)) throw new Error(`${id}'s brief no longer contains: ${from.slice(0, 60)}`);
  return out.replace(from, to);
}, prompt);
const editShape: Edit = (id, blocks) => editChecklist(id, blocks.map((b) => (b.label === "system_prompt" ? { ...b, body: shapedBrief(id, b.body) } : b)));

/** The advisor's foundation material, from FOUNDATION_DIR (private, never in the repository). */
function foundation(id: AdvisorId): ContextBlock | null {
  const dir = process.env.FOUNDATION_DIR;
  const file = dir ? `${dir.replace(/\/$/, "")}/${id}.md` : "";
  if (!file || !existsSync(file)) return null;
  return block("foundation", "WHAT INFORMS YOUR JUDGMENT", readFileSync(file, "utf8").trim());
}
const afterBrief = (blocks: ContextBlock[], extra: ContextBlock | null) => (extra ? [blocks[0], extra, ...blocks.slice(1)] : blocks);

/** A file of the advisor's private material in FOUNDATION_DIR: `<id><suffix>.md`. */
function privateFile(id: AdvisorId, suffix: string): string | null {
  const dir = process.env.FOUNDATION_DIR;
  const file = dir ? `${dir.replace(/\/$/, "")}/${id}${suffix}.md` : "";
  return file && existsSync(file) ? readFileSync(file, "utf8").trim() : null;
}

/** The owner's three corrections, as approved (Nov 27): the shared source in src, so the harness tests the words production uses. */
export { CORRECTIONS } from "@/lib/ask/safeguards";

/** The website conversation line the owner proposed (W1T), verbatim. */
export const TALK_LINE = "Not every message is a request. Sometimes someone is simply sharing a thought, expressing curiosity or continuing a conversation. Respond to what is happening between you, rather than automatically turning it into a task.";

/**
 * Refined C (owner, Nov 27): the distilled identity (`<id>-core.md`), the
 * foundation (`<id>.md`, or `<id>-l2.md` with the second layer), and only
 * what earns its place: the safeguards, a factual search status from the
 * system (available with its limit, or unavailable; what a used-up limit
 * means), the planning check for real plans, photos, and on the website a
 * preference for prose that doesn't forbid lists. By text, the one-text budget.
 * Options are the isolated experiments: the shared standard of judgment,
 * the owner's conversation line, the text voice, a length note, no search.
 */
function refined(id: AdvisorId, channel: "web" | "text", now: Date, o: { layer2?: boolean; judgment?: boolean; talk?: boolean; voice?: boolean; short?: boolean; search?: number; corrected?: boolean } = {}): ContextBlock[] {
  let core = privateFile(id, "-core")!;
  if (channel === "text") core = core.replace(", and this app keeps nothing between visits, so don't claim to remember anything from before this conversation", "");
  const found = privateFile(id, o.layer2 ? "-l2" : "")!;
  const searches = o.search ?? 0;
  const status = searches > 0
    ? `Web search is available for this answer, up to ${searches} searches. Use it when a fact would change the advice; many messages need none. If the limit is reached, the search tool says so: this answer's searches are used up, and search is not broken.${o.corrected ? "" : " Say plainly what you couldn't check."}${channel === "web" ? " On the website your sources are listed under your answer." : ""}`
    : "Web search isn't available here. Anything about hours, closures or bookings is from memory: say so when it matters to the decision.";
  const safeguards = o.corrected
    ? [CORRECTIONS.research, CORRECTIONS.photo, "When someone wants a plan, make sure it works: opening hours, the time between stops, bookings."]
    : ["If there are photos, refer only to what you can actually see.", "When someone wants a plan, make sure it works: opening hours, the time between stops, bookings."];
  const notes = productionText(id, { webSearch: false }).find((b) => b.label === "channel_notes")!;
  const sentences = notes.body.split("\n").flatMap(splitSentences);
  const web: string[] = ["In conversation, prefer prose. Use lists or headings when they genuinely help."];
  if (o.talk) web.push(TALK_LINE);
  if (o.corrected) web.push(CORRECTIONS.talk);
  if (o.voice) web.push(...sentences.filter((x) => /^Write like a well-informed friend/.test(x)));
  if (o.short) web.push("Keep replies short, a few sentences, unless the person wants more.");
  const channelBlock = channel === "text"
    ? block("channel_notes", "CHANNEL NOTES", [TEXT_NOTE, sentences.find((x) => /^Here every answer is one short text/.test(x)), o.corrected ? CORRECTIONS.talk : undefined].filter(Boolean).join("\n"))
    : block("channel_notes", "CHANNEL NOTES", web.join("\n"));
  return [
    block("system_prompt", "SYSTEM PROMPT", core),
    block("foundation", "WHAT INFORMS YOUR JUDGMENT", found),
    ...(o.judgment ? [judgment()] : []),
    block("search_status", "SEARCH STATUS", status),
    channelBlock,
    block("safeguards", "SAFEGUARDS", safeguards.join("\n")),
    constants(),
    dateBlock(now),
  ];
}

/** The owner-requested distilled brief (FOUNDATION_DIR/<id>-distilled.md, private), with the foundation, the safeguards and, by text, only the length budget. */
function distilledBrief(id: AdvisorId): string | null {
  const dir = process.env.FOUNDATION_DIR;
  const file = dir ? `${dir.replace(/\/$/, "")}/${id}-distilled.md` : "";
  return file && existsSync(file) ? readFileSync(file, "utf8").trim() : null;
}
function distilled(id: AdvisorId, channel: "web" | "text", now: Date): ContextBlock[] {
  let brief = distilledBrief(id)!;
  if (channel === "text") {
    const search = brief.match(/You can search the web\.[^\n]*/)?.[0];
    if (search) brief = brief.replace(search, "Web search is unavailable here. When hours, closures or booking details matter to the decision, say they're from memory.");
    const notes = productionText(id, { webSearch: false }).find((b) => b.label === "channel_notes")!;
    const budgetLine = notes.body.split("\n").flatMap(splitSentences).find((x) => /^Here every answer is one short text/.test(x));
    return [block("system_prompt", "SYSTEM PROMPT", brief), foundation(id)!, block("channel_notes", "CHANNEL NOTES", [TEXT_NOTE, budgetLine].filter(Boolean).join("\n")), constants(), dateBlock(now)];
  }
  return [block("system_prompt", "SYSTEM PROMPT", brief), foundation(id)!, constants(), dateBlock(now)];
}

/**
 * PR/RF: research led by the advisor's own point of view, not by ratings.
 * Advisor-specific wording, replacing only the sentence that says when to
 * search; Alden first, the others once his results are in.
 */
export const LED_RESEARCH: Partial<Record<AdvisorId, [string, string]>> = {
  alden: [
    "Use it when current facts affect the recommendation: a producer, bottling, vintage, ingredients, venue, availability or price.",
    "Before you search, decide from what you know and value what you are looking for: the producers, regions, styles and traditions you would trust for this moment, and the obvious choice you would test against them. Search to check those facts and to find what you might be missing, from producers, importers, specialist merchants and regional sources rather than scores, rankings or \"best of\" lists. Judge what you find by your own standards; a high score or a famous label is a fact to weigh, never the reason.",
  ],
};
const editResearchLed: Edit = (id, blocks) => {
  const pair = LED_RESEARCH[id];
  return pair ? replaceIn(blocks, "app_capabilities", ...pair) : blocks;
};

/** R: research is the advisor's resource, not its voice. */
export const RESEARCH = {
  tonySearch: ["Say briefly what you checked. Anything you didn't check is from memory: say so when it matters.", "What you checked is for you: mention it only when it changes the advice, or when the person should confirm something themselves before relying on it."],
  tonyNoSearch: ["Say that hours, closures and booking details are from memory and worth checking.", "Hours, closures and booking details are from memory: say so only where getting them wrong would cost the person something."],
  aldenSearch: ["Briefly say what you verified. ", "Mention what you verified only when it changes the choice. "],
} as const;
const editResearch: Edit = (id, blocks) => {
  if (id === "tony") {
    const body = blocks.find((b) => b.label === "app_capabilities")!.body;
    const [from, to] = body.includes(RESEARCH.tonySearch[0]) ? RESEARCH.tonySearch : RESEARCH.tonyNoSearch;
    return replaceIn(blocks, "app_capabilities", from, to);
  }
  if (id === "alden" && blocks.find((b) => b.label === "app_capabilities")!.body.includes(RESEARCH.aldenSearch[0])) {
    return replaceIn(blocks, "app_capabilities", ...RESEARCH.aldenSearch);
  }
  return blocks;
};

/** M: what the person has said before is understanding, not material to show. */
export const DISCRETION = "What the person has told you earlier is there to help you understand them, not to show that you remember. Let it shape your judgment silently; mention it only when doing so adds something real. One thing they own is not their whole taste, and a passing circumstance is not who they are. Never bring something emotionally sensitive into an unrelated question.";
const editDiscretion: Edit = (_id, blocks) => blocks.map((b) => (b.label === "channel_notes" ? { ...b, body: `${b.body}\n${DISCRETION}` } : b));

/** S: diligence that rises with the stakes. */
export const STAKES = "As the stakes rise, so does the diligence: for a serious sum or a hard-to-reverse choice (a significant watch, jewelry, art or an auction lot, a property, a health decision), say what an independent expert must establish first, such as authentication, provenance, condition, valuation or a professional opinion, and help the person be a better-informed client of that expert rather than a substitute for one.";
const editStakes: Edit = (_id, blocks) => replaceIn(blocks, "app_capabilities", "You make the recommendation; the person makes the decision.", `${STAKES} You make the recommendation; the person makes the decision.`);

const clarifiedAmar = (id: AdvisorId): Companion | undefined => (id === "tony" ? { ...COMPANIONS[id], systemPrompt: amarClarified(COMPANIONS[id].systemPrompt) } : undefined);

/** A, controlled (no search), with the named edits applied. */
function variant(id: AdvisorId, now: Date, edits: Edit[], opts: { companion?: Companion; withPhilosophy?: boolean } = {}): ContextBlock[] {
  let blocks = productionText(id, { webSearch: false, companion: opts.companion });
  for (const edit of edits) blocks = edit(id, blocks);
  const phil = opts.withPhilosophy ? philosophy() : null;
  if (phil) blocks = [blocks[0], phil, ...blocks.slice(1)];
  return [...blocks, constants(), dateBlock(now)];
}

/** Every committed version of each brief, oldest first (brief-versions.json, from git history). */
interface BriefVersion { commit: string; date: string; subject: string; text: string }
const VERSIONS = JSON.parse(readFileSync(new URL("./brief-versions.json", import.meta.url), "utf8")) as Record<AdvisorId, BriefVersion[]>;

/** The brief as it stood at a date (YYYY-MM-DD: the last version on or before it, else the first) or at an exact commit. */
export function briefAt(id: AdvisorId, at: string): BriefVersion {
  const versions = VERSIONS[id];
  const exact = versions.find((v) => v.commit.startsWith(at));
  if (exact) return exact;
  return [...versions].reverse().find((v) => v.date <= at) ?? versions[0];
}

/** O: the original briefs, as they stood on October 3 (Alden's first version is October 14). */
export const ORIGINAL_DATE = "2026-10-03";

const general = (now: Date) => [block("system_prompt", "SYSTEM PROMPT", "You are a helpful assistant."), block("essentials", "ESSENTIALS", TEXT_NOTE), constants(), dateBlock(now)];

const brief = (id: AdvisorId) => block("system_prompt", "SYSTEM PROMPT", COMPANIONS[id].systemPrompt);

/**
 * Cinq's philosophy, the owner's, as he approves it: read from a private file
 * (PHILOSOPHY_FILE, outside the repository), never written into the code. It
 * comes right after the brief, as a shared way of seeing, not a shared voice.
 * Without the file, AF and DF don't run.
 */
function philosophy(): ContextBlock | null {
  const file = process.env.PHILOSOPHY_FILE;
  if (!file || !existsSync(file)) return null;
  return block("philosophy", "CINQ'S PHILOSOPHY", readFileSync(file, "utf8").trim());
}

export const CONFIGS: Config[] = [
  { id: "A", name: "Production's instructions by text", family: "controlled", textPipeline: true, webSearch: false, system: (id, now) => variant(id, now, []) },
  { id: "C", name: "A without the shared voice instruction", family: "controlled", textPipeline: true, webSearch: false, system: (id, now) => [...productionText(id, { webSearch: false, channel: channelWithout(id, isVoice) }), constants(), dateBlock(now)] },
  { id: "V", name: "A with the shared voice replaced by the advisor's own", family: "controlled", textPipeline: true, webSearch: false, system: (id, now) => variant(id, now, [editVoice]) },
  { id: "L", name: "A without the short-text block (no shared voice, no length limit)", family: "controlled", textPipeline: false, webSearch: false, system: (id, now) => [...productionText(id, { webSearch: false, channel: channelWithout(id, isShortText) }), constants(), dateBlock(now)] },
  { id: "F", name: "A without the optional closing \"The call\"", family: "controlled", textPipeline: true, webSearch: false, system: (id, now) => variant(id, now, [editCall]) },
  { id: "K", name: "A without Gio's per-piece purchase checklist", family: "controlled", textPipeline: true, webSearch: false, advisors: ["gio"], system: (id, now) => variant(id, now, [editChecklist]) },
  { id: "N", name: "A without prescribed answer shapes (the question decides; price when relevant)", family: "controlled", textPipeline: true, webSearch: false, system: (id, now) => variant(id, now, [editShape]) },
  { id: "R", name: "A with research as the advisor's resource, not its voice", family: "controlled", textPipeline: true, webSearch: false, advisors: ["tony", "alden"], system: (id, now) => variant(id, now, [editResearch]) },
  { id: "M", name: "A with discretion about what the person has said before", family: "controlled", textPipeline: true, webSearch: false, system: (id, now) => variant(id, now, [editDiscretion]) },
  { id: "S", name: "A with diligence that rises with the stakes", family: "controlled", textPipeline: true, webSearch: false, system: (id, now) => variant(id, now, [editStakes]) },
  { id: "I", name: "A with Amar's identity clarification", family: "controlled", textPipeline: true, webSearch: false, advisors: ["tony"], system: (id, now) => variant(id, now, [], { companion: clarifiedAmar(id) }) },
  { id: "AF", name: "A with Cinq's philosophy after the brief", family: "controlled", textPipeline: true, webSearch: false, system: (id, now) => variant(id, now, [], { withPhilosophy: true }) },
  {
    id: "X",
    name: "A with every single change together (I, V, F, N, R, M, S, and the philosophy if given)",
    family: "controlled",
    textPipeline: true,
    webSearch: false,
    system: (id, now) => variant(id, now, [editVoice, editCall, editShape, editResearch, editDiscretion, editStakes], { companion: clarifiedAmar(id), withPhilosophy: true }),
  },
  { id: "D", name: "The brief with essential supporting instructions", family: "controlled", textPipeline: false, webSearch: false, system: (id, now) => [brief(id), block("essentials", "ESSENTIALS", ESSENTIALS), constants(), dateBlock(now)] },
  { id: "DF", name: "D with Cinq's philosophy after the brief", family: "controlled", textPipeline: false, webSearch: false, system: (id, now) => [brief(id), philosophy()!, block("essentials", "ESSENTIALS", ESSENTIALS), constants(), dateBlock(now)] },
  { id: "E", name: "The brief, minimally instructed", family: "controlled", textPipeline: false, webSearch: false, system: (id, now) => [brief(id), constants(), dateBlock(now)] },
  { id: "O", name: "The original brief, with essential supporting instructions", family: "controlled", textPipeline: false, webSearch: false, system: (id, now) => [block("system_prompt", "SYSTEM PROMPT", briefAt(id, ORIGINAL_DATE).text), block("essentials", "ESSENTIALS", ESSENTIALS), constants(), dateBlock(now)] },
  {
    id: "H",
    name: "A brief from history (BRIEF_VERSION: a date or commit), with essential supporting instructions",
    family: "controlled",
    textPipeline: false,
    webSearch: false,
    system: (id, now) => [block("system_prompt", "SYSTEM PROMPT", briefAt(id, process.env.BRIEF_VERSION ?? ORIGINAL_DATE).text), block("essentials", "ESSENTIALS", ESSENTIALS), constants(), dateBlock(now)],
  },
  { id: "DE", name: "D with the advisor's foundation material", family: "controlled", textPipeline: false, webSearch: false, system: (id, now) => [brief(id), foundation(id)!, block("essentials", "ESSENTIALS", ESSENTIALS), constants(), dateBlock(now)] },
  { id: "OE", name: "The original brief with the foundation material", family: "controlled", textPipeline: false, webSearch: false, system: (id, now) => [block("system_prompt", "SYSTEM PROMPT", briefAt(id, ORIGINAL_DATE).text), foundation(id)!, block("essentials", "ESSENTIALS", ESSENTIALS), constants(), dateBlock(now)] },
  { id: "AE", name: "Production's instructions with the foundation material", family: "controlled", textPipeline: true, webSearch: false, system: (id, now) => [...afterBrief(productionText(id, { webSearch: false }), foundation(id)), constants(), dateBlock(now)] },
  { id: "G", name: "A general-purpose assistant, no brief, with the person's earlier messages", family: "controlled", textPipeline: false, webSearch: false, system: (_id, now) => general(now) },
  { id: "G0", name: "An ordinary general-purpose assistant: no brief, no earlier messages", family: "controlled", textPipeline: false, webSearch: false, withoutHistory: true, system: (_id, now) => general(now) },
  { id: "P", name: "Production by text, exactly as today (web search on)", family: "end-to-end", textPipeline: true, webSearch: true, system: (id, now) => productionText(id, { webSearch: true, now }) },
  { id: "RS", name: "P with research as the advisor's resource", family: "end-to-end", textPipeline: true, webSearch: true, advisors: ["tony", "alden"], system: (id, now) => editResearch(id, productionText(id, { webSearch: true, now })) },
  { id: "PR", name: "P with research led by the advisor's point of view", family: "end-to-end", textPipeline: true, webSearch: true, advisors: ["alden"], system: (id, now) => editResearchLed(id, productionText(id, { webSearch: true, now })) },
  { id: "RF", name: "P with the foundation material and research led by it", family: "end-to-end", textPipeline: true, webSearch: true, advisors: ["alden"], system: (id, now) => editResearchLed(id, afterBrief(productionText(id, { webSearch: true, now }), foundation(id))) },
  { id: "DS", name: "D with production web search", family: "end-to-end", textPipeline: false, webSearch: true, system: (id, now) => [brief(id), block("essentials", "ESSENTIALS", ESSENTIALS), constants(), dateBlock(now)] },
];

/**
 * The intellectual study (INTELLECT.md). Each isolates one source of
 * differentiation, or gives the general-purpose baseline what Cinq has.
 *   A0  A without the person's earlier messages: the value of memory to the advisor
 *   AW  A with production's real memory: only the last 24 hours of earlier messages
 *   NJ  A without APP_JUDGMENT, the shared standard of judgment (Cinq's shared philosophy in production)
 *   NX  A without the shared paragraph about the other four advisors
 *   DJ  D with APP_JUDGMENT: the brief and the shared standard, nothing else
 *   DC  D with the advisor's own capabilities, without the shared layers
 *   GJ  the general assistant with APP_JUDGMENT: what the shared standard does without a brief
 *   GS  G with web search: a general assistant with the same personal context, research and safeguards
 *   G0S G0 with web search: an ordinary assistant that can research
 */
const ownCapabilities = (id: AdvisorId) => COMPANIONS[id].capabilities(false).filter((line) => line !== cinqAdvisors(id)).join("\n");
const judgment = () => block("judgment", "STANDARD OF JUDGMENT", APP_JUDGMENT);
const removeFrom = (label: string, passage: string): Edit => (_id, blocks) => replaceIn(blocks, label, passage, "");
CONFIGS.push(
  { id: "A0", name: "Production's instructions by text, without the person's earlier messages", family: "controlled", textPipeline: true, webSearch: false, withoutHistory: true, needsHistory: true, system: (id, now) => variant(id, now, []) },
  { id: "AW", name: "Production's instructions by text, with production's 24-hour memory", family: "controlled", textPipeline: true, webSearch: false, productionWindow: true, needsHistory: true, system: (id, now) => variant(id, now, []) },
  { id: "NJ", name: "A without the shared standard of judgment", family: "controlled", textPipeline: true, webSearch: false, system: (id, now) => variant(id, now, [removeFrom("app_capabilities", `${APP_JUDGMENT}\n`)]) },
  { id: "NX", name: "A without the paragraph about the other advisors", family: "controlled", textPipeline: true, webSearch: false, system: (id, now) => variant(id, now, [(i, b) => removeFrom("app_capabilities", `${cinqAdvisors(i)}\n`)(i, b)]) },
  { id: "DJ", name: "The brief with the shared standard of judgment, essentials only", family: "controlled", textPipeline: false, webSearch: false, system: (id, now) => [brief(id), judgment(), block("essentials", "ESSENTIALS", ESSENTIALS), constants(), dateBlock(now)] },
  { id: "DC", name: "The brief with its own capabilities, no shared layers", family: "controlled", textPipeline: false, webSearch: false, system: (id, now) => [brief(id), block("capabilities", "CAPABILITIES", ownCapabilities(id)), block("essentials", "ESSENTIALS", ESSENTIALS), constants(), dateBlock(now)] },
  { id: "GJ", name: "A general-purpose assistant with the shared standard of judgment", family: "controlled", textPipeline: false, webSearch: false, system: (_id, now) => [general(now)[0], judgment(), ...general(now).slice(1)] },
  { id: "GS", name: "A general-purpose assistant with the person's earlier messages and web search", family: "end-to-end", textPipeline: false, webSearch: true, system: (_id, now) => general(now) },
  { id: "G0S", name: "An ordinary general-purpose assistant with web search, no earlier messages", family: "end-to-end", textPipeline: false, webSearch: true, withoutHistory: true, system: (_id, now) => general(now) },
);

/**
 *   W   production on the website, exactly as today (web search on): for questions asked there
 *   WC  W without web search (controlled): what research adds or takes away on the website
 */
const website = (id: AdvisorId, webSearch: boolean, now: Date) => assemblePrompt({ companion: COMPANIONS[id], turns: turn, webSearch, now }).system;
CONFIGS.push(
  { id: "W", name: "Production on the website, exactly as today (web search on)", family: "end-to-end", textPipeline: false, webSearch: true, system: (id, now) => website(id, true, now) },
  { id: "WC", name: "Production on the website, without web search", family: "controlled", textPipeline: false, webSearch: false, system: (id, now) => [...website(id, false, now).filter((b) => b.label !== "current_date"), constants(), dateBlock(now)] },
);

/**
 * Forced behaviour made conditional (FORCED-BEHAVIOUR.md, Part 3). Each
 * passage is production's exact wording, and fails loudly if it moves.
 *   WF  W with the shared-layer rows (#1-12) and the website sources line (#25)
 *   WFB WF with the owner's-brief rows too (#13-24): evidence only; the wording is his to approve
 *   AC  A with the shared-layer rows, and the text line about research (#25, text)
 *   ACB AC with the owner's-brief rows
 */
type Swap = [from: string, to: string];
export const FORCED_SHARED: Swap[] = [
  ["Notice something consequential, explain why it matters, and make a call.", "Notice what is consequential, if anything is, explain why it matters, and give your view."],
  ["mistake a forceful tone for sound judgment.", "mistake a forceful tone for sound judgment. Not every message asks for advice: when someone is curious, reflecting or just talking, answer as a conversation, and give a recommendation or a plan only when that is what they want."],
  ["Put the substance in the reply itself, in full: plans, measurements, quantities, schedules, lists and tables, and when a layout helps", "When the person needs plans, measurements, quantities, schedules, lists or tables, put them in the reply itself, in full, and when a layout helps"],
  ["For a substantial answer, when it would help the person act, you may end", "Only when the person has a decision to make or an action to take that the answer would otherwise leave unclear, you may end"],
  ["Say briefly what you checked. Anything you didn't check is from memory: say so when it matters.", "Don't describe your research; mention what you could not confirm only when it would change the plan."],
  ["End once. If you close with The call, it is your only ending, in a sentence or two, and nothing comes after it.", "End once."],
  ["then the one change that makes the outfit work where it is going.", "then, if something isn't working, the one change that makes the outfit work where it is going; if it already works, say so and why."],
  ["what's working, what isn't, and what to change first.", "what's working, and what, if anything, to change first."],
  ["and recommend one practical next step", "and, when a step is called for, recommend one practical next step"],
  ["(a name, a detail, a clear call)", "(a name, a detail, a clear view)"],
  ["no headings or bullet lists.", "no headings, bullet lists or The call label."],
];
/** Alden's capabilities line (row 6); the same sentence in his brief is row 13. */
const ALDEN_VERIFIED: Swap = ["Briefly say what you verified.", "Mention what you verified only when it changes the choice."];
export const FORCED_PHOTOS: Swap[] = [
  ["your read of it, and the one change that makes it work.", "your read of it, and, if it needs one, the one change that makes it work."],
];
export const FORCED_BRIEFS: Swap[] = [
  ["Then say why that choice beats the nearest plausible alternative", "Then say why, and why it beats the nearest plausible alternative when that alternative is a real temptation"],
  ["Then name the one change that makes the outfit work", "If it needs one, then name the one change that makes the outfit work"],
  ["Identify the highest-leverage move first.", "Identify the highest-leverage move first, if there is one."],
  ["look for the move that adds personality", "see whether a move would add personality"],
  ["If yes, look harder.", "If the answer to the last question is yes, look harder."],
  ["For any occasion, tell me the level of effort required.", "For an occasion, tell me the level of effort it calls for when that isn't obvious."],
  ["first identify the wardrobe problem.", "first understand what the purchase is for."],
  ["Classify decisions as invest, save, or skip.", "When someone is deciding what to buy, classify it as invest, save, or skip."],
  ["Explain what each recommendation is for, when to go, who to bring, what to order or notice, and what mistake to avoid.", "Explain what each recommendation is for, and whichever of when to go, who to bring, what to order or notice, or what mistake to avoid would actually help."],
  ["End with the one move you would make.", "End with the one move you would make, when there is one to make now."],
  ["show who is absorbing the cost and what needs to give", "when someone is absorbing the cost, show who, and what needs to give"],
];
export const SOURCES_WEB = "On the website your sources are listed under your answer; keep in the answer only the uncertainties that matter to the decision.";
export const SOURCES_TEXT = "Nothing shows your sources here; mention research only if an uncertainty changes the advice.";

const swapAll = (blocks: ContextBlock[], swaps: Swap[], labels?: string[]) =>
  blocks.map((b) => (labels && !labels.includes(b.label) ? b : { ...b, body: swaps.reduce((body, [from, to]) => body.split(from).join(to), b.body) }));
function forced(blocks: ContextBlock[], id: AdvisorId, channel: "web" | "text", withBriefs: boolean): ContextBlock[] {
  let out = swapAll(blocks, FORCED_SHARED, ["app_capabilities", "channel_notes"]);
  out = swapAll(out, [[ALDEN_VERIFIED[0], ALDEN_VERIFIED[1]]], ["app_capabilities"]);
  if (withBriefs) out = swapAll(out, [...FORCED_BRIEFS, ALDEN_VERIFIED], ["system_prompt", "app_capabilities"]);
  if (id === "tony" || id === "alden") {
    const note = channel === "web" ? SOURCES_WEB : SOURCES_TEXT;
    out = out.map((b) => (b.label === (channel === "web" ? "app_capabilities" : "channel_notes") ? { ...b, body: `${b.body}\n${note}` } : b));
  }
  return out;
}
const forcedPhotos = (id: AdvisorId) => {
  const base = COMPANIONS[id].photosOnly;
  return (count: number) => FORCED_PHOTOS.reduce((t, [from, to]) => t.split(from).join(to), base(count));
};
CONFIGS.push(
  { id: "WF", name: "Website production with forced behaviour made conditional (shared layers)", family: "end-to-end", textPipeline: false, webSearch: true, photosOnly: forcedPhotos, system: (id, now) => forced(website(id, true, now), id, "web", false) },
  { id: "WFB", name: "WF with the owner's-brief rows too (wording for the owner to approve)", family: "end-to-end", textPipeline: false, webSearch: true, photosOnly: forcedPhotos, system: (id, now) => forced(website(id, true, now), id, "web", true) },
  { id: "AC", name: "A with forced behaviour made conditional (shared layers)", family: "controlled", textPipeline: true, webSearch: false, photosOnly: forcedPhotos, system: (id, now) => forced(variant(id, now, []), id, "text", false) },
  { id: "ACB", name: "AC with the owner's-brief rows too (wording for the owner to approve)", family: "controlled", textPipeline: true, webSearch: false, photosOnly: forcedPhotos, system: (id, now) => forced(variant(id, now, []), id, "text", true) },
  { id: "WE", name: "W with the advisor's foundation material", family: "end-to-end", textPipeline: false, webSearch: true, system: (id, now) => afterBrief(website(id, true, now), foundation(id)) },
  { id: "WFE", name: "WF with the advisor's foundation material", family: "end-to-end", textPipeline: false, webSearch: true, photosOnly: forcedPhotos, system: (id, now) => forced(afterBrief(website(id, true, now), foundation(id)), id, "web", false) },
  { id: "GE", name: "G given the advisor's foundation material as plain context", family: "controlled", textPipeline: false, webSearch: false, system: (id, now) => afterBrief(general(now), foundation(id)) },
  { id: "GSE", name: "GS given the advisor's foundation material as plain context", family: "end-to-end", textPipeline: false, webSearch: true, system: (id, now) => afterBrief(general(now), foundation(id)) },
  { id: "ACE", name: "AC with the advisor's foundation material", family: "controlled", textPipeline: true, webSearch: false, photosOnly: forcedPhotos, system: (id, now) => forced(afterBrief(variant(id, now, []), foundation(id)), id, "text", false) },
  { id: "WR", name: "Distilled brief, the foundation and the safeguards, on the website (web search on)", family: "end-to-end", textPipeline: false, webSearch: true, system: (id, now) => distilled(id, "web", now) },
  { id: "AR", name: "Distilled brief, the foundation and the safeguards, by text", family: "controlled", textPipeline: true, webSearch: false, system: (id, now) => distilled(id, "text", now) },
  { id: "WBE", name: "Production's brief with the foundation and nothing else, on the website (web search on)", family: "end-to-end", textPipeline: false, webSearch: true, system: (id, now) => [website(id, true, now)[0], foundation(id)!, constants(), dateBlock(now)] },
  { id: "W1", name: "Refined C on the website (8 searches)", family: "end-to-end", textPipeline: false, webSearch: true, system: (id, now) => refined(id, "web", now, { search: 8 }) },
  { id: "W1L", name: "W1 with the second layer of the foundation", family: "end-to-end", textPipeline: false, webSearch: true, system: (id, now) => refined(id, "web", now, { search: 8, layer2: true }) },
  { id: "W1T", name: "W1 with the owner's line: not every message is a request", family: "end-to-end", textPipeline: false, webSearch: true, system: (id, now) => refined(id, "web", now, { search: 8, talk: true }) },
  { id: "W1N", name: "W1 without web search (is research orchestration the difference?)", family: "controlled", textPipeline: false, webSearch: false, system: (id, now) => refined(id, "web", now, { search: 0 }) },
  { id: "W1V", name: "W1 with the text channel's voice sentence (is the text voice the difference?)", family: "end-to-end", textPipeline: false, webSearch: true, system: (id, now) => refined(id, "web", now, { search: 8, voice: true }) },
  { id: "W1S", name: "W1 with a short-reply note (is brevity the difference?)", family: "end-to-end", textPipeline: false, webSearch: true, system: (id, now) => refined(id, "web", now, { search: 8, short: true }) },
  { id: "W1X", name: "W1 with only 2 searches (research exhausted)", family: "end-to-end", textPipeline: false, webSearch: true, maxSearches: 2, system: (id, now) => refined(id, "web", now, { search: 2 }) },
  { id: "WEX", name: "WE (current Amar with the foundation) with only 2 searches", family: "end-to-end", textPipeline: false, webSearch: true, maxSearches: 2, system: (id, now) => afterBrief(website(id, true, now), foundation(id)) },
  { id: "A1", name: "Refined C by text", family: "controlled", textPipeline: true, webSearch: false, system: (id, now) => refined(id, "text", now) },
  { id: "A1L", name: "A1 with the second layer of the foundation", family: "controlled", textPipeline: true, webSearch: false, system: (id, now) => refined(id, "text", now, { layer2: true }) },
  { id: "A1J", name: "A1 with the shared standard of judgment", family: "controlled", textPipeline: true, webSearch: false, system: (id, now) => refined(id, "text", now, { judgment: true }) },
  { id: "W2", name: "Refined C with the owner's three corrections, website (8 searches)", family: "end-to-end", textPipeline: false, webSearch: true, system: (id, now) => refined(id, "web", now, { search: 8, corrected: true }) },
  { id: "W2X", name: "W2 with only 2 searches (research exhausted)", family: "end-to-end", textPipeline: false, webSearch: true, maxSearches: 2, system: (id, now) => refined(id, "web", now, { search: 2, corrected: true }) },
  { id: "W2L", name: "W2 with the second layer (experimental)", family: "end-to-end", textPipeline: false, webSearch: true, system: (id, now) => refined(id, "web", now, { search: 8, corrected: true, layer2: true }) },
  { id: "A2", name: "Refined C with the owner's three corrections, by text", family: "controlled", textPipeline: true, webSearch: false, system: (id, now) => refined(id, "text", now, { corrected: true }) },
  { id: "GT", name: "General assistant with the foundation and the same text channel and pipeline as A1", family: "controlled", textPipeline: true, webSearch: false, system: (id, now) => {
    const notes = productionText(id, { webSearch: false }).find((b) => b.label === "channel_notes")!;
    const budgetLine = notes.body.split("\n").flatMap(splitSentences).find((x) => /^Here every answer is one short text/.test(x));
    return [general(now)[0], foundation(id)!, block("channel_notes", "CHANNEL NOTES", [TEXT_NOTE, budgetLine].filter(Boolean).join("\n")), constants(), dateBlock(now)];
  } },
);

export function configsFor(advisor: AdvisorId, ids?: string[] | null): Config[] {
  const hasPhilosophy = !!philosophy();
  const hasFoundation = !!foundation(advisor);
  return CONFIGS.filter(
    (c) =>
      (!ids || ids.includes(c.id)) &&
      (!c.advisors || c.advisors.includes(advisor)) &&
      (hasPhilosophy || !["AF", "DF"].includes(c.id)) &&
      (hasFoundation || !["DE", "OE", "AE", "RF", "WE", "WFE", "GE", "GSE", "ACE", "WBE"].includes(c.id)) &&
      (!!distilledBrief(advisor) || !["WR", "AR"].includes(c.id)) &&
      (!!privateFile(advisor, "-core") || !["W1", "W1L", "W1T", "W1N", "W1V", "W1S", "W1X", "A1", "A1L", "A1J", "W2", "W2X", "W2L", "A2"].includes(c.id)) &&
      (hasFoundation || !["WEX", "GT"].includes(c.id)) &&
      (c.id !== "H" || !!process.env.BRIEF_VERSION),
  );
}

/** A question asked on the website: the "you are answering by text message" note comes out of the configurations that carry it. */
export function forChannel(blocks: ContextBlock[], channel: "text" | "web" = "text"): ContextBlock[] {
  if (channel === "text") return blocks;
  return blocks
    .map((b) => (b.body.includes(TEXT_NOTE) ? { ...b, body: b.body.split("\n").filter((l) => l !== TEXT_NOTE).join("\n") } : b))
    .filter((b) => b.body.trim());
}

export function instructionSize(config: Config, id: AdvisorId, now: Date, channel: "text" | "web" = "text"): number {
  return forChannel(config.system(id, now), channel).reduce((n, b) => n + b.body.length, 0);
}

export { splitSentences, channelWithout, isVoice, isShortText };
