/**
 * The configurations compared. Each changes one thing from its neighbour, so
 * a difference in the answers can be traced to a cause. Every advisor's brief
 * is used exactly as it is in production; nothing here rewrites a brief.
 *
 *   P  production by text, exactly: text-only notes, web search on, no date.
 *   A  production by text with web search off, so every configuration below
 *      gets the same research inputs (none). The advisor's own answer before
 *      the rewrite step is kept too: that is configuration B.
 *   C  A without the shared voice instruction (the "well-informed friend",
 *      hook and "no hedging" lines); the length budget stays.
 *   L  A without the whole short-text block: no shared voice and no length
 *      budget. Nothing is rewritten or trimmed: natural length.
 *   H  A plus today's date (the approved date line), to test it on its own.
 *   D  the brief with only essential supporting instructions: reading
 *      photos, factual integrity, plain text by message, today's date. No
 *      length limit and no rewrite.
 *   E  the brief with the least that keeps factual integrity and safety,
 *      and today's date.
 *   G  a general-purpose assistant with no brief, given the same date and
 *      plain-text note: the competitive baseline.
 *
 * P, A, C and H go through production's text pipeline (label, the
 * 450-character check, the rewrite, the trim); the others are shown as
 * their own answer, converted to plain text the way every text is.
 */

import type { ContextBlock } from "@/lib/ai/types";
import { assemblePrompt, dateBlock, type AskTurn } from "@/lib/ask/prompt";
import { COMPANIONS } from "@/lib/companions";
import type { Companion } from "@/lib/companions/types";
import { shortTextVoice, textChannelNotes } from "@/lib/sms/handoff";
import { answerBudget } from "@/lib/sms/short";
import { speakerLabel } from "@/lib/sms/handler";
import type { AdvisorId } from "./cases";

export type ConfigId = "P" | "A" | "C" | "L" | "H" | "D" | "E" | "G";

export interface Config {
  id: ConfigId;
  name: string;
  /** Goes through production's text pipeline (the 450-character check, rewrite and trim). */
  textPipeline: boolean;
  webSearch: boolean;
  system: (advisor: AdvisorId, now: Date) => ContextBlock[];
}

const budget = (id: AdvisorId) => answerBudget(speakerLabel(id), null);
const companion = (id: AdvisorId): Companion => COMPANIONS[id];
const turn: AskTurn[] = [{ role: "user", text: "x" }];

/** The production text-only block, with chosen lines removed. */
function channelWithout(id: AdvisorId, drop: (line: string) => boolean): ContextBlock {
  const block = textChannelNotes(id, undefined, [], budget(id));
  return { ...block, body: block.body.split("\n").map((line) => {
    const voice = shortTextVoice(budget(id));
    if (line !== voice) return line;
    // The short-text paragraph is one line of five sentences: keep only those not dropped.
    const kept = splitSentences(voice).filter((s) => !drop(s));
    return kept.join(" ");
  }).filter((line) => line.trim()).join("\n") };
}

function splitSentences(paragraph: string): string[] {
  // shortTextVoice joins its five sentences with single spaces after a period.
  return paragraph.match(/[^.]+(?:\.(?!\w)|$)(?:\s|$)/g)?.map((s) => s.trim()).filter(Boolean) ?? [paragraph];
}

const VOICE_LINES = [/^Write like a well-informed friend/, /^End with a hook/, /^Never sound like an agent/];
const isVoice = (s: string) => VOICE_LINES.some((re) => re.test(s));
const isShortText = (s: string) => /^Here every answer is one short text/.test(s) || /^Design the text for that length/.test(s) || isVoice(s);

const production = (id: AdvisorId, channel: ContextBlock, webSearch: boolean) =>
  assemblePrompt({ companion: companion(id), turns: turn, webSearch, channel }).system;

/** By text, in plain words: the one format fact every configuration without the production notes gets. */
const TEXT_NOTE = "You are answering by text message. Write plain text: no headings, no bullet lists, no Markdown.";

const ESSENTIALS = [
  "People message you by text, sometimes with photos. Read photos closely and refer only to what you can actually see.",
  "You have no personal history: never claim to have been somewhere, tasted, worn, met or seen something yourself, and never invent facts, makers, provenance, prices, access or experiences. Separate what you know from what you infer: be decisive in your opinions and honest about what you cannot establish.",
  TEXT_NOTE,
].join("\n");

const MINIMAL = [
  "Never invent facts, makers, prices or experiences, and never claim to have been somewhere or tasted, worn or seen something yourself. Be decisive in your opinions and honest about what you cannot establish.",
  "If someone may be at risk of harm, say so plainly and point them to immediate professional or emergency help.",
].join("\n");

const block = (label: string, title: string, body: string): ContextBlock => ({ label, title, body, cacheable: true });

export const CONFIGS: Config[] = [
  { id: "P", name: "Production by text (web search on)", textPipeline: true, webSearch: true, system: (id) => production(id, textChannelNotes(id, undefined, [], budget(id)), true) },
  { id: "A", name: "Production by text, web search off", textPipeline: true, webSearch: false, system: (id) => production(id, textChannelNotes(id, undefined, [], budget(id)), false) },
  { id: "C", name: "A without the shared voice instruction", textPipeline: true, webSearch: false, system: (id) => production(id, channelWithout(id, isVoice), false) },
  { id: "L", name: "A without the short-text block (no shared voice, no length limit)", textPipeline: false, webSearch: false, system: (id) => production(id, channelWithout(id, isShortText), false) },
  { id: "H", name: "A plus today's date", textPipeline: true, webSearch: false, system: (id, now) => [...production(id, textChannelNotes(id, undefined, [], budget(id)), false), dateBlock(now)] },
  { id: "D", name: "Brief with essential supporting instructions", textPipeline: false, webSearch: false, system: (id, now) => [block("system_prompt", "SYSTEM PROMPT", companion(id).systemPrompt), block("essentials", "ESSENTIALS", ESSENTIALS), dateBlock(now)] },
  { id: "E", name: "Brief, minimally instructed", textPipeline: false, webSearch: false, system: (id, now) => [block("system_prompt", "SYSTEM PROMPT", companion(id).systemPrompt), block("essentials", "ESSENTIALS", MINIMAL), dateBlock(now)] },
  { id: "G", name: "General-purpose assistant, no brief", textPipeline: false, webSearch: false, system: (_id, now) => [block("system_prompt", "SYSTEM PROMPT", "You are a helpful assistant."), block("essentials", "ESSENTIALS", TEXT_NOTE), dateBlock(now)] },
];

/** For the record: the total characters of instructions each configuration sends. */
export function instructionSize(config: Config, id: AdvisorId, now: Date): number {
  return config.system(id, now).reduce((n, b) => n + b.body.length, 0);
}

export { splitSentences, channelWithout, isVoice, isShortText };
