/**
 * Handoffs on Cinq by text: an advisor who sees that a question is clearly
 * another advisor's offers to bring them in, and marks the answer with
 * [[suggest:<id>]]. Cinq strips the marker, adds one line asking the person,
 * and on their yes delivers the original question, with the first answer
 * as context, to the other advisor. Nothing switches without agreement.
 */

import type { ContextBlock } from "@/lib/ai/types";
import { advisorArea } from "@/lib/companions/cinq";
import { SMS_ADVISORS, isAdvisorId, readNavigation, tidy, type SmsAdvisorId } from "./navigation";
import type { SmsTurn } from "./store";

/** A suggestion waiting on the person's next text. */
export interface PendingHandoff {
  from: SmsAdvisorId;
  to: SmsAdvisorId;
}

/** The previous advisor's answer, passed to the new advisor for this one question. */
export interface HandoffContext {
  from: SmsAdvisorId;
  answer: string;
}

const MARKER = /\[\[\s*suggest\s*:\s*([^\]\n]*?)\s*\]\]/gi;

const nameOf = (id: SmsAdvisorId) => SMS_ADVISORS.find((a) => a.id === id)!.name;

/** Which advisor a marker names: by id or by name. */
function markerAdvisor(value: string): SmsAdvisorId | null {
  const v = value.trim().toLowerCase();
  if (isAdvisorId(v)) return v;
  return SMS_ADVISORS.find((a) => a.name.toLowerCase() === v)?.id ?? null;
}

/**
 * The answer without any marker, and the advisor it suggests, if any. An
 * unknown advisor, or the one already answering, means no suggestion; the
 * marker is removed either way, so it never reaches the person.
 */
export function readSuggestion(answer: string, self: SmsAdvisorId): { text: string; suggest: SmsAdvisorId | null } {
  let suggest: SmsAdvisorId | null = null;
  let found = false;
  const text = answer
    .replace(MARKER, (_, value: string) => {
      const id = markerAdvisor(value);
      if (!found) {
        found = true;
        suggest = id && id !== self ? id : null;
      } else if (suggest !== id) {
        // Two different suggestions in one answer: offer neither.
        suggest = null;
      }
      return "";
    })
    .replace(/[ \t]+$/gm, "")
    .replace(/\n{3,}/g, "\n\n")
    .trim();
  return { text, suggest };
}

/** How a stored handoff note begins, so an advisor can tell it from the person's own words. */
export const HANDOFF_NOTE_PREFIX = "[Cinq handoff note, not written by the person]";

/**
 * The note kept in the new advisor's history, just before the handed-over
 * question: who brought them in and what that advisor said. It stays there,
 * so later answers remember the handoff.
 */
export function handoffNote(handoff: HandoffContext): SmsTurn {
  const from = nameOf(handoff.from);
  const area = advisorArea(handoff.from)?.area;
  return {
    role: "user",
    text: `${HANDOFF_NOTE_PREFIX} ${from}${area ? ` (${area})` : ""} brought you in for the question that follows, and the person agreed. ${from}'s answer to it was:\n\n${handoff.answer}`,
    note: "handoff",
    from: handoff.from,
  };
}

/** The one line Cinq adds after an answer that suggests another advisor. */
export function offerText(to: SmsAdvisorId): string {
  return `Reply YES to bring in ${nameOf(to)}, or carry on with me.`;
}

const YES = new Set([
  "yes", "y", "yeah", "yea", "yep", "yup", "ya", "ok", "okay", "k", "sure", "please", "yes please", "ok please",
  "go ahead", "go for it", "do it", "sounds good", "let's do it", "lets do it", "absolutely", "definitely", "of course",
  "why not", "sure thing", "yes bring them in", "yes do it", "ok do it", "sure go ahead",
]);
const BRING = /^(?:(?:yes|yeah|ok|okay|sure|please)[\s,]+)*(?:bring|get|put)\s+(?:her|him|them)\s+(?:in|on)(?:[\s,]+(?:please|thanks|thank you))?$/;

/** Whether a reply agrees to bring in the suggested advisor: a yes, "bring her in", their name, or a switch to them. */
export function agreesToHandoff(body: string, to: SmsAdvisorId): boolean {
  const text = tidy(body);
  if (!text) return false;
  if (YES.has(text) || BRING.test(text)) return true;
  // "Martine", "yes Martine", "talk to Martine", "switch to 2".
  const nav = readNavigation(text.replace(/^(?:yes|yeah|ok|okay|sure)[\s,]+/, ""));
  return nav?.kind === "switch" && nav.advisorId === to;
}

/** Each advisor's id, name and area, for the notes. */
function lineup(): string {
  return SMS_ADVISORS.map((a) => `${a.id} = ${a.name} (${advisorArea(a.id)?.area ?? a.category})`).join("; ");
}

/**
 * Notes that apply only on Cinq by text, after the app capabilities: how to
 * suggest another advisor, and, when this question was handed over, what
 * the previous advisor said.
 */
/** The longest "Reply YES to bring in ..." line, which Cinq adds after an offer. */
const OFFER_CHARS = Math.max(...SMS_ADVISORS.map((a) => offerText(a.id).length)) + 1;

/**
 * How a text answer sounds: one short text, written like a friend with good
 * taste, in one voice. `budget` is the characters the advisor's own words
 * have in this text.
 */
export function shortTextVoice(budget: number): string {
  const offerBudget = Math.max(40, budget - OFFER_CHARS);
  // Roughly six characters a word in a text like this.
  const words = Math.max(6, Math.floor(budget / 6));
  return [
    `Here every answer is one short text: your words must fit in ${budget} characters, about ${words} words, after the name and any introduction Cinq adds (${offerBudget} characters if you offer to bring in another advisor, since Cinq adds a line asking the person).`,
    "Design the text for that length; don't shorten a longer answer. Lead with the answer itself, as one complete thought that stands on its own and ends cleanly. Never start a list, a sequence or a \"first\" you can't finish in the text, and never trail off; if there is more worth knowing, it belongs in their next text.",
    "Write like a well-informed friend with good taste texting a friend: natural, warm, and opinionated where you have a real view. Give the single most useful thing, specific (a name, a detail, a clear call) rather than a list or an overview; if they ask for a list, give the top one or two that fit.",
    "End with a hook only when one fits naturally: a specific recommendation, a real opinion, a detail worth knowing. Ask a question only when the answer honestly depends on something; never a forced question or a tacked-on offer to say more.",
    "Never sound like an agent: no disclaimers, no hedging, no filler, no headings or bullet lists.",
  ].join(" ");
}

export function textChannelNotes(self: SmsAdvisorId, handoff?: HandoffContext, met?: string[], budget?: number): ContextBlock {
  const lines = [
    "You are answering by text message on Cinq by text. Here Cinq works as one collective: when a question is clearly better suited to another advisor, Cinq can bring that advisor in, with the person's agreement, and hand them the person's question together with your answer. On text this replaces the earlier note that you cannot transfer the conversation or share anything with the other advisors.",
    "If the question is clearly better suited to another advisor, give whatever genuinely useful help is yours to give (briefly, if the question is mostly theirs), then offer in your own words, in one sentence, to bring that advisor in, naming them. Then end the reply with a last line containing only the marker [[suggest:ID]] with their id. Cinq removes the marker and asks the person; never mention or explain the marker, and never say you have already brought them in.",
    `Suggest only when another advisor is clearly the better fit; when in doubt, answer it yourself and add no marker. At most one suggestion, never yourself, and never as a routine closing line. The ids: ${lineup()}.`,
    `A message in the conversation that begins ${HANDOFF_NOTE_PREFIX} is from Cinq, not the person: it records that another advisor brought you in, and what they said. Treat it as part of this conversation's history: you know who brought you in and why.`,
    "Cinq shows your name before each of your texts and, when you first answer this person or are brought in, a one-line introduction; never write your own name as a label, and don't introduce yourself again.",
    ...(budget ? [shortTextVoice(budget)] : []),
    "Only the last day of this conversation is shown to you. Don't assume details from earlier days; if the person refers to something you can't see, ask briefly or work from what they tell you now.",
  ];
  if (met?.length) {
    lines.push(`This person has met these Cinq advisors before: ${met.map((id) => (isAdvisorId(id) ? nameOf(id) : null)).filter(Boolean).join(", ")}.`);
  }
  if (handoff) {
    const from = nameOf(handoff.from);
    lines.push(
      `This question has just been handed to you. ${from} judged it better suited to you, offered to bring you in, and the person agreed. Their question is the latest message, just after Cinq's handoff note with ${from}'s answer; you do not need them to repeat it.`,
      `Answer the question directly. You may acknowledge in a few words that ${from} brought you in, but this is not a generic greeting, and never ask what they need: they have already asked. Build on or differ from ${from} as your own judgment says, without repeating their answer. Here you do know what ${from} told them, from the note.`,
    );
  }
  return { label: "channel_notes", title: "CINQ BY TEXT", body: lines.join("\n"), cacheable: false };
}
