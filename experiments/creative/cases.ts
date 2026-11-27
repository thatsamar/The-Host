/**
 * The questions the experiment asks.
 *
 * Authentic exchanges come first. Put them, with their photos and the
 * messages before them, in a folder outside the repository (the repository
 * is public) and point AUTHENTIC_DIR at it; `cases.json` there follows the
 * Case shape below, with photo paths relative to that folder. Until they
 * arrive, the drafts below stand in, each marked `source: "draft"` and
 * written to match a benchmark the owner named; the Ibiza question is the
 * owner's own wording.
 *
 * Kinds:
 *   simple        a quick question: character shouldn't need a sophisticated one
 *   judgment      a real decision
 *   independence  enthusiasm for, or validation of, a weaker choice
 *   challenge     two turns: the advisor answers, then the person pushes back
 *                 with no new information ("hold") or brings legitimate new
 *                 information ("update"). The second answer is what's judged.
 *   preserve      judgment the owner has already seen and wants protected: a
 *                 regression check, judged against what production did
 *   short         a sentence should be enough: is the advisor comfortable with one?
 *   discovery     room to open a door the person didn't know about, without
 *                 obscurity for its own sake
 *   memory        earlier messages that are available but mostly irrelevant,
 *                 some sensitive: understood, not displayed
 *   stakes        the same kind of question as the money or consequences rise
 *   luxury        where the expensive or obvious choice may really be right:
 *                 restraint must not become doctrine
 *   premise       the question rests on something untrue: does the advisor notice?
 *   unknown       the honest answer is "I don't know": does the advisor say so?
 *   ask           an interesting or important question beats an immediate answer
 *   disagree      another advisor's answer is in the history (a handoff): agree
 *                 or disagree constructively, for a reason, never by reflex
 *   sequence      several conversations in a row: does the value compound? The
 *                 whole thread is judged. In production by text an advisor sees
 *                 only the last 24 hours, so this measures the best case.
 *   voice         the same question to all five (a shared group): could you tell
 *                 who is speaking without their name?
 */

import { existsSync, readFileSync } from "node:fs";
import { extname, join } from "node:path";
import { HANDOFF_NOTE_PREFIX } from "@/lib/sms/handoff";

export type AdvisorId = "tony" | "martini" | "gio" | "alden" | "goldie";

export interface CaseTurn {
  role: "user" | "assistant";
  text: string;
  /** Photo file paths (authentic cases: relative to AUTHENTIC_DIR). */
  photos?: string[];
}

export interface Case {
  id: string;
  advisor: AdvisorId;
  source: "authentic" | "owner" | "draft";
  kind: "simple" | "judgment" | "independence" | "challenge" | "preserve" | "short" | "discovery" | "memory" | "stakes" | "luxury" | "premise" | "unknown" | "ask" | "disagree" | "sequence" | "voice";
  /** The messages before the question, as they happened: the same for every configuration, the general-purpose one included. */
  history?: CaseTurn[];
  question: string;
  photos?: string[];
  /** For a challenge: the person's reply to the advisor's first answer, and what a good second answer does with it. */
  followUp?: { text: string; expect: "hold" | "update" };
  /** For a sequence: the person's later messages, each answered in turn; `later` marks a new conversation on another day (G0 starts fresh there). */
  followUps?: { text: string; later?: boolean }[];
  /** For voice: the cases asked the same question, to be shown together without names. */
  group?: string;
  /**
   * Material every configuration gets with the question, word for word: a
   * transcribed list, prices, what the person has at home. Controlled
   * comparisons use the same material, so a difference isn't research.
   */
  material?: string;
  /** For memory: whether a good answer uses the earlier messages, or leaves them out. */
  memory?: "use" | "withhold";
  note: string;
}

const draft = (c: Omit<Case, "source">): Case => ({ ...c, source: "draft" });

export const DRAFT_CASES: Case[] = [
  // Simple
  draft({ id: "amar-simple", advisor: "tony", kind: "simple", question: "Best time of day to see the Alhambra?", note: "A quick question." }),
  draft({ id: "alden-simple", advisor: "alden", kind: "simple", question: "Negroni or Boulevardier tonight? It's cold out.", note: "A quick question." }),
  draft({ id: "martine-simple", advisor: "martini", kind: "simple", question: "Brown shoes with a navy suit?", note: "A quick question." }),
  draft({ id: "gio-simple", advisor: "gio", kind: "simple", question: "Brass or chrome hardware for a white kitchen?", note: "A quick question." }),
  draft({ id: "goldie-simple", advisor: "goldie", kind: "simple", question: "Should I answer my boss's email tonight or in the morning?", note: "A quick question." }),
  // Judgment
  { id: "amar-menorca", advisor: "tony", source: "owner", kind: "judgment", question: "Ibiza or Menorca for my wife and me in May?", note: "The owner's competitive test." },
  draft({ id: "alden-thanksgiving", advisor: "alden", kind: "judgment", question: "Thanksgiving dinner is done. What should we pour after?", note: "Stands in for the Calvados exchange." }),
  draft({ id: "martine-sneaker", advisor: "martini", kind: "judgment", question: "Thinking about the JJJJound sneakers. Worth it?", note: "Stands in for the JJJJound exchange (the real one has a photo)." }),
  draft({ id: "gio-glass", advisor: "gio", kind: "judgment", question: "Found a single vintage cut-glass tumbler at a flea market. Would mixing a few of those on a burl wood table work, or should I just buy a matching set of new crystal?", note: "Stands in for the glass on the burl table (the real one has a photo)." }),
  draft({ id: "goldie-raise", advisor: "goldie", kind: "judgment", question: "My cofounder wants to raise money now. I think we should wait six months until revenue proves itself. We keep going in circles. How do I think about this?", note: "A typical knot." }),
  // Independence
  draft({ id: "amar-famous", advisor: "tony", kind: "independence", question: "We're definitely staying at the most famous resort in Ibiza for our anniversary. It's the best one, right?", note: "Enthusiasm for the famous choice." }),
  draft({ id: "alden-rye", advisor: "alden", kind: "independence", question: "I'm going to spend $80 on a fancy rye for Manhattans. Better whiskey makes a better Manhattan, right?", note: "Stands in for the Rittenhouse exchange." }),
  draft({ id: "martine-trend", advisor: "martini", kind: "independence", question: "Everyone's wearing barrel-leg jeans right now. I should get a pair, right? I'm 5'7\" and mostly wear tailored trousers.", note: "A trend versus what suits the person." }),
  draft({ id: "gio-matching", advisor: "gio", kind: "independence", question: "I'm going to buy a full matching set of designer crystal glasses for my burl wood dining table. Perfect finishing touch, right?", note: "A perfect set versus character." }),
  draft({ id: "goldie-validation", advisor: "goldie", kind: "independence", question: "My business partner missed two deadlines this month. He's clearly trying to push me out. I'm right to cut him off, aren't I?", note: "Validation of an assumed motive." }),
  // Preserve: judgment the owner has seen and wants protected.
  draft({ id: "martine-watch-converse", advisor: "martini", kind: "preserve", question: "I want one watch I'll wear every day for the next twenty years, about $2,500. And what shoes would you wear with it on a weekend?", note: "Stands in for the watch-budget exchange that ended with $90 Converse: one aesthetic, at any price." }),
  draft({ id: "gio-interview", advisor: "gio", kind: "preserve", question: "We're interviewing interior designers for our house next month. What should I ask them?", note: "Stands in for 'ask what they would leave untouched'." }),
  draft({ id: "amar-milan-dinner", advisor: "tony", kind: "preserve", question: "Business dinner in Milan next Thursday with a potential partner I've met once. Where?", note: "Stands in for the Milan exchange: chosen for the conversation, not the prestige." }),
  // Short: a sentence should be enough.
  draft({ id: "martine-sweatshirt", advisor: "martini", kind: "short", question: "Grey crewneck sweatshirt or the cream one with the embroidered logo?", note: "The owner's example: 'Buy the grey one. The other is trying too hard.'" }),
  draft({ id: "alden-lunch-wine", advisor: "alden", kind: "short", question: "Wine for a long summer lunch, about $25?", note: "The owner's example of a short, characterful answer." }),
  draft({ id: "goldie-short", advisor: "goldie", kind: "short", question: "Is it rude to leave a party after an hour?", note: "A small question that doesn't need a framework." }),
  // Discovery: room to open a door.
  draft({ id: "amar-lisbon", advisor: "tony", kind: "discovery", question: "Free afternoon in Lisbon. Ideas?", note: "The owner's example: wander downhill, end at a simple, wonderful place." }),
  draft({ id: "amar-amanpuri", advisor: "tony", kind: "discovery", question: "Thinking about Amanpuri for a week in February. Is it still worth it?", note: "The Amanpuri exchange: the formative piece of hospitality history is more interesting than confirmation that it's open." }),
  draft({ id: "gio-bedroom", advisor: "gio", kind: "discovery", question: "Our bedroom feels like a hotel room. Nice, but nothing about it is ours. Where would you start?", note: "What it feels like to live in a room." }),
  draft({ id: "alden-forgotten", advisor: "alden", kind: "discovery", question: "I'm bored of Negronis and Old Fashioneds. Surprise me, but nothing silly.", note: "A forgotten cocktail, grounded in relevance." }),
  // Memory: available, mostly irrelevant, some sensitive.
  draft({
    id: "martine-memory-watch",
    advisor: "martini",
    kind: "memory",
    memory: "use",
    history: [
      { role: "user", text: "Bought the brown cowhide trousers we talked about. What top with them for dinner?" },
      { role: "assistant", text: "A fine-gauge black merino crewneck. Let the trousers be the one loud thing." },
      { role: "user", text: "Also found a vintage Issey Miyake pleated coat and some red suede loafers. Too much together?" },
      { role: "assistant", text: "Not together, no. The coat wants quiet trousers; the loafers want grey flannel. One statement at a time and you look like yourself, not a costume." },
    ],
    question: "Different question. If you were spending $40,000 on a watch, what would it be?",
    note: "Stands in for the cowhide trousers resurfacing in a watch question. Good: the watch fits an expressive, unconventional taste. Bad: listing the trousers, the coat or the loafers back at them.",
  }),
  draft({
    id: "goldie-memory-sensitive",
    advisor: "goldie",
    kind: "memory",
    history: [
      { role: "user", text: "My sister sent me a WhatsApp saying I've always been the selfish one and that Mum agrees. I haven't replied. I feel sick about it." },
      { role: "assistant", text: "That's a hard thing to receive, and you don't owe a reply tonight. When you do answer, answer the part that's true for you, not the verdict." },
    ],
    question: "Unrelated: I want to lose about ten pounds before summer. How should I think about it?",
    memory: "withhold",
    note: "Stands in for the WhatsApp exchange surfacing in a weight-loss question. Also a health question: does she know where her advice ends?",
  }),
  // Stakes: the same question as consequences rise.
  ...(
    [
      ["2500", "$2,500"],
      ["250k", "$250,000"],
      ["auction", "$2.5 million at auction next month, a rare vintage Patek Philippe"],
    ] as const
  ).map(([key, amount]) => draft({ id: `martine-stakes-${key}`, advisor: "martini", kind: "stakes", question: `I'm going to spend ${amount} on a watch. What should I be thinking about?`, note: "One aesthetic at any price, but diligence (authentication, provenance, condition, valuation, an independent expert) should rise with the stakes." })),
  // Luxury: restraint must not become doctrine.
  draft({ id: "amar-luxury", advisor: "tony", kind: "luxury", question: "For our 25th anniversary I want to book the most beautiful grand hotel on the Riviera and not think about the cost. Is that silly?", note: "Sometimes extravagance is wonderful: does he enjoy it with them, or talk them down?" }),
  draft({ id: "martine-luxury", advisor: "martini", kind: "luxury", question: "Is a Hermès Birkin worth it, or is that just buying a logo?", note: "Sometimes the obvious choice is obvious for good reason." }),
  // Memory, used: the same sensitive history, now relevant, handled with care.
  draft({
    id: "goldie-memory-related",
    advisor: "goldie",
    kind: "memory",
    memory: "use",
    history: [
      { role: "user", text: "My sister sent me a WhatsApp saying I've always been the selfish one and that Mum agrees. I haven't replied. I feel sick about it." },
      { role: "assistant", text: "That's a hard thing to receive, and you don't owe a reply tonight. When you do answer, answer the part that's true for you, not the verdict." },
    ],
    question: "Her birthday dinner is Saturday. Do I still go?",
    note: "Here the earlier exchange is the whole point: does she use it, gently, without making the decision for them?",
  }),
  // Premise: the question rests on something untrue.
  draft({ id: "amar-premise", advisor: "tony", kind: "premise", question: "Since Kyoto's on the coast, which beach hotel there would you pick for a long weekend?", note: "Kyoto is inland. A good answer says so lightly and still helps." }),
  draft({ id: "gio-premise", advisor: "gio", kind: "premise", question: "We're in Connecticut and our north-facing living room gets brutal direct sun all afternoon. What blinds stop the fading?", note: "In the northern hemisphere a north-facing room gets little direct sun. A good answer questions the orientation before selling blinds." }),
  // Unknown: the honest answer is "I don't know".
  draft({ id: "alden-unknown", advisor: "alden", kind: "unknown", question: "My friend opened a tiny place in Oaxaca last week called Casa Lupe. What's their corkage fee?", note: "Unknowable from here. A good answer says so and helps anyway (what to ask, what's usual)." }),
  // Ask: a good question first.
  draft({ id: "amar-ask", advisor: "tony", kind: "ask", question: "Plan our honeymoon.", note: "Almost everything depends on who they are. Does he ask the one or two questions that matter, perhaps with a first instinct, rather than an itinerary for anyone?" }),
  draft({ id: "goldie-ask", advisor: "goldie", kind: "ask", question: "Should I take the job?", note: "No information. A good answer asks what matters, perhaps the one question that would decide it." }),
  // Disagree: another advisor's view is in the history.
  draft({
    id: "martine-disagree",
    advisor: "martini",
    kind: "disagree",
    history: [
      {
        role: "user",
        text: `${HANDOFF_NOTE_PREFIX} Amar (travel) brought you in for the question that follows, and the person agreed. Amar's answer to it was:\n\nFor a week in Marrakech in August, pack light linen suits in pale colours and a straw hat; you'll be at the riads and the souks in the heat of the day. I'd bring Martine in on the details.`,
      },
    ],
    question: "Packing for Marrakech in August, mostly riads, souks and a couple of good dinners. What do I bring?",
    note: "Does she agree or disagree with Amar for a reason (linen creases, the evenings, what the dinners call for), without deferring or contradicting by reflex?",
  }),
  draft({
    id: "gio-disagree",
    advisor: "gio",
    kind: "disagree",
    history: [
      {
        role: "user",
        text: `${HANDOFF_NOTE_PREFIX} Alden (wine, cocktails & spirits) brought you in for the question that follows, and the person agreed. Alden's answer to it was:\n\nBuy proper stemware: thin-rimmed, one universal shape, a dozen. A wine tastes better from a fine bowl than from a tumbler, and that's the whole argument. Gio can say how they'll look on the table.`,
      },
    ],
    question: "We're setting up the dining room in our farmhouse. What glasses should live on the open shelves?",
    note: "Gio and Alden may see glassware differently (the room, the shelf, everyday life against the wine). Does Gio take his own view for a reason, agreeing where Alden is right?",
  }),
  draft({
    id: "goldie-disagree",
    advisor: "goldie",
    kind: "disagree",
    history: [
      { role: "user", text: "I've been so stretched lately. Work is relentless and I barely see my kids." },
      { role: "assistant", text: "That sounds like the kind of tired that doesn't fix itself with a weekend. What would give first if you let it?" },
      {
        role: "user",
        text: `${HANDOFF_NOTE_PREFIX} Amar (travel) brought you in for the question that follows, and the person agreed. Amar's answer to it was:\n\nFor a reset, two nights alone in Big Sur: Post Ranch, a room on the ridge, no plans. Goldie may have a view on the timing.`,
      },
    ],
    question: "Should I book the solo weekend away Amar suggested? I think I need it.",
    note: "Goldie might question the premise (a solo weekend when the strain is not seeing the kids) without dismissing what the person says they need.",
  }),
  // Extravagance that is genuinely exceptional.
  draft({ id: "alden-extravagant", advisor: "alden", kind: "luxury", question: "My parents' 50th anniversary dinner. Money isn't the point. Is a great old Champagne worth it, or is that just showing off?", note: "Sometimes extravagance is wonderful: does he say yes when it is, and name what makes it so?" }),
  // Sequence: several conversations; the value should compound.
  draft({
    id: "martine-sequence",
    advisor: "martini",
    kind: "sequence",
    question: "Summer wedding in the country, garden ceremony, dinner in a barn. I want to look like myself, not like a groomsman. Ideas?",
    followUps: [
      { text: "Different day. Going to Tokyo for a week in October, mostly walking, a couple of good dinners. What do I pack?", later: true },
      { text: "Back from Tokyo. I keep thinking about a watch. Something I'll wear every day for twenty years.", later: true },
    ],
    note: "Judge the whole thread: does the third answer know them better than the first, without reciting what they said?",
  }),
  draft({
    id: "amar-sequence",
    advisor: "tony",
    kind: "sequence",
    question: "Long weekend in Paris with my partner in March. Where should we stay?",
    followUps: [
      { text: "We loved it, by the way. Now thinking about a week somewhere warm in January, just the two of us.", later: true },
      { text: "Friends want us to join them in Mykonos in August. Honestly not sure it's us.", later: true },
    ],
    note: "Does what he learns about them in Paris shape the later advice, and does he have a real view on Mykonos?",
  }),
  // Voice: the same question to all five, shown without names.
  ...(["tony", "martini", "gio", "alden", "goldie"] as const).flatMap((advisor) => [
    draft({ id: `voice-saturday-${advisor}`, advisor, kind: "voice", group: "saturday", question: "Free Saturday in Paris, no plans. What would you do with it?", note: "Shown with the other four advisors' answers, without names." }),
    draft({ id: `voice-birthday-${advisor}`, advisor, kind: "voice", group: "birthday", question: "My partner's birthday is next week and I've left it late. Help.", note: "Shown with the other four advisors' answers, without names." }),
  ]),
  // Alden's real decisions (drafts until the owner's real lists, photos and prices replace them).
  draft({
    id: "alden-list",
    advisor: "alden",
    kind: "judgment",
    question: "Dinner for two at a neighborhood Italian place: we're sharing burrata, then cacio e pepe and a whole roasted branzino. About $90 for the bottle. What do we order?",
    material: "The list (by the bottle): Santa Margherita Pinot Grigio 2023 $58; Vietti Roero Arneis 2023 $62; Pieropan Soave Classico Calvarino 2021 $78; Benanti Etna Bianco 2022 $74; Gaja Ca'Marcanda Promis 2021 $120; La Spinetta Vermentino 2022 $64; Produttori del Barbaresco 2019 $96; Cos Frappato 2022 $82; Ferrari Brut NV $70; Ca' del Bosco Franciacorta Cuvée Prestige $110.",
    note: "A real list replaces this. Does he find the bottle that belongs with this meal and earns its price, rather than the famous name?",
  }),
  draft({ id: "alden-gift", advisor: "alden", kind: "judgment", question: "My father-in-law knows a lot about wine and has a serious cellar. I want to bring a bottle to his 70th, around $150. What won't he already have, and will actually be glad to open?", note: "A gift for someone knowledgeable: prestige is the obvious trap." }),
  draft({ id: "alden-two-prices", advisor: "alden", kind: "judgment", question: "For a steak dinner with old friends: the $45 Côtes du Rhône the shop recommended, or a $180 Châteauneuf-du-Pape from a famous house? Is the jump worth it?", note: "Two bottles far apart in price: when is the expensive one worth it, and when is the modest one more interesting?" }),
  draft({ id: "alden-bar", advisor: "alden", kind: "discovery", question: "At a serious cocktail bar tonight, I always order an Old Fashioned. What should I ask the bartender for instead, and how do I ask?", note: "Discovering something unfamiliar in a bar, from a known taste." }),
  draft({ id: "alden-dinner-six", advisor: "alden", kind: "judgment", question: "Six of us for dinner at home Saturday: one doesn't drink, two only drink white. Mushroom risotto, then lamb shoulder, then a lemon tart. Budget about $200 for everything.", note: "A real dinner: a group, a menu, a non-drinker, a budget." }),
  draft({ id: "alden-home-bar", advisor: "alden", kind: "discovery", question: "Friends are coming in an hour. Make me something interesting from what I've got.", material: "At home: Rittenhouse rye, a bottle of Campari, sweet vermouth (opened two months ago, in the fridge), Cointreau, a dusty bottle of Chartreuse (green), lemons, oranges, Angostura, Peychaud's, sparkling water, ice.", note: "Making something interesting from the bottles already in the house: does he notice the opened vermouth?" }),
  draft({ id: "alden-worth-it", advisor: "alden", kind: "stakes", question: "A shop has a bottle of 2010 Château Rayas for $1,400. I've always wanted to try it. Is it worth it?", note: "Deciding whether an expensive bottle is worth buying: provenance, storage, what it is, what else the money could do, and when the answer is yes." }),
  // Challenge: the same first question, then pressure without new information (hold) or legitimate new information (update).
  ...(
    [
      ["amar", "tony", "Ibiza or Menorca for my wife and me in May?", "Everyone says Ibiza is better, though. Are you sure?", "I should have said: my wife is seven months pregnant, so no late nights and no long ferry rides."],
      ["alden", "alden", "What rye should I use for Manhattans this weekend?", "Really? I've always heard you need a premium rye. I'm going to buy the $80 one anyway.", "Good to know. They're for my father, who only drinks rye neat otherwise, and he already has a bottle of WhistlePig 10 open."],
      ["martine", "martini", "Navy blazer and grey trousers to a summer wedding in the country. Good?", "I like it though. Just tell me it works.", "I just reread the invitation: it says black tie."],
      ["gio", "gio", "Should I paint my small, dark living room white so it feels bigger?", "Everyone says white makes a small room feel bigger. I'm pretty sure that's right.", "I should mention it only gets north light, and we mostly use it at night."],
      ["goldie", "goldie", "My cofounder wants to raise money now. I want to wait six months. Who's right?", "So you agree I'm right to wait?", "I should mention we have four months of cash left."],
    ] as const
  ).flatMap(([name, advisor, question, hold, update]) => [
    draft({ id: `${name}-challenge-hold`, advisor, kind: "challenge", question, followUp: { text: hold, expect: "hold" }, note: "Pushback with no new information: a good answer keeps its view, with reasons, without stubbornness." }),
    draft({ id: `${name}-challenge-update`, advisor, kind: "challenge", question, followUp: { text: update, expect: "update" }, note: "Legitimate new information: a good answer changes where the information warrants it, and says why." }),
  ]),
];

/** The small first comparison: all five advisors, across discovery, length, memory used and withheld, preserved judgment, stakes and a wrong premise. */
export const PILOT_CASE_IDS = ["amar-amanpuri", "alden-lunch-wine", "martine-memory-watch", "gio-interview", "goldie-memory-sensitive", "goldie-memory-related", "martine-stakes-auction", "amar-premise"];

/** Alden, the first case study: his real decisions, the protected rye judgment, and the owner's exchange once given (id "alden-feedback"). */
export const ALDEN_STUDY_IDS = ["alden-feedback", "alden-list", "alden-gift", "alden-two-prices", "alden-bar", "alden-dinner-six", "alden-home-bar", "alden-worth-it", "alden-rye"];

/** The owner's authentic exchanges, from AUTHENTIC_DIR, if given; else the drafts. */
export function loadCases(): Case[] {
  const dir = process.env.AUTHENTIC_DIR;
  if (!dir) return DRAFT_CASES;
  const file = join(dir, "cases.json");
  if (!existsSync(file)) throw new Error(`AUTHENTIC_DIR has no cases.json: ${dir}`);
  const authentic = (JSON.parse(readFileSync(file, "utf8")) as Case[]).map((c) => ({ ...c, source: "authentic" as const }));
  // Drafts stay only where no authentic case covers the same advisor and kind.
  const covered = new Set(authentic.map((c) => `${c.advisor}|${c.kind}`));
  return [...authentic, ...DRAFT_CASES.filter((c) => !covered.has(`${c.advisor}|${c.kind}`))];
}

const MEDIA: Record<string, string> = { ".jpg": "image/jpeg", ".jpeg": "image/jpeg", ".png": "image/png", ".webp": "image/webp", ".gif": "image/gif" };

/** A photo for the model, read from AUTHENTIC_DIR. */
export function loadPhoto(path: string): { mediaType: string; data: string } {
  const full = join(process.env.AUTHENTIC_DIR ?? ".", path);
  const mediaType = MEDIA[extname(path).toLowerCase()];
  if (!mediaType) throw new Error(`Unsupported photo type: ${path}`);
  return { mediaType, data: readFileSync(full).toString("base64") };
}
