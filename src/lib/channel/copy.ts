// What Cinq itself says in a messaging conversation, as opposed to what an
// advisor says. Names and areas come from the companions, never from here.

import { ACTIVE_LINEUP, COMPANIONS } from "@/lib/companions";
import type { CompanionId } from "@/lib/companions/types";
import type { PickerOption, SupportResult } from "./types";

export const lineup = (): CompanionId[] => [...ACTIVE_LINEUP];

/** "Amar · Travel" */
export const label = (id: CompanionId) => `${COMPANIONS[id].name} · ${COMPANIONS[id].category}`;

export const pickerOptions = (): PickerOption[] =>
  lineup().map((id) => ({ id, title: COMPANIONS[id].name, subtitle: COMPANIONS[id].category }));

function list(items: string[]): string {
  return items.length < 2 ? items.join("") : `${items.slice(0, -1).join(", ")} and ${items.at(-1)}`;
}

export function welcome(hasQuestion: boolean): string {
  const who = list(lineup().map((id) => `${COMPANIONS[id].name} (${COMPANIONS[id].category.toLowerCase()})`));
  const kept = hasQuestion ? " I'll pass your message to whoever you choose." : "";
  return `Hi, this is Cinq's automated service: five AI advisors, each with their own judgment. ${who}. Who would you like?${kept} Type agent anytime to reach a person.`;
}

/**
 * Sent at once when someone's first message names an advisor, so the
 * automated service identifies itself within Apple's five seconds while the
 * answer is written.
 */
export const firstAnswerNotice = (id: CompanionId) =>
  `Hi, this is Cinq's automated service. ${label(id)}, one of Cinq's AI advisors, is writing your answer now. Type agent anytime to reach a person.`;

export const PICKER_PROMPT = "Choose an advisor";
export const CHOOSE_FIRST = "Choose an advisor and they'll pick up from here, or start a message with their name.";

export function switched(id: CompanionId, returning: boolean): string {
  const name = COMPANIONS[id].name;
  return returning
    ? `Back with ${label(id)}, picking up your conversation with ${name}.`
    : `You're with ${label(id)}. Each advisor keeps a separate conversation, so share anything ${name} should know.`;
}

/** The first line of an advisor's first reply in a session. */
export const introduction = (id: CompanionId) => label(id);

export const RESET =
  "Done. Cinq has cleared this conversation's context on its side, so the advisors start fresh. Your Messages history on your devices isn't changed. Type menu to choose an advisor.";

export const PREFERENCES =
  "Cinq only replies to messages you send and doesn't send notifications, so there's nothing to unsubscribe from. To clear this conversation from Cinq, type reset.";

export const TOO_MANY_QUESTIONS = "That's a lot of questions in a short time. Try again in a little while.";
export const INTERRUPTED = "That answer was interrupted before it finished. Send your question again to try once more.";
export const RETRY_HINT = "Send your question again to try once more.";
export const UNAVAILABLE = "Cinq isn't available right now. Try again in a little while.";

export function photoProblem(reason: "unsupported" | "too_large" | "empty" | "too_many" | "unreadable" | "budget"): string {
  switch (reason) {
    case "unsupported":
      return "One of those files isn't a photo I can read. Send photos from your camera roll or screenshots.";
    case "too_large":
      return "One of those photos is too large to read. Try sending a smaller copy.";
    case "too_many":
      return "That's more than 10 photos. Send up to 10 at a time.";
    case "budget":
      return "Those photos are too large to read together. Try fewer.";
    default:
      return "I couldn't open one of those photos. Try sending it again.";
  }
}

/** Only what the provider reported is said: no promised hours or wait the provider didn't give. */
export function support(result: SupportResult): string {
  if (result.status === "queued") {
    const wait = result.estimatedWaitMinutes
      ? ` The current estimated wait is about ${Math.max(1, Math.round(result.estimatedWaitMinutes))} minute${Math.round(result.estimatedWaitMinutes) === 1 ? "" : "s"}.`
      : "";
    return `I've asked for a person from Cinq's team to join this conversation.${wait} The advisors will stay quiet until they're done.`;
  }
  if (result.status === "closed") {
    const hours = result.hours ? ` They're available ${result.hours}.` : "";
    return `Cinq's team isn't available right now, so no one has been notified.${hours} Type agent again then.`;
  }
  return "Human support isn't connected to this chat yet, so no one has been notified.";
}

export const SUPPORT_FAILED = "I couldn't reach Cinq's team just now, so no one has been notified. Try help again in a few minutes.";
