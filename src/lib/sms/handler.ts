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

import { advisorList, isAdvisorId, readNavigation, SMS_ADVISORS, type SmsAdvisorId } from "./navigation";
import { INTRODUCTIONS, isGreeting, routeQuestion } from "./router";
import { fitsInOneText, plainPunctuation } from "./segments";
import { newSmsSession, type SmsImage, type SmsSession, type SmsStore, type SmsTurn } from "./store";

export { SMS_ADVISORS, type SmsAdvisorId } from "./navigation";

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

export const WELCOME_TEXT =
  "Welcome to Cinq by text. Five advisors: 1 Amar — travel, 2 Martine — style, 3 Gio — design, 4 Alden — wine, cocktails & spirits, 5 Goldie — sounding board. What's on your mind? Ask anything and the right advisor will answer. Switch anytime — reply SWITCH for the list, or say 'talk to Martine'. Reply STOP to opt out, HELP for help. Message frequency varies with your usage. Message and data rates may apply.";

export const HELP_TEXT =
  "Cinq by text. The five advisors:\n\n" +
  advisorList() +
  "\n\nReply a number or name to pick or switch, or say 'talk to Martine', then send your question or a photo. Reply START to join, STOP to opt out. Message and data rates may apply. Contact: amar@cinqcollective.com";

/** The reply to SWITCH, MENU or "switch" alone: the five advisors and how to pick one. */
export const ADVISOR_LIST_TEXT = "The five advisors. Reply with a number or name, or say 'talk to Martine':\n\n" + advisorList();

export const OPT_OUT_TEXT = "You’ve opted out of Cinq texts. No further messages will be sent. Reply START to opt back in.";
export const FALLBACK_TEXT = "Something went wrong on our side. Try again.";
export const NO_QUESTION_TEXT = "Add a photo or a question.";
/** Sent the moment a question goes to the advisor, so the wait for the answer isn't silent. Never stored as a turn. */
export const ACK_TEXTS = ["Give me a second…", "Working on it…", "Let me think about it…", "Hmm…"] as const;

/** The ack line after `last`: rotating through the four, so a number never gets the same line twice in a row. */
export function nextAck(last: number | undefined): number {
  return last === undefined || !Number.isInteger(last) || last < 0 ? 0 : (last + 1) % ACK_TEXTS.length;
}

function advisorConfirmText(id: SmsAdvisorId): string {
  const advisor = SMS_ADVISORS.find((a) => a.id === id)!;
  return `You're with ${advisor.name} (${advisor.category}). Send your question as a text or a photo.`;
}

function normalize(body: string): string {
  return body.trim().toLowerCase().replace(/\s+/g, " ");
}

/** The advisor a text switches to, if it is a switch (see navigation.ts); otherwise null. */
export function pickAdvisor(text: string): SmsAdvisorId | null {
  const nav = readNavigation(text);
  return nav?.kind === "switch" ? nav.advisorId : null;
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
 * Split a long answer into readable consecutive messages, each passing `fits`
 * (by default, at most `max` characters): between paragraphs where possible,
 * then at a line break or the last space, so no word or address is cut in
 * two. Only a single word too long for a whole message is cut.
 */
export function splitReply(text: string, max = MAX_REPLY_CHARS, fits: (piece: string) => boolean = (p) => p.length <= max): string[] {
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
    if (fits(current + "\n\n" + piece)) {
      current += "\n\n" + piece;
      return;
    }
    flush();
    current = piece;
  };
  // The longest start of `text` that fits (fits only gets harder as text grows).
  const longestFit = (rest: string) => {
    let lo = 1;
    let hi = Math.min(rest.length, max);
    while (lo < hi) {
      const mid = Math.ceil((lo + hi) / 2);
      if (fits(rest.slice(0, mid))) lo = mid;
      else hi = mid - 1;
    }
    return lo;
  };
  for (const para of text.split(/\n\n+/)) {
    if (!para.trim()) continue;
    if (fits(para)) {
      append(para);
      continue;
    }
    flush();
    let rest = para;
    while (!fits(rest)) {
      const room = longestFit(rest);
      const window = rest.slice(0, room + 1);
      // Prefer a line break (a list item, say) in the second half; otherwise the last space.
      const newline = window.lastIndexOf("\n");
      const space = Math.max(window.lastIndexOf(" "), window.lastIndexOf("\t"));
      const at = newline > room / 2 ? newline : space > 0 ? space : newline > 0 ? newline : -1;
      if (at > 0) {
        out.push(rest.slice(0, at).trimEnd());
        rest = rest.slice(at + 1).trimStart();
      } else {
        // One word longer than a whole message: the only place a cut is unavoidable.
        out.push(rest.slice(0, room));
        rest = rest.slice(room);
      }
    }
    current = rest;
  }
  flush();
  return out;
}

/**
 * An answer as the texts that carry it: plain text, plain punctuation, and
 * each text short enough for carriers to deliver whole (see segments.ts).
 */
export function answerTexts(answer: string): string[] {
  return splitReply(plainPunctuation(toSmsText(answer)), MAX_REPLY_CHARS, (piece) => fitsInOneText(piece, MAX_REPLY_CHARS));
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
   * Sends an ack line (ACK_TEXTS, rotating per number) right away, while the answer is still being written. Only a
   * question to the selected advisor gets one, at most once. The answer (or
   * the fallback) is returned only after the ack has gone out, so it always
   * arrives second; a failed ack never holds up the answer.
   */
  acknowledge?: (text: string) => Promise<void> | void;
  /**
   * Which advisor a question goes to when none is picked: a short model call
   * given ROUTER_PROMPT (router.ts), returning its reply. Without it, or when
   * it fails, the question goes to Goldie.
   */
  route?: (question: string) => Promise<string>;
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
  // before anything else. A pick is confirmed; a question is answered after it.
  let firstContact = false;
  if (isNew) {
    session.optedIn = true;
    const nav = readNavigation(inbound.body);
    if (nav?.kind === "switch") {
      session.advisorId = nav.advisorId;
      introduce(session, nav.advisorId);
      await store.saveSession(session);
      return [WELCOME_TEXT, advisorConfirmText(nav.advisorId)];
    }
    if (START_WORDS.has(text) || nav?.kind === "list" || isGreeting(inbound.body) || (!inbound.body.trim() && !inbound.media.length)) {
      await store.saveSession(session);
      return [WELCOME_TEXT];
    }
    // A question: the welcome goes first, then the answer.
    firstContact = true;
    await store.saveSession(session);
  } else {
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

    // Navigation: the advisor list, or a switch. Never stored as a turn, and
    // anything bundled into a switch ("talk to Gio about my sofa") isn't answered.
    // The confirmation introduces the advisor, so no separate introduction follows.
    const nav = readNavigation(inbound.body);
    if (nav?.kind === "list") return [ADVISOR_LIST_TEXT];
    if (nav?.kind === "switch") {
      session.advisorId = nav.advisorId;
      introduce(session, nav.advisorId);
      await store.saveSession(session);
      return [advisorConfirmText(nav.advisorId)];
    }
  }

  const current = session;
  const question = inbound.body.trim();
  // The ack goes out without waiting: the answer is written while it travels.
  // On first contact the welcome goes out in its place.
  let acked: Promise<void> | null = null;
  let welcomeSent = false;
  const acknowledge = () => {
    if (acked) return;
    let line: string;
    if (firstContact) {
      line = WELCOME_TEXT;
      welcomeSent = !!deps.acknowledge;
    } else {
      const next = nextAck(current.lastAck);
      // Remembered with the session, even when the answer fails, so the next question's line differs.
      current.lastAck = next;
      line = ACK_TEXTS[next];
    }
    acked = Promise.resolve()
      .then(() => deps.acknowledge?.(line))
      .catch(() => {});
  };
  // A worded question is certain to go to an advisor, so ack before downloading photos.
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
  if (!question && images.length === 0) {
    await acked;
    return firstContact && !welcomeSent ? [WELCOME_TEXT] : [NO_QUESTION_TEXT];
  }
  acknowledge(); // photos alone: now known to be a question

  // No advisor yet: the question is routed to the best fit, never bounced.
  let advisorId = isAdvisorId(session.advisorId) ? session.advisorId : null;
  if (!advisorId) {
    advisorId = await routeQuestion(question, images.length, deps.route);
    session.advisorId = advisorId;
  }
  // An advisor this number hasn't met opens with a one-line introduction.
  const intro = hasMet(session, advisorId) ? null : INTRODUCTIONS[advisorId];

  const userTurn: SmsTurn = { role: "user", text: question, images: images.length ? images : undefined };
  const history = session.turnsByAdvisor[advisorId] ?? [];
  const turns = [...history, userTurn].slice(-MAX_STORED_TURNS);

  const lead = firstContact && !welcomeSent ? [WELCOME_TEXT] : [];
  let answer: string;
  try {
    answer = await deps.ask(advisorId, turns);
    if (!answer.trim()) throw new Error("empty_answer");
  } catch {
    // Failed answers leave the turns untouched, so a retry starts clean.
    await acked;
    // Only the ack line used, and the routed advisor, are kept. A failed save still sends the fallback.
    await store.saveSession(session).catch(() => {});
    return [...lead, FALLBACK_TEXT];
  }
  await acked;

  const assistantTurn: SmsTurn = { role: "assistant", text: answer };
  session.turnsByAdvisor[advisorId] = [...turns, assistantTurn].slice(-MAX_STORED_TURNS);
  introduce(session, advisorId);
  await store.saveSession(session);
  // Texts are plain: the reply loses its Markdown here; history above keeps it.
  // The introduction is part of the texts only, never of the stored answer.
  return [...lead, ...answerTexts(intro ? `${intro}\n\n${answer}` : answer)];
}

/** Whether this number has met an advisor: introduced, confirmed, or already in conversation. */
function hasMet(session: SmsSession, advisorId: SmsAdvisorId): boolean {
  return (session.introduced ?? []).includes(advisorId) || (session.turnsByAdvisor[advisorId]?.length ?? 0) > 0;
}

function introduce(session: SmsSession, advisorId: SmsAdvisorId): void {
  const met = session.introduced ?? [];
  if (!met.includes(advisorId)) session.introduced = [...met, advisorId];
}
