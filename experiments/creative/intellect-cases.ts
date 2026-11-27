/**
 * The intellectual study's questions (INTELLECT.md), for all five advisors on
 * equal terms. Drafts, written to be ordinary: what people really text.
 *
 * Each case may carry a `check`: one behaviour an automated check can judge
 * without taste (did it ask before advising, did it agree when the person
 * was right, did it notice the deciding condition). A check never decides
 * which answer is better; the owner does (EVALUATION.md).
 *
 * Longitudinal cases hold several earlier conversations, each turn marked
 * with how many days before the question it was said (`daysAgo`), and the
 * `facts` a good final answer is shaped by ("use") or leaves out
 * ("withhold"). Each runs twice: with the first two conversations only
 * (`-early`) and with all of them (`-full`), to see whether judgment
 * improves as the advisor knows the person better.
 */

import type { AdvisorId, Case, CaseTurn } from "./cases";

const d = (c: Omit<Case, "source">): Case => ({ ...c, source: "draft" });

type Kind = "ambiguous" | "financial" | "everyday" | "unfamiliar" | "ask" | "status" | "price" | "conventional" | "agree" | "conversational";

/** Conversation, not a request: a good answer talks, it doesn't research, plan or list. */
const TALK = "Responds as a conversation would: a genuine thought, observation or question of its own, without a research report, itinerary, shopping list or plan nobody asked for.";

/** [kind, question, check] for one advisor. */
type Row = [Kind, string, string];

const ROWS: Record<AdvisorId, Row[]> = {
  tony: [
    ["conversational", "Just got back from Lisbon. What a city.", TALK],
    ["ambiguous", "Thinking about Japan in April.", "Recognises that April is cherry-blossom season (crowds, prices, booking early) and either asks what they want from the trip or states the assumption it makes."],
    ["financial", "We have about $12,000 for two weeks next summer, the two of us. One splurge week in Italy, or two comfortable weeks somewhere cheaper?", "Takes a clear position and ties it to how the money plays out over the trip, not only to the destinations."],
    ["everyday", "Driving Austin to Dallas Saturday morning. Anywhere worth stopping for lunch?", "Names no place it cannot stand behind; anything uncertain (hours, whether it still exists) is marked or framed as worth checking."],
    ["unfamiliar", "I'm 23, never been abroad, about $1,500 saved. Where should I go first?", "Fits the advice to the budget and a first trip abroad; no luxury assumptions."],
    ["ask", "Need somewhere for a weekend away next month.", "Asks the one or two questions that decide it (from where, who with, what kind of weekend), perhaps with a first instinct, rather than a generic list."],
    ["status", "First time in Paris, four nights, and we booked the Ritz because it's the most famous hotel there. Good call?", "Judges the choice on fit for this trip, not on fame; agrees or disagrees for a specific reason."],
    ["price", "Is a $900-a-night hotel in Rome really better than a $350 one?", "Says specifically what the extra money buys and when it is or isn't worth it."],
    ["conventional", "Everyone says you need at least a week for Iceland. We only have four days. Is it pointless?", "Gives its own view with a concrete plan or reason rather than repeating the common advice."],
    ["agree", "We're skipping Venice on our Italy trip and spending those days hiking in the Dolomites instead. We love hiking and hate crowds. Makes sense?", "Agrees, with a specific reason; does not invent a disagreement."],
  ],
  martini: [
    ["conversational", "Why do Italian men always seem to look so put together?", TALK],
    ["ambiguous", "Dinner at a nice place Saturday, dress code says smart casual. Jacket or no jacket?", "Gives a decisive default and the condition that would change it."],
    ["financial", "Just got promoted and I have $3,000 to rebuild my work wardrobe. Where does the money go first?", "Prioritises: says what gets the money first and why, rather than an even shopping list."],
    ["everyday", "My white sneakers are getting grubby. Clean them or replace them?", "Answers plainly and briefly; a short answer is enough."],
    ["unfamiliar", "I'm 58, I've lost a lot of weight this year and nothing fits. I've never cared about clothes. Where do I start?", "Practical first steps for someone new to this; no assumptions about gender or wealth; no medical commentary."],
    ["ask", "Help me look better.", "Asks a useful question (or two) before advising, perhaps with a first observation."],
    ["status", "Invited to a gala. I want a designer label people will recognize. Which one?", "Steers toward what will look right on this person at this occasion over recognisability, without sneering at the wish."],
    ["price", "Is a $400 white T-shirt actually better than a $40 one?", "Says concretely what, if anything, the money buys and when it's worth it."],
    ["conventional", "Is it true you should never wear black and navy together?", "Gives its own reasoned view rather than repeating or reflexively reversing the rule."],
    ["agree", "I'm wearing my grey flannel suit with a white shirt and no tie to a weekday gallery opening. Good?", "Agrees, with a specific reason; adds a refinement only if it is genuine."],
  ],
  gio: [
    ["conversational", "Why do old hotel lobbies feel so much better than new ones?", TALK],
    ["ambiguous", "Our living room feels off and I can't tell why.", "Asks for what it needs (a photo, the layout, the light) or offers the most likely causes as hypotheses, not a verdict."],
    ["financial", "We have $25,000 for the living room. Put most of it into one great sofa, or spread it across everything?", "Takes a clear position on where the money goes and why."],
    ["everyday", "What color should I paint a small powder room?", "Gives a definite view with the reason it suits a small room used briefly."],
    ["unfamiliar", "First apartment, renting, about $600 total, and the landlord says no nails. How do I make it feel like mine?", "Advice fits a renter on $600 with no nails; nothing that needs a bigger budget or permanent changes."],
    ["ask", "Redo my bedroom.", "Asks what it needs to know (a photo, budget, what bothers them) before prescribing."],
    ["status", "We're buying eight of a famous designer's dining chairs, $14,000, because they're iconic. Smart?", "Judges on comfort, the room and how they'll live with them, not on fame; agrees or disagrees for a reason."],
    ["price", "Is a $9,000 sofa really that much better than a $2,500 one?", "Says concretely what the money buys (frame, cushions, upholstery, longevity) and when it's worth it."],
    ["conventional", "Shouldn't all the wood in a room match?", "Gives its own reasoned view rather than repeating the rule."],
    ["agree", "I'm keeping my grandmother's old oak table even though nothing else in our modern apartment matches it. Right call?", "Agrees, with a specific reason; does not invent a disagreement."],
  ],
  alden: [
    ["conversational", "Why does wine always taste better on holiday?", TALK],
    ["ambiguous", "Bringing wine to a dinner party Saturday. Red or white?", "Gives a sensible default and the deciding condition (the menu, the host), or asks about the menu."],
    ["financial", "Thinking of buying a case of 2022 Bordeaux en primeur as an investment, about $4,000. Good idea?", "Separates drinking from investing, promises no returns, and names what would have to be checked."],
    ["everyday", "Opened a bottle of red on Tuesday. Still good on Saturday?", "Answers plainly and briefly, with the deciding condition (stoppered, fridge)."],
    ["unfamiliar", "I don't really drink, but I'm the one picking the wine at a work dinner next week. Help.", "Gives someone who doesn't drink a simple, workable way to choose; no expertise assumed."],
    ["ask", "What should I serve at my party?", "Asks what it needs to know (how many, what kind of party, food, budget) or gives a first instinct with the question that decides it."],
    ["status", "Should I order Dom Pérignon to impress a client at dinner?", "Judges on the occasion and the client, not on the label; agrees or disagrees for a reason."],
    ["price", "Is a $60 bottle of wine actually better than a $20 one?", "Says concretely what the extra money can buy and when it doesn't."],
    ["conventional", "Red wine with meat, white with fish, right?", "Gives its own reasoned view rather than repeating or reflexively reversing the rule."],
    ["agree", "I'm serving a dry German Riesling with Thai takeout tonight. Good?", "Agrees, with a specific reason; does not invent a disagreement."],
  ],
  goldie: [
    ["conversational", "Had a really good conversation with my dad today. First in years.", TALK],
    ["ambiguous", "My friend has been weird with me lately.", "Asks what it needs to know, or names the possibilities without assuming a motive."],
    ["financial", "My brother wants to borrow $15,000 to start a food truck. I can afford it, but losing it would hurt. What do I do?", "Gives a view and a practical move; separates the money from the relationship."],
    ["everyday", "A coworker keeps taking credit for my ideas in meetings. How do I handle it without making it a thing?", "Gives one practical move the person controls."],
    ["unfamiliar", "I'm 19. My parents want me to study accounting but I want to do music. I don't want to disappoint them.", "Takes the person seriously at 19, without deciding their life for them."],
    ["ask", "I need to make a big decision by Friday.", "Asks what the decision is, or the one question that would help, rather than advising blind."],
    ["status", "My mentor, who's very successful, says I should quit my stable job to join her startup. She's usually right. I should, right?", "Forms its own view of the decision rather than deferring to the mentor's status."],
    ["price", "I'm thinking of paying $8,000 for an executive coach because the expensive ones are better. Worth it?", "Questions price as a proxy for quality and says what would make it worth it."],
    ["conventional", "Everyone says never mix business with friends. My best friend wants to go into business with me. Should I say no?", "Gives its own view of this case rather than repeating the rule."],
    ["agree", "I've decided not to go to my ex's wedding. We're civil, but it would be painful and they'll understand. I'm comfortable with that.", "Agrees, with a specific reason; does not manufacture a concern."],
  ],
};

const NAME: Record<AdvisorId, string> = { tony: "amar", martini: "martine", gio: "gio", alden: "alden", goldie: "goldie" };

const single = (Object.keys(ROWS) as AdvisorId[]).flatMap((advisor) =>
  ROWS[advisor].map(([kind, question, check]) => d({ id: `${NAME[advisor]}-i-${kind}`, advisor, kind, question, check, note: `Intellectual study: ${kind}.` })),
);

/** One earlier conversation: what the person said, the advisor's reply, and when. */
const session = (daysAgo: number, user: string, assistant: string): CaseTurn[] => [
  { role: "user", text: user, daysAgo },
  { role: "assistant", text: assistant, daysAgo },
];

interface Longitudinal {
  advisor: AdvisorId;
  sessions: CaseTurn[][];
  question: string;
  facts: { text: string; kind: "use" | "withhold" }[];
}

const LONGITUDINAL: Longitudinal[] = [
  {
    advisor: "tony",
    sessions: [
      session(40, "Back from Mexico City. Loved the markets and walking everywhere. Then we did a big resort in Cancún and hated it.", "That's useful to know: you travel best on foot in a city with a food culture, and a resort bores you. Next time, give the city the extra days."),
      session(26, "Knee surgery in two weeks, so nothing too hilly for a while after.", "Noted. Flat cities and short walks for a few months; I'll keep that in mind."),
      session(12, "My partner's vegetarian, by the way, so food trips have to work for her too.", "Good to know. Plenty of great food cities are easy for vegetarians; some are much harder."),
      session(5, "Work has been brutal. My manager is impossible.", "That sounds draining. When you want a break to plan, I'm here."),
    ],
    question: "Thinking about a long weekend in Europe in late spring. Where?",
    facts: [
      { text: "Prefers walkable cities with a food culture and markets over resorts", kind: "use" },
      { text: "Recovering from knee surgery: steep, hilly cities are a poor fit", kind: "use" },
      { text: "Partner is vegetarian", kind: "use" },
      { text: "Trouble with their manager at work", kind: "withhold" },
    ],
  },
  {
    advisor: "martini",
    sessions: [
      session(50, "I run hot, always. Wool in summer is misery.", "Then linen, cotton and open weaves in summer, and keep the wool for winter."),
      session(30, "I bike to work most days.", "Then you need things that move and don't mind a bag strap; keep a change at the office for the days it matters."),
      session(14, "Got the green linen overshirt you suggested. I've worn it to death.", "Good. Colour suits you more than you thought."),
      session(6, "My dad's funeral is next week.", "I'm so sorry. If you want help with what to wear, just ask; otherwise, take care of yourself."),
    ],
    question: "Starting a new office job in Houston next month. What should I build the wardrobe around?",
    facts: [
      { text: "Runs hot: Houston's heat makes breathable fabrics decisive", kind: "use" },
      { text: "Bikes to work: clothes must move, and a change at the office helps", kind: "use" },
      { text: "Responded well to colour and linen", kind: "use" },
      { text: "Father's funeral", kind: "withhold" },
    ],
  },
  {
    advisor: "gio",
    sessions: [
      session(45, "We rent. Two-year lease, strict landlord.", "Then everything you buy should be able to leave with you."),
      session(30, "Two big dogs, and one sheds like crazy.", "Then fabrics and colours that forgive hair and claws matter more than anything else on a sofa or rug."),
      session(15, "We kept the old rug like you said. Turns out we like warm, worn things more than new and shiny.", "That tells me a lot about what will make the place feel like yours."),
      session(4, "We're trying for a baby and it's been hard.", "I'm sorry it's been hard. I'm here whenever you want to think about the house."),
    ],
    question: "We need a new sofa for the living room, around $3,000. What should we look for?",
    facts: [
      { text: "Two large dogs, one sheds heavily: durable, hair-forgiving upholstery", kind: "use" },
      { text: "Renting on a two-year lease: a sofa that moves with them", kind: "use" },
      { text: "Prefers warm, worn things to new and shiny", kind: "use" },
      { text: "Trying for a baby", kind: "withhold" },
    ],
  },
  {
    advisor: "alden",
    sessions: [
      session(40, "I don't love oaky, buttery whites.", "Then look for unoaked whites with some tension: Chablis, Muscadet, Albariño."),
      session(28, "My wife's pregnant, so it's just me drinking for a while.", "Congratulations. Then half bottles and wines that keep a few days are your friends, and something good without alcohol for her."),
      session(16, "That Etna Rosso you suggested was a hit. Light reds are my thing.", "Good to know: lighter, fresher reds over big ones."),
      session(7, "My mother's been in hospital, so it's been a rough couple of weeks.", "I'm sorry. I hope she's on the mend."),
    ],
    question: "Dinner at home Friday, roast chicken, just the two of us. What should I open?",
    facts: [
      { text: "Likes light, fresh reds", kind: "use" },
      { text: "Only he is drinking: a half bottle or a wine that keeps, and something without alcohol for his wife", kind: "use" },
      { text: "Dislikes oaky, buttery whites", kind: "use" },
      { text: "His mother has been in hospital", kind: "withhold" },
    ],
  },
  {
    advisor: "goldie",
    sessions: [
      session(35, "My sister and I have run the family bakery together since Dad retired.", "A family business with your sister: that's two relationships in one, and they don't always want the same thing."),
      session(22, "I've realised I say yes to everything and then resent it.", "That's worth noticing. A yes you resent costs more than a no."),
      session(10, "Dad still calls me every day with opinions about the bakery, even though he's retired.", "So there are three people in the business, and only two of them work there."),
      session(3, "Trying to cut down on drinking, by the way.", "Good for you. Tell me if you want to think it through."),
    ],
    question: "My sister wants to open a second location. I'm not sure. How do I think about this?",
    facts: [
      { text: "Runs the family bakery with her sister: business and relationship together", kind: "use" },
      { text: "Tends to say yes and then resent it: a real no must be possible", kind: "use" },
      { text: "Their retired father still weighs in daily", kind: "use" },
      { text: "Trying to cut down on drinking", kind: "withhold" },
    ],
  },
];

const longitudinal = LONGITUDINAL.flatMap(({ advisor, sessions, question, facts }) => {
  const note = "Longitudinal: does knowing the person improve the decision, without displaying what it knows? Facts to use and to withhold are in `facts`.";
  return [
    d({ id: `${NAME[advisor]}-longitudinal-early`, advisor, kind: "longitudinal", history: sessions.slice(0, 2).flat(), question, facts: facts.map((f, i) => (i < 2 ? f : { ...f, kind: "absent" as const })), note }),
    d({ id: `${NAME[advisor]}-longitudinal-full`, advisor, kind: "longitudinal", history: sessions.flat(), question, facts, note }),
  ];
});

/** A sustained conversation with no trip to plan: would the person want to keep talking? The same turns by text and on the website. */
const TALK_TURNS = [
  "Been thinking about Japan again. Not sure why it keeps pulling at me.",
  "Maybe it's that everything there seems done properly, even the small stuff. Is that real or am I romanticizing it?",
  "I've only ever done Tokyo and Kyoto. Is there a version of Japan most people miss?",
  "Honestly I might not go for another year. I just like thinking about it.",
];
const talk: Case[] = (["text", "web"] as const).map((channel) =>
  d({
    id: channel === "text" ? "amar-talk" : "amar-talk-web",
    advisor: "tony",
    kind: "sequence",
    channel,
    question: TALK_TURNS[0],
    followUps: TALK_TURNS.slice(1).map((text) => ({ text })),
    check: TALK,
    note: "A sustained conversation, not a request: does he make it more interesting to keep talking, without turning it into research or a plan?",
  }),
);

export const INTELLECT_CASES: Case[] = [...single, ...longitudinal, ...talk];
