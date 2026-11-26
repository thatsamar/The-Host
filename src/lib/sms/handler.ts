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

import { addressedAdvisor, advisorList, isAdvisorId, readNavigation, SMS_ADVISORS, type SmsAdvisorId } from "./navigation";
import { agreesToHandoff, handoffNote, offerText, readSuggestion, regionOf, type HandoffContext, type TextRegion } from "./handoff";
import { recentTurns } from "./context";
import { compactSession } from "./compact";
import { answerBudget, answerFits, roomForAnswer, shortAnswerText } from "./short";
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

// The welcome, list and HELP texts are plain punctuation like every other text, so phones show hyphens.
export const WELCOME_TEXT = plainPunctuation(
  [
    // Roles only here; the advisors' names are in the SWITCH list.
    "Welcome to Cinq.",
    "5 advisors:",
    "travel",
    "style",
    "design",
    "drinks",
    "sounding board",
    "Ask anything",
    "SWITCH for their names.",
    "Say 'Martine' for style",
    "'Gio' for design, etc.",
    "STOP to opt out",
    "HELP for help.",
    "Message frequency varies with usage.",
    "Message & data rates may apply.",
  ].join("\n"),
);

export const HELP_TEXT = plainPunctuation(
  "Cinq by text. The five advisors:\n\n" +
    advisorList() +
    "\n\nReply a number or name to pick or switch, or say 'talk to Martine', then send your question or a photo. Reply START to join, STOP to opt out. Message and data rates may apply. Contact: amar@cinqcollective.com",
);

/** The reply to SWITCH, MENU or "switch" alone: the five advisors and how to pick one. */
export const ADVISOR_LIST_TEXT = plainPunctuation("The five advisors. Reply with a number or name, or say 'talk to Martine':\n\n" + advisorList());

export const OPT_OUT_TEXT = "You’ve opted out of Cinq texts. No further messages will be sent. Reply START to opt back in.";
export const FALLBACK_TEXT = "Something went wrong on our side. Try again.";
export const NO_QUESTION_TEXT = "Add a photo or a question.";
/** Sent once when an answer is taking a while, so the person knows it hasn't stalled. Never stored as a turn. */
export const STILL_THINKING_TEXT = "Still thinking...";
/** Sent instead of an answer that has stalled; the late answer, if it ever comes, is dropped. */
export const STALLED_TEXT = "I'm sorry, please try again in a little while.";
/** How long an answer may take before "Still thinking..." goes out. */
export const STILL_THINKING_MS = 25_000;
/** How long an answer may take before it counts as stalled (well inside the webhook's 300 s). */
export const STALLED_MS = 150_000;
/** Sent the moment a question goes to the advisor, so the wait for the answer isn't silent. Never stored as a turn. */
export const ACK_TEXTS = ["Give me a second…", "Working on it…", "Let me think about it…", "Hmm…"] as const;

/** The ack line after `last`: rotating through the four, so a number never gets the same line twice in a row. */
export function nextAck(last: number | undefined): number {
  return last === undefined || !Number.isInteger(last) || last < 0 ? 0 : (last + 1) % ACK_TEXTS.length;
}

/**
 * The advisor's own reply to being picked by name or number, in their voice
 * and with their label: an introduction the first time, "I'm back" when the
 * number has talked with them before, "Still here" when they're already on.
 */
export function advisorPickedText(session: SmsSession, id: SmsAdvisorId): string {
  const opening = !hasMet(session, id) ? INTRODUCTIONS[id] : session.advisorId === id ? "Still here." : "I'm back.";
  return `${speakerLabel(id)}${opening} What's on your mind?`;
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
 * With a `label` ("Amar: "), every text starts with it, and its length counts
 * toward each text's size. The label exists only in the texts, never in history.
 */
export function answerTexts(answer: string, label = ""): string[] {
  const pieces = splitReply(plainPunctuation(toSmsText(answer)), MAX_REPLY_CHARS - label.length, (piece) =>
    fitsInOneText(label + piece, MAX_REPLY_CHARS),
  );
  return pieces.map((piece) => label + piece);
}

/** The speaker label on every text an advisor sends: "Amar: ". System texts have none. */
export function speakerLabel(advisorId: SmsAdvisorId): string {
  return `${SMS_ADVISORS.find((a) => a.id === advisorId)!.name}: `;
}

/** The answer without a speaker label the model wrote itself ("Gio: …" or "**Gio:** …"). */
function withoutLabel(answer: string, advisorId: SmsAdvisorId): string {
  const name = SMS_ADVISORS.find((a) => a.id === advisorId)!.name;
  return answer.replace(new RegExp(String.raw`^\s*[*_]*${name}[*_]*\s*:[*_]*\s*`, "i"), "");
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
  /** Ask an advisor. `context.handoff` carries the previous advisor's answer when a question was handed over. */
  ask: (
    advisorId: SmsAdvisorId,
    turns: SmsTurn[],
    context?: { handoff?: HandoffContext; met?: string[]; budget?: number; signal?: AbortSignal; region?: TextRegion },
  ) => Promise<string>;
  /**
   * Rewrites an answer that came back longer than one text into one complete
   * text of at most `room` characters (a quick model call given
   * condensePrompt). Without it, or if it fails, whole sentences that fit are kept.
   */
  condense?: (advisorId: SmsAdvisorId, answer: string, room: number) => Promise<string>;
  /** The time now, in ms (tests set it); Date.now otherwise. */
  now?: () => number;
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
  /**
   * Told when a session save fails (the route logs the error class only).
   * A failed save never holds back a reply: the turn is simply not stored.
   */
  onSaveError?: (err: unknown) => void;
  /** When "Still thinking..." goes out and when an answer counts as stalled (tests shorten them). */
  timing?: { stillThinkingMs?: number; stalledMs?: number };
}

// The ack line each number got last, kept here only while its session could
// not be saved, so a failed save doesn't repeat the same line next time.
const unsavedAcks = new Map<string, number>();
const MAX_UNSAVED_ACKS = 1000;

function rememberUnsavedAck(phone: string, ack: number | undefined): void {
  if (ack === undefined) return;
  unsavedAcks.delete(phone);
  unsavedAcks.set(phone, ack);
  if (unsavedAcks.size > MAX_UNSAVED_ACKS) unsavedAcks.delete(unsavedAcks.keys().next().value!);
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

  // Every save is compacted (compact.ts) and best effort: a failure is
  // reported, and the reply goes out all the same.
  const save = async (s: SmsSession): Promise<boolean> => {
    try {
      await store.saveSession(compactSession(s, deps.now?.() ?? Date.now()));
      unsavedAcks.delete(s.phone);
      return true;
    } catch (err) {
      rememberUnsavedAck(s.phone, s.lastAck);
      try {
        deps.onSaveError?.(err);
      } catch {
        // Reporting must not cost the reply either.
      }
      return false;
    }
  };

  // Brand-new number texting STOP: confirm the opt-out, nothing else.
  if (isNew && STOP_WORDS.has(text)) {
    session.optedIn = false;
    await save(session);
    return [OPT_OUT_TEXT];
  }

  // Opted-out numbers hear nothing except HELP and re-START.
  if (!isNew && !session.optedIn) {
    if (START_WORDS.has(text)) {
      session.optedIn = true;
      session.advisorId = null;
      await save(session);
      return [WELCOME_TEXT];
    }
    if (HELP_WORDS.has(text)) return [HELP_TEXT];
    return [];
  }

  const current = session;
  // Set for a brand-new number's first question: the welcome goes out first.
  let firstContact = false;
  // The ack goes out without waiting: the answer is written while it travels.
  // On first contact the welcome goes out in its place.
  let acked: Promise<void> | null = null;
  let welcomeSent = false;
  // Set when an answer stalled: the person is told to try again later rather than the usual fallback.
  let stalled = false;
  const acknowledge = () => {
    if (acked) return;
    let line: string;
    if (firstContact) {
      line = WELCOME_TEXT;
      welcomeSent = !!deps.acknowledge;
    } else {
      const next = nextAck(unsavedAcks.get(current.phone) ?? current.lastAck);
      // Remembered with the session, even when the answer fails, so the next question's line differs
      // (and in memory if the save fails).
      current.lastAck = next;
      line = ACK_TEXTS[next];
    }
    acked = Promise.resolve()
      .then(() => deps.acknowledge?.(line))
      .catch(() => {});
  };

  /**
   * Ask an advisor and keep the exchange: the reply's texts, or null when the
   * answer failed (the turns are then left as they were). An advisor this
   * number hasn't met, routed or handed over, opens with its one-line
   * introduction. Every text carries the advisor's speaker label. A
   * suggestion marker is removed here and becomes the pending offer.
   * `before` are turns stored ahead of the question (a handoff's note).
   */
  const answerWith = async (
    advisorId: SmsAdvisorId,
    userTurn: SmsTurn,
    context?: { handoff?: HandoffContext },
    before: SmsTurn[] = [],
  ) => {
    // A handoff always opens with the introduction; a routed answer only the first time.
    const intro = context?.handoff || !hasMet(current, advisorId) ? INTRODUCTIONS[advisorId] : null;
    // One short text per answer: the advisor is told how many characters its own words have.
    const label = speakerLabel(advisorId);
    const budget = answerBudget(label, intro);
    const now = deps.now?.() ?? Date.now();
    const history = current.turnsByAdvisor[advisorId] ?? [];
    // Every new turn carries its time, so it can leave the advisor's view after a day.
    const turns = [...history, ...before.map((t) => ({ ...t, at: now })), { ...userTurn, at: now }].slice(-MAX_STORED_TURNS);
    // The advisor sees only the last day (context.ts); older turns go at the save (compact.ts).
    const met = (current.introduced ?? []).filter((id) => id !== advisorId);
    let answer: string;
    let suggest: SmsAdvisorId | null;
    // A slow answer gets one "Still thinking..." (after the ack); a stalled one is given up on.
    const controller = new AbortController();
    let thinking: Promise<void> | null = null;
    const thinkingTimer = setTimeout(() => {
      if (!deps.acknowledge) return;
      thinking = Promise.resolve(acked)
        .then(() => deps.acknowledge?.(STILL_THINKING_TEXT))
        .catch(() => {});
    }, deps.timing?.stillThinkingMs ?? STILL_THINKING_MS);
    let stallTimer: ReturnType<typeof setTimeout> | undefined;
    const stall = new Promise<never>((_, reject) => {
      stallTimer = setTimeout(() => {
        stalled = true;
        controller.abort();
        reject(new Error("answer_stalled"));
      }, deps.timing?.stalledMs ?? STALLED_MS);
    });
    try {
      ({ text: answer, suggest } = readSuggestion(
        await Promise.race([
          deps.ask(advisorId, recentTurns(turns, now), { ...context, ...(met.length ? { met } : {}), budget, signal: controller.signal, ...(regionOf(inbound.from) ? { region: regionOf(inbound.from) } : {}) }),
          stall,
        ]),
        advisorId,
      ));
      answer = withoutLabel(answer, advisorId);
      if (!answer.trim()) throw new Error("empty_answer");
    } catch {
      await acked;
      await thinking;
      return null;
    } finally {
      clearTimeout(thinkingTimer);
      clearTimeout(stallTimer);
    }
    // One text, within SMS_MAX_SEGMENTS: label, introduction, answer and any offer line.
    const offer = suggest ? offerText(suggest) : null;
    let plain = toSmsText(answer);
    // Too long even so: rewritten as one complete text that fits, rather than cut.
    if (!answerFits({ label, intro, answer: plain, offer }) && deps.condense) {
      const room = roomForAnswer(budget, offer);
      try {
        const rewritten = withoutLabel(readSuggestion(await deps.condense(advisorId, plain, room), advisorId).text, advisorId);
        const candidate = toSmsText(rewritten);
        if (candidate.trim() && answerFits({ label, intro, answer: candidate, offer })) plain = candidate;
      } catch {
        // Keep the original; whole sentences that fit are kept below.
      }
    }
    await acked;
    await thinking;
    const reply = shortAnswerText({ label, intro, answer: plain, offer });
    // History keeps the answer as sent, so a follow-up carries on from what the person saw.
    // The label, the introduction and the offer line are part of the text only, never of the stored answer.
    current.turnsByAdvisor[advisorId] = [...turns, { role: "assistant" as const, text: reply.sent, at: now }].slice(-MAX_STORED_TURNS);
    introduce(current, advisorId);
    // One offer at a time: a new one replaces any other.
    if (suggest) current.pendingHandoff = { from: advisorId, to: suggest };
    await save(current);
    return [reply.text];
  };

  // An offer to bring in another advisor lasts for one text: a yes hands the
  // question over; anything else carries on as normal and the offer lapses.
  const pending = session.pendingHandoff;
  if (pending && !isNew) {
    delete session.pendingHandoff;
    const from = pending.from;
    const to = pending.to;
    const fromTurns = session.turnsByAdvisor[from] ?? [];
    const offered = fromTurns.at(-1);
    const asked = fromTurns.at(-2);
    if (
      isAdvisorId(from) &&
      isAdvisorId(to) &&
      session.advisorId === from &&
      offered?.role === "assistant" &&
      asked?.role === "user" &&
      agreesToHandoff(inbound.body, to)
    ) {
      // The handoff: no pick confirmation, the ack as usual, then the new advisor answers the original question.
      acknowledge();
      session.advisorId = to;
      // The new advisor's history keeps a note of the handoff, with what the first advisor said,
      // just before the question, so later answers know who brought them in and why.
      const replies = await answerWith(
        to,
        { role: "user", text: asked.text, images: asked.images },
        { handoff: { from, answer: offered.text } },
        [handoffNote({ from, answer: offered.text })],
      );
      if (replies) return replies;
      // Failed: stay with the first advisor, and keep the offer so YES can try again.
      session.advisorId = from;
      session.pendingHandoff = pending;
      await save(session);
      return [stalled ? STALLED_TEXT : FALLBACK_TEXT];
    }
    await save(session);
  }

  if (HELP_WORDS.has(text)) return [HELP_TEXT];

  // First message: the number opts in by texting us, and its first reply is
  // always the welcome, so the opt-out, frequency and rates terms arrive
  // before anything else. A pick is confirmed; a question is answered after it.
  if (isNew) {
    session.optedIn = true;
    const nav = readNavigation(inbound.body);
    if (nav?.kind === "switch") {
      const picked = advisorPickedText(session, nav.advisorId);
      session.advisorId = nav.advisorId;
      introduce(session, nav.advisorId);
      await save(session);
      return [WELCOME_TEXT, picked];
    }
    if (START_WORDS.has(text) || nav?.kind === "list" || isGreeting(inbound.body) || (!inbound.body.trim() && !inbound.media.length)) {
      await save(session);
      return [WELCOME_TEXT];
    }
    // A question: the welcome goes first, then the answer.
    firstContact = true;
    await save(session);
  } else {
    // Re-START while opted in restarts the welcome.
    if (START_WORDS.has(text)) {
      session.advisorId = null;
      await save(session);
      return [WELCOME_TEXT];
    }

    if (STOP_WORDS.has(text)) {
      session.optedIn = false;
      session.advisorId = null;
      await save(session);
      return [OPT_OUT_TEXT];
    }

    // Navigation: the advisor list, or a switch. Never stored as a turn, and
    // anything bundled into a switch ("talk to Gio about my sofa") isn't answered.
    // The advisor answers the pick themselves, introducing themselves if new.
    const nav = readNavigation(inbound.body);
    if (nav?.kind === "list") return [ADVISOR_LIST_TEXT];
    if (nav?.kind === "switch") {
      const picked = advisorPickedText(session, nav.advisorId);
      session.advisorId = nav.advisorId;
      introduce(session, nav.advisorId);
      await save(session);
      return [picked];
    }
    // A question that opens with an advisor's name ("Martine, what for dinner?")
    // switches to them, and they answer it (introducing themselves if new).
    const addressed = addressedAdvisor(inbound.body);
    if (addressed) session.advisorId = addressed;
  }

  const question = inbound.body.trim();
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
  const userTurn: SmsTurn = { role: "user", text: question, images: images.length ? images : undefined };
  const lead = firstContact && !welcomeSent ? [WELCOME_TEXT] : [];
  const replies = await answerWith(advisorId, userTurn);
  if (replies) return [...lead, ...replies];
  // Failed answers leave the turns untouched, so a retry starts clean. Only
  // the ack line used, and the routed advisor, are kept. A failed save never holds back a reply.
  await save(session);
  return [...lead, stalled ? STALLED_TEXT : FALLBACK_TEXT];
}

/** Whether this number has met an advisor: introduced, confirmed, or already in conversation. */
function hasMet(session: SmsSession, advisorId: SmsAdvisorId): boolean {
  return (session.introduced ?? []).includes(advisorId) || (session.turnsByAdvisor[advisorId]?.length ?? 0) > 0;
}

function introduce(session: SmsSession, advisorId: SmsAdvisorId): void {
  const met = session.introduced ?? [];
  if (!met.includes(advisorId)) session.introduced = [...met, advisorId];
}
