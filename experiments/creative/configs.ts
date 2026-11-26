/**
 * The configurations compared. Every advisor's brief is used exactly as it is
 * in production, except in I, which tests the approved identity
 * clarification for Amar (five names, nothing else).
 *
 * Two families, never mixed when attributing a difference:
 *
 * Controlled: no web search for any of them (identical research inputs:
 * none), and the same CONSTANTS block (factual integrity, privacy, safety)
 * and today's date for all, so the only thing that varies is the
 * instruction layer named.
 *   A0 production's instructions by text, without the date: the control for the date line alone
 *   A  production's instructions by text (B = A's own answer before the rewrite and trim)
 *   C  A without the shared voice instruction (the length budget stays)
 *   L  A without the short-text block: no shared voice, no length limit, no rewrite
 *   I  A with Amar's identity clarification (Amar's questions only)
 *   D  the brief with only essential supporting instructions, no length limit
 *   E  the brief, minimally instructed
 *   G  a general-purpose assistant, no brief, given the same context: the competitive baseline
 *
 * End-to-end: what a person would actually get, research included.
 *   P  production by text exactly as it is today (web search on, no date)
 *   DS D with the advisor's production web search
 *
 * A0, A, C, I and P go through production's text pipeline (label, the
 * 450-character check, the rewrite, the trim); the others are shown as the
 * advisor's own answer, as plain text.
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

export type ConfigId = "A0" | "A" | "C" | "L" | "I" | "AN" | "D" | "E" | "G" | "AF" | "DF" | "P" | "DS";

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

function productionText(id: AdvisorId, opts: { channel?: ContextBlock; webSearch: boolean; companion?: Companion }): ContextBlock[] {
  return assemblePrompt({ companion: opts.companion ?? COMPANIONS[id], turns: turn, webSearch: opts.webSearch, channel: opts.channel ?? textChannelNotes(id, undefined, [], budget(id)) }).system;
}

/** Each brief as PR #76 would make it, with the owner's chosen influences (copied from that branch). */
const INFLUENCED = JSON.parse(readFileSync(new URL("./influenced-briefs.json", import.meta.url), "utf8")) as Record<AdvisorId, string>;

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
  { id: "A0", name: "Production's instructions by text, without the date", family: "controlled", textPipeline: true, webSearch: false, system: (id) => [...productionText(id, { webSearch: false }), constants()] },
  { id: "A", name: "Production's instructions by text", family: "controlled", textPipeline: true, webSearch: false, system: (id, now) => [...productionText(id, { webSearch: false }), constants(), dateBlock(now)] },
  { id: "C", name: "A without the shared voice instruction", family: "controlled", textPipeline: true, webSearch: false, system: (id, now) => [...productionText(id, { webSearch: false, channel: channelWithout(id, isVoice) }), constants(), dateBlock(now)] },
  { id: "L", name: "A without the short-text block (no shared voice, no length limit)", family: "controlled", textPipeline: false, webSearch: false, system: (id, now) => [...productionText(id, { webSearch: false, channel: channelWithout(id, isShortText) }), constants(), dateBlock(now)] },
  {
    id: "I",
    name: "A with Amar's identity clarification",
    family: "controlled",
    textPipeline: true,
    webSearch: false,
    advisors: ["tony"],
    system: (id, now) => [...productionText(id, { webSearch: false, companion: { ...COMPANIONS[id], systemPrompt: amarClarified(COMPANIONS[id].systemPrompt) } }), constants(), dateBlock(now)],
  },
  {
    id: "AN",
    name: "A with the owner's chosen influences in each brief (PR #76)",
    family: "controlled",
    textPipeline: true,
    webSearch: false,
    system: (id, now) => [...productionText(id, { webSearch: false, companion: { ...COMPANIONS[id], systemPrompt: INFLUENCED[id] } }), constants(), dateBlock(now)],
  },
  { id: "D", name: "The brief with essential supporting instructions", family: "controlled", textPipeline: false, webSearch: false, system: (id, now) => [brief(id), block("essentials", "ESSENTIALS", ESSENTIALS), constants(), dateBlock(now)] },
  { id: "E", name: "The brief, minimally instructed", family: "controlled", textPipeline: false, webSearch: false, system: (id, now) => [brief(id), constants(), dateBlock(now)] },
  { id: "G", name: "A general-purpose assistant, no brief", family: "controlled", textPipeline: false, webSearch: false, system: (_id, now) => [block("system_prompt", "SYSTEM PROMPT", "You are a helpful assistant."), block("essentials", "ESSENTIALS", TEXT_NOTE), constants(), dateBlock(now)] },
  {
    id: "AF",
    name: "A with Cinq's philosophy after the brief",
    family: "controlled",
    textPipeline: true,
    webSearch: false,
    system: (id, now) => {
      const [first, ...rest] = productionText(id, { webSearch: false });
      return [first, philosophy()!, ...rest, constants(), dateBlock(now)];
    },
  },
  { id: "DF", name: "D with Cinq's philosophy after the brief", family: "controlled", textPipeline: false, webSearch: false, system: (id, now) => [brief(id), philosophy()!, block("essentials", "ESSENTIALS", ESSENTIALS), constants(), dateBlock(now)] },
  { id: "P", name: "Production by text, exactly as today (web search on, no date)", family: "end-to-end", textPipeline: true, webSearch: true, system: (id) => productionText(id, { webSearch: true }) },
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
