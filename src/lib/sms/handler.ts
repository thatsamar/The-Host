/**
 * The Ask Cinq by text conversation state machine. Pure logic: no network,
 * no logging, no message content leaves this module except as replies.
 * The route supplies the store, the ask function, and media downloads.
 *
 * Flow: START opts in and welcomes with the advisor list. A question goes
 * to the currently selected advisor with that advisor's own history, so a
 * follow-up keeps context and a switch never sends replies to the wrong
 * advisor. STOP opts out (one confirmation, then silence except HELP).
 * A failed answer gets a plain fallback reply, never silence and never a
 * fabricated answer.
 */

import { newSmsSession, type SmsImage, type SmsSession, type SmsStore, type SmsTurn } from "./store";

/** The five advisors, in the order the hub lists them. */
export const SMS_ADVISORS = [
  { id: "tony", name: "Amar", category: "travel" },
  { id: "martini", name: "Martine", category: "style" },
  { id: "gio", name: "Gio", category: "design" },
  { id: "alden", name: "Alden", category: "wine, cocktails & spirits" },
  { id: "goldie", name: "Goldie", category: "sounding board" },
] as const;

export type SmsAdvisorId = (typeof SMS_ADVISORS)[number]["id"];

const STOP_WORDS = new Set(["stop", "stopall", "unsubscribe", "cancel", "end", "quit"]);
const START_WORDS = new Set(["start", "unstop"]);
const HELP_WORDS = new Set(["help", "info"]);

/** Most turns kept per advisor; oldest dropped first. */
export const MAX_STORED_TURNS = 40;
/** Most photos accepted in one message. */
export const MAX_PHOTOS = 10;
/** Replies are split at or under this many characters. */
export const MAX_REPLY_CHARS = 1500;

const SUPPORTED_IMAGE_TYPES = new Set(["image/jpeg", "image/png", "image/webp", "image/gif"]);

function advisorList(): string {
  return SMS_ADVISORS.map((a, i) => `${i + 1} ${a.name} — ${a.category}`).join("\n");
}

export const WELCOME_TEXT =
  "Welcome to Cinq by text. Pick an advisor by replying with the number or name:\n\n" +
  advisorList() +
  "\n\nThen send your question. You can switch advisors anytime by replying with another number or name. Reply STOP to opt out, HELP for help. Message frequency varies with your usage. Message and data rates may apply.";

export const HELP_TEXT =
  "Cinq by text: reply 1-5 or an advisor name to pick or switch advisors, then send your question or a photo. Reply START to join, STOP to opt out. Message and data rates may apply. Contact: amar@cinqcollective.com";

export const OPT_OUT_TEXT = "You’ve opted out of Cinq texts. No further messages will be sent. Reply START to opt back in.";
export const FALLBACK_TEXT = "Something went wrong on our side. Try again.";
export const NO_QUESTION_TEXT = "Add a photo or a question.";
/** Sent the moment a question goes to the advisor, so the wait for the answer isn't silent. Never stored as a turn. */
export const ACK_TEXT = "Give me a second…";

export function advisorPromptText(): string {
  return "Pick an advisor first — reply with the number or name:\n\n" + advisorList();
}

function advisorConfirmText(id: SmsAdvisorId): string {
  const advisor = SMS_ADVISORS.find((a) => a.id === id)!;
  return `You're with ${advisor.name} (${advisor.category}). Send your question as a text or a photo.`;
}

function normalize(body: string): string {
  return body.trim().toLowerCase().replace(/\s+/g, " ");
}

/** Match "3", "gio", "Martine", "switch to alden", and similar picks. */
export function pickAdvisor(text: string): SmsAdvisorId | null {
  const cleaned = text.replace(/^(switch to|talk to|ask)\s+/, "");
  const byNumber: Record<string, SmsAdvisorId> = {
    "1": "tony",
    "2": "martini",
    "3": "gio",
    "4": "alden",
    "5": "goldie",
  };
  if (byNumber[cleaned]) return byNumber[cleaned];
  for (const advisor of SMS_ADVISORS) {
    if (cleaned === advisor.name.toLowerCase() || cleaned === advisor.category.toLowerCase()) {
      return advisor.id;
    }
  }
  return null;
}

/**
 * Render an advisor's Markdown answer as plain text for a text message. Only
 * the replies are converted; history keeps the original Markdown.
 *
 * Bold, italic, strikethrough and code lose their markers; headings keep their
 * title line; "-", "*" and "+" list items become "• item" (numbered lists stay);
 * [text](url) becomes "text (url)" so the link is tappable; horizontal rules go;
 * quotes lose their ">"; runs of blank lines collapse to one; trailing spaces go.
 */
// An address: no spaces or angle brackets, and parentheses only in balanced pairs (Wikipedia's "(film)").
const URL_BODY = String.raw`(?:[^\s()<>\]]|\([^\s()<>]*\))+`;

export function toSmsText(markdown: string): string {
  // Addresses and escaped characters are set aside first, so no Markdown rule can touch them.
  const kept: string[] = [];
  const keep = (value: string) => `\u0000${kept.push(value) - 1}\u0000`;
  let text = markdown.replace(/\r\n?/g, "\n").replace(/\u0000/g, "");

  text = text
    .replace(/\\([\\`*_{}[\]()#+\-.!>~|])/g, (_, ch: string) => keep(ch))
    // Code fences: keep the code, drop the fence lines.
    .replace(/^[ \t]*(```|~~~)[^\n]*\n?/gm, "")
    .replace(/`([^`\n]+)`/g, (_, code: string) => keep(code))
    // Images and links: the words, then the address in brackets.
    .replace(new RegExp(String.raw`!\[([^\]]*)\]\(\s*<?(${URL_BODY})>?(?:\s+"[^"]*")?\s*\)`, "g"), (_, alt: string, url: string) =>
      alt.trim() ? `${alt} (${keep(url)})` : keep(url),
    )
    .replace(new RegExp(String.raw`\[([^\]]+)\]\(\s*<?(${URL_BODY})>?(?:\s+"[^"]*")?\s*\)`, "g"), (_, label: string, url: string) =>
      label.trim() === url ? keep(url) : `${label} (${keep(url)})`,
    )
    .replace(/<(https?:\/\/[^>\s]+)>/g, (_, url: string) => keep(url))
    .replace(new RegExp(String.raw`https?://${URL_BODY}`, "g"), (url) => {
      // A sentence's closing punctuation isn't part of the address.
      const tail = url.match(/[.,;:!?'"]+$/)?.[0] ?? "";
      return keep(url.slice(0, url.length - tail.length)) + tail;
    })
    // Horizontal rules, before lists, since "* * *" also looks like a list item.
    .replace(/^[ \t]*([-*_])(?:[ \t]*\1){2,}[ \t]*$/gm, "")
    // Headings: the title line alone.
    .replace(/^[ \t]{0,3}#{1,6}[ \t]+(.*?)[ \t]*#*[ \t]*$/gm, "$1")
    // Quotes.
    .replace(/^[ \t]*>[ \t]?/gm, "")
    // Bulleted list items; numbered ones stay as written.
    .replace(/^([ \t]*)[-*+][ \t]+/gm, "$1• ")
    // Emphasis, strongest first.
    .replace(/\*\*\*(?=\S)([^\n]*?\S)\*\*\*/g, "$1")
    .replace(/\*\*(?=\S)([^\n]*?\S)\*\*/g, "$1")
    .replace(/(?<!\w)__(?=\S)([^\n]*?\S)__(?!\w)/g, "$1")
    .replace(/(?<![*\w])\*(?=\S)([^*\n]*?\S)\*(?![*\w])/g, "$1")
    .replace(/(?<!\w)_(?=\S)([^_\n]*?\S)_(?!\w)/g, "$1")
    .replace(/~~(?=\S)([^\n]*?\S)~~/g, "$1")
    // Tidy whitespace.
    .replace(/[ \t]+$/gm, "")
    .replace(/\n{3,}/g, "\n\n")
    .trim();

  return text.replace(/\u0000(\d+)\u0000/g, (_, i: string) => kept[Number(i)]);
}

/**
 * Split a long answer into readable consecutive messages of at most `max`
 * characters: between paragraphs where possible, then at a line break or the
 * last space, so no word or address is cut in two. Only a single word longer
 * than `max` is cut.
 */
export function splitReply(text: string, max = MAX_REPLY_CHARS): string[] {
  const out: string[] = [];
  let current = "";
  const flush = () => {
    if (current) out.push(current);
    current = "";
  };
  const append = (piece: string) => {
    if (!current) {
      current = piece;
      return;
    }
    if (current.length + 2 + piece.length <= max) {
      current += "\n\n" + piece;
      return;
    }
    flush();
    current = piece;
  };
  for (const para of text.split(/\n\n+/)) {
    if (!para.trim()) continue;
    if (para.length <= max) {
      append(para);
      continue;
    }
    flush();
    let rest = para;
    while (rest.length > max) {
      const window = rest.slice(0, max + 1);
      // Prefer a line break (a list item, say) in the second half; otherwise the last space.
      const newline = window.lastIndexOf("\n");
      const space = Math.max(window.lastIndexOf(" "), window.lastIndexOf("\t"));
      const at = newline > max / 2 ? newline : space > 0 ? space : newline > 0 ? newline : -1;
      if (at > 0) {
        out.push(rest.slice(0, at).trimEnd());
        rest = rest.slice(at + 1).trimStart();
      } else {
        // One word longer than a whole message: the only place a cut is unavoidable.
        out.push(rest.slice(0, max));
        rest = rest.slice(max);
      }
    }
    current = rest;
  }
  flush();
  return out;
}

export interface SmsMedia {
  url: string;
  contentType: string;
}

export interface SmsInbound {
  from: string;
  body: string;
  media: SmsMedia[];
  messageSid: string;
}

export interface SmsDeps {
  store: SmsStore;
  ask: (advisorId: SmsAdvisorId, turns: SmsTurn[]) => Promise<string>;
  downloadMedia?: (url: string) => Promise<{ data: string; mediaType: string } | null>;
  /**
   * Sends ACK_TEXT right away, while the answer is still being written. Only a
   * question to the selected advisor gets one, at most once. The answer (or
   * the fallback) is returned only after the ack has gone out, so it always
   * arrives second; a failed ack never holds up the answer.
   */
  acknowledge?: (text: string) => Promise<void> | void;
}

/**
 * Handle one inbound message. Returns the replies to send, in order.
 * A duplicate MessageSid returns no replies and changes nothing.
 */
export async function processSms(inbound: SmsInbound, deps: SmsDeps): Promise<string[]> {
  const { store } = deps;
  const claimed = await store.claimMessageSid(inbound.messageSid, inbound.from);
  if (!claimed) return [];

  let session: SmsSession | null = await store.getSession(inbound.from);
  const isNew = session === null;
  if (session === null) session = newSmsSession(inbound.from);

  const text = normalize(inbound.body);

  // Brand-new number texting STOP: confirm the opt-out, nothing else.
  if (isNew && STOP_WORDS.has(text)) {
    session.optedIn = false;
    await store.saveSession(session);
    return [OPT_OUT_TEXT];
  }

  // Opted-out numbers hear nothing except HELP and re-START.
  if (!isNew && !session.optedIn) {
    if (START_WORDS.has(text)) {
      session.optedIn = true;
      session.advisorId = null;
      await store.saveSession(session);
      return [WELCOME_TEXT];
    }
    if (HELP_WORDS.has(text)) return [HELP_TEXT];
    return [];
  }

  if (HELP_WORDS.has(text)) return [HELP_TEXT];

  // First message: the number opts in by texting us, and its first reply is
  // always the welcome, so the opt-out, frequency and rates terms arrive
  // before anything else. Choosing an advisor straight away also confirms it.
  if (isNew) {
    const firstPick = pickAdvisor(text);
    session.optedIn = true;
    session.advisorId = firstPick;
    await store.saveSession(session);
    return firstPick ? [WELCOME_TEXT, advisorConfirmText(firstPick)] : [WELCOME_TEXT];
  }

  // Re-START while opted in restarts the welcome.
  if (START_WORDS.has(text)) {
    session.advisorId = null;
    await store.saveSession(session);
    return [WELCOME_TEXT];
  }

  if (STOP_WORDS.has(text)) {
    session.optedIn = false;
    session.advisorId = null;
    await store.saveSession(session);
    return [OPT_OUT_TEXT];
  }

  const picked = pickAdvisor(text);
  if (picked) {
    session.advisorId = picked;
    await store.saveSession(session);
    return [advisorConfirmText(picked)];
  }

  if (!session.advisorId) return [advisorPromptText()];

  const advisorId = session.advisorId as SmsAdvisorId;
  const question = inbound.body.trim();
  // The ack goes out without waiting: the answer is written while it travels.
  let acked: Promise<void> | null = null;
  const acknowledge = () => {
    acked ??= Promise.resolve()
      .then(() => deps.acknowledge?.(ACK_TEXT))
      .catch(() => {});
  };
  // A worded question is certain to go to the advisor, so ack before downloading photos.
  if (question) acknowledge();
  const images: SmsImage[] = [];
  if (deps.downloadMedia) {
    for (const item of inbound.media.slice(0, MAX_PHOTOS)) {
      try {
        const downloaded = await deps.downloadMedia(item.url);
        if (downloaded && SUPPORTED_IMAGE_TYPES.has(downloaded.mediaType)) {
          images.push(downloaded);
        }
      } catch {
        // One unreadable photo must not sink the rest of the message.
      }
    }
  }
  if (!question && images.length === 0) return [NO_QUESTION_TEXT];
  acknowledge(); // photos alone: now known to be a question

  const userTurn: SmsTurn = { role: "user", text: question, images: images.length ? images : undefined };
  const history = session.turnsByAdvisor[advisorId] ?? [];
  const turns = [...history, userTurn].slice(-MAX_STORED_TURNS);

  let answer: string;
  try {
    answer = await deps.ask(advisorId, turns);
    if (!answer.trim()) throw new Error("empty_answer");
  } catch {
    // Failed answers leave the session untouched, so a retry starts clean.
    await acked;
    return [FALLBACK_TEXT];
  }
  await acked;

  const assistantTurn: SmsTurn = { role: "assistant", text: answer };
  session.turnsByAdvisor[advisorId] = [...turns, assistantTurn].slice(-MAX_STORED_TURNS);
  await store.saveSession(session);
  // Texts are plain: the reply loses its Markdown here; history above keeps it.
  return splitReply(toSmsText(answer));
}
