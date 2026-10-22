// Who answers a message, decided from the message and the session alone.
// Pure: no I/O, so every routing rule is covered by tests. The service
// (service.ts) carries out what this decides.

import { COMPANIONS } from "@/lib/companions";
import type { CompanionId } from "@/lib/companions/types";
import { MAX_PHOTOS_PER_TURN } from "@/lib/ask/prompt";
import * as copy from "./copy";
import type { AttachmentRef, OutboundMessage, Session } from "./types";

export type Intent =
  | { kind: "command"; command: "advisors" | "reset" | "help" }
  /** An advisor named or picked; `question` is what followed "Name:" or "Name,". */
  | { kind: "choose"; advisor: CompanionId; question: string }
  | { kind: "question"; text: string };

const COMMANDS = ["advisors", "reset", "help"] as const;

const plain = (s: string) => s.trim().toLowerCase().replace(/[.!?]+$/, "").trim();
const escape = (s: string) => s.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");

/** Reads what a message asks for: a command, an advisor, or a question. */
export function parseIntent(text: string, selection: string | undefined, lineup: CompanionId[]): Intent {
  if (selection && (lineup as string[]).includes(selection)) return { kind: "choose", advisor: selection as CompanionId, question: "" };
  const said = plain(text);
  const command = COMMANDS.find((c) => c === said);
  if (command) return { kind: "command", command };
  for (const id of lineup) {
    const { name, category } = COMPANIONS[id];
    if (said === name.toLowerCase() || said === category.toLowerCase()) return { kind: "choose", advisor: id, question: "" };
    const named = text.trim().match(new RegExp(`^@?${escape(name)}\\s*[:,]\\s*([\\s\\S]*)$`, "i"));
    if (named) return { kind: "choose", advisor: id, question: named[1].trim() };
  }
  return { kind: "question", text: text.trim() };
}

export interface Ask {
  advisor: CompanionId;
  text: string;
  attachments: AttachmentRef[];
  /** Start the reply with the advisor's name: their first reply, or a new advisor taking over. */
  introduce: boolean;
}

export interface Decision {
  /** The session afterwards; null clears it. */
  session: Session | null;
  /** What Cinq says before any answer. */
  replies: OutboundMessage[];
  /** A question for an advisor. */
  ask?: Ask;
  /** Ask the provider for a person from Cinq's team. */
  support?: boolean;
}

const picker = (): OutboundMessage => ({ kind: "picker", prompt: copy.PICKER_PROMPT, options: copy.pickerOptions() });

function joinPending(pending: Session["pending"], text: string, attachments: AttachmentRef[]): NonNullable<Session["pending"]> {
  const before = pending ?? { text: "", attachments: [] };
  return {
    text: [before.text, text].filter((t) => t.trim()).join("\n\n"),
    // One more than the limit is kept, so the answer can say there were too many.
    attachments: [...before.attachments, ...attachments].slice(0, MAX_PHOTOS_PER_TURN + 1),
  };
}

export function decide(
  current: Session,
  message: { text: string; attachments: AttachmentRef[]; selection?: string },
  lineup: CompanionId[],
): Decision {
  const session: Session = structuredClone(current);
  const intent = parseIntent(message.text, message.selection, lineup);

  if (intent.kind === "command") {
    if (intent.command === "reset") return { session: null, replies: [{ kind: "text", text: copy.RESET }] };
    if (intent.command === "help") return { session, replies: [], support: true };
    session.welcomed = true;
    return { session, replies: [picker()] };
  }

  if (intent.kind === "choose") {
    const before = session.active;
    const advisor = intent.advisor;
    session.active = advisor;
    session.welcomed = true;
    const introduce = before !== advisor || !session.introduced.includes(advisor);
    let ask: Ask | undefined;
    if (intent.question || message.attachments.length) {
      // A question that comes with the choice is the one to answer; photos
      // sent while choosing join any question that was waiting.
      const waiting = intent.question ? { text: "", attachments: [] } : (session.pending ?? { text: "", attachments: [] });
      const merged = joinPending(waiting, intent.question, message.attachments);
      ask = { advisor, text: merged.text, attachments: merged.attachments, introduce };
    } else if (session.pending) {
      ask = { advisor, text: session.pending.text, attachments: session.pending.attachments, introduce };
    }
    delete session.pending;
    if (ask) return { session, replies: [], ask };
    if (!session.introduced.includes(advisor)) session.introduced.push(advisor);
    return { session, replies: [{ kind: "text", text: copy.switched(advisor, !!session.histories[advisor]?.length) }] };
  }

  if (!intent.text && !message.attachments.length) return { session, replies: [] };

  if (session.active) {
    const advisor = session.active;
    return { session, replies: [], ask: { advisor, text: intent.text, attachments: message.attachments, introduce: !session.introduced.includes(advisor) } };
  }

  // No advisor yet: keep the question for whoever is chosen.
  session.pending = joinPending(session.pending, intent.text, message.attachments);
  if (session.welcomed) return { session, replies: [{ kind: "text", text: copy.CHOOSE_FIRST }] };
  session.welcomed = true;
  return { session, replies: [{ kind: "text", text: copy.welcome(true) }, picker()] };
}
