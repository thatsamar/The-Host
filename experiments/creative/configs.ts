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
 *   R  A with research as the advisor's resource, not its voice
 *   M  A with discretion about what the person has said before
 *   S  A with diligence that rises with the stakes
 *   I  A with Amar's identity clarification (Amar's questions only)
 *   AF A with Cinq's philosophy after the brief (needs PHILOSOPHY_FILE)
 *   X  A with I, V, F, K, R, M and S together (and the philosophy, if given)
 *   D  the brief with only essential supporting instructions, no length limit
 *   DF D with Cinq's philosophy after the brief
 *   E  the brief, minimally instructed
 *   G  a general-purpose assistant, no brief, given the same context: the competitive baseline
 *
 * Each of V, F, K, R, M, S and I changes one thing, so its effect can be
 * judged on its own before X combines them. None tells an advisor to be
 * more romantic, curious or intriguing: the hypothesis is that those
 * qualities are already in the briefs and are being diluted, so the
 * variants remove or correct what dilutes them.
 *
 * End-to-end: what a person would actually get, research included.
 *   P  production by text exactly as it is today (web search on)
 *   RS P with research as the advisor's resource (R's change, web search on)
 *   DS D with the advisor's production web search
 *
 * A, C, V, F, K, R, M, S, I, AF, X, P and RS go through production's text
 * pipeline (label, the 450-character check, the rewrite, the trim); the
 * others are shown as the advisor's own answer, as plain text.
 */

import { existsSync, readFileSync } from "node:fs";
import type { ContextBlock } from "@/lib/ai/types";
import { assemblePrompt, dateBlock, type AskTurn } from "@/lib/ask/prompt";
import { COMPANIONS } from "@/lib/companions";
import type { Companion } from "@/lib/companions/types";
import { shortTextVoice, textChannelNotes } from "@/lib/sms/handoff";
import { answerBudget } from "@/lib/sms/short";
import { speakerLabel } from "@/lib/sms/handler";
import type { AdvisorId } from "./cases";

export type ConfigId = "A" | "C" | "V" | "L" | "F" | "K" | "R" | "M" | "S" | "I" | "AF" | "X" | "D" | "DF" | "E" | "G" | "P" | "RS" | "DS";

export interface Config {
  id: ConfigId;
  name: string;
  family: "controlled" | "end-to-end";
  textPipeline: boolean;
  webSearch: boolean;
  /** Only for some advisors (I is Amar's). */
  advisors?: AdvisorId[];
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
  { id: "R", name: "A with research as the advisor's resource, not its voice", family: "controlled", textPipeline: true, webSearch: false, advisors: ["tony", "alden"], system: (id, now) => variant(id, now, [editResearch]) },
  { id: "M", name: "A with discretion about what the person has said before", family: "controlled", textPipeline: true, webSearch: false, system: (id, now) => variant(id, now, [editDiscretion]) },
  { id: "S", name: "A with diligence that rises with the stakes", family: "controlled", textPipeline: true, webSearch: false, system: (id, now) => variant(id, now, [editStakes]) },
  { id: "I", name: "A with Amar's identity clarification", family: "controlled", textPipeline: true, webSearch: false, advisors: ["tony"], system: (id, now) => variant(id, now, [], { companion: clarifiedAmar(id) }) },
  { id: "AF", name: "A with Cinq's philosophy after the brief", family: "controlled", textPipeline: true, webSearch: false, system: (id, now) => variant(id, now, [], { withPhilosophy: true }) },
  {
    id: "X",
    name: "A with every single change together (I, V, F, K, R, M, S, and the philosophy if given)",
    family: "controlled",
    textPipeline: true,
    webSearch: false,
    system: (id, now) => variant(id, now, [editVoice, editCall, editChecklist, editResearch, editDiscretion, editStakes], { companion: clarifiedAmar(id), withPhilosophy: true }),
  },
  { id: "D", name: "The brief with essential supporting instructions", family: "controlled", textPipeline: false, webSearch: false, system: (id, now) => [brief(id), block("essentials", "ESSENTIALS", ESSENTIALS), constants(), dateBlock(now)] },
  { id: "DF", name: "D with Cinq's philosophy after the brief", family: "controlled", textPipeline: false, webSearch: false, system: (id, now) => [brief(id), philosophy()!, block("essentials", "ESSENTIALS", ESSENTIALS), constants(), dateBlock(now)] },
  { id: "E", name: "The brief, minimally instructed", family: "controlled", textPipeline: false, webSearch: false, system: (id, now) => [brief(id), constants(), dateBlock(now)] },
  { id: "G", name: "A general-purpose assistant, no brief", family: "controlled", textPipeline: false, webSearch: false, system: (_id, now) => [block("system_prompt", "SYSTEM PROMPT", "You are a helpful assistant."), block("essentials", "ESSENTIALS", TEXT_NOTE), constants(), dateBlock(now)] },
  { id: "P", name: "Production by text, exactly as today (web search on)", family: "end-to-end", textPipeline: true, webSearch: true, system: (id, now) => productionText(id, { webSearch: true, now }) },
  { id: "RS", name: "P with research as the advisor's resource", family: "end-to-end", textPipeline: true, webSearch: true, advisors: ["tony", "alden"], system: (id, now) => editResearch(id, productionText(id, { webSearch: true, now })) },
  { id: "DS", name: "D with production web search", family: "end-to-end", textPipeline: false, webSearch: true, system: (id, now) => [brief(id), block("essentials", "ESSENTIALS", ESSENTIALS), constants(), dateBlock(now)] },
];

export function configsFor(advisor: AdvisorId, ids?: string[] | null): Config[] {
  const hasPhilosophy = !!philosophy();
  return CONFIGS.filter((c) => (!ids || ids.includes(c.id)) && (!c.advisors || c.advisors.includes(advisor)) && (hasPhilosophy || !["AF", "DF"].includes(c.id)));
}

export function instructionSize(config: Config, id: AdvisorId, now: Date): number {
  return config.system(id, now).reduce((n, b) => n + b.body.length, 0);
}

export { splitSentences, channelWithout, isVoice, isShortText };
