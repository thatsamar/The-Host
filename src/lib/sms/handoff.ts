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
export function textChannelNotes(self: SmsAdvisorId, handoff?: HandoffContext): ContextBlock {
  const lines = [
    "You are answering by text message on Cinq by text. Here Cinq works as one collective: when a question is clearly better suited to another advisor, Cinq can bring that advisor in, with the person's agreement, and hand them the person's question together with your answer. On text this replaces the earlier note that you cannot transfer the conversation or share anything with the other advisors.",
    "If the question is clearly better suited to another advisor, give whatever genuinely useful help is yours to give (briefly, if the question is mostly theirs), then offer in your own words, in one sentence, to bring that advisor in, naming them. Then end the reply with a last line containing only the marker [[suggest:ID]] with their id. Cinq removes the marker and asks the person; never mention or explain the marker, and never say you have already brought them in.",
    `Suggest only when another advisor is clearly the better fit; when in doubt, answer it yourself and add no marker. At most one suggestion, never yourself, and never as a routine closing line. The ids: ${lineup()}.`,
  ];
  if (handoff) {
    const from = nameOf(handoff.from);
    lines.push(
      `This question has just been handed to you. ${from} judged it better suited to you, offered to bring you in, and the person agreed. Their question is the latest message; you do not need them to repeat it. ${from}'s answer to it was:`,
      `<previous_answer advisor="${from}">\n${handoff.answer}\n</previous_answer>`,
      `Answer the question directly. Open with a brief, natural handoff in your own voice (that ${from} brought you in), not a generic greeting, and never ask what they need: they have already asked. Build on or differ from ${from} as your own judgment says, without repeating their answer. Here you do know what ${from} told them, from the answer above.`,
    );
  }
  return { label: "channel_notes", title: "CINQ BY TEXT", body: lines.join("\n"), cacheable: false };
}
