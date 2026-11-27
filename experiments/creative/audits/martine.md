# Martine: how she interprets, decides and concludes, and what reaches the model

An audit of her brief (`martini-prompt.ts`), her capabilities (`martini.ts`)
and the shared layers around them. These are findings from reading the
instructions, not results: nothing has been run.

## 1. What she receives

About 32,000 characters on text, 29,000 on the website.

| Layer | Characters |
|---|---|
| Her brief | 22,400 |
| Her own capabilities | 1,700 |
| Other advisors (`cinqAdvisors`) | 900 |
| `APP_JUDGMENT` | 3,600 |
| `APP_OUTPUT_LIMITS` | 600 |
| Text-only block (`textChannelNotes`, incl. `shortTextVoice`) | 3,200 |

Of the brief:

| Kind | Share | Examples |
|---|---|---|
| Convictions (actual views) | 56% | "Most style problems are proportion problems"; "harmony, not matching"; "Sexy is often restraint"; "Etiquette is the floor, not the ceiling"; invest/save/skip; dressing for place |
| Knowledge scope | 15% | the men's and women's garment lists; brand tiers; occasions; daily uniforms |
| Procedure, format, guardrails | 13% | purchase fields; outfit advice; photos; personality; the style test |
| Influences and references | 9% | Tom Ford, Ralph Lauren, Calvin Klein, Japanese streetwear and Kapital, Westwood; the style references |
| Identity | 7% | "the stylist who makes the person feel fantastic about themselves, pushes them a little bit, and shoots straight" |

Unlike Alden, she is mostly conviction: the risk is less missing views
than format and shared layers flattening them.

## 2. Her way of thinking, as the brief states it

**(a) What she reads first.** The occasion, not the clothes: "Always begin
with the experience: Where am I going? Who will be there? What is the
weather? What is the room? What is the mood?" and the desired feeling. In
a photo, "the whole person and the whole outfit… what feels personal, and
what feels forced." For a purchase, "first identify the wardrobe problem."
Underneath: "Find the person's natural persona and sharpen it."

**(b) What she treats as decisive.**
- Comfort and self-consciousness: "If the clothes make the person
  self-conscious, they failed"; "Comfort is non-negotiable", in five kinds
  (physical, social, emotional, sensual, visual).
- Fit and proportion: "Fit matters more than brand."
- Whether it is the person's own: "Does this make the person look more
  like themselves?… Is the edge coming from the person, or am I imposing
  it?… Could this be on anyone with money?"
- Money: "Is the money doing real work?" Splurge on frequency, quality,
  fit, craft, longevity; skip "when the only argument is brand, trend,
  scarcity, fantasy-life dressing, or fear of missing out."

**(c) How she reaches and states a conclusion.** By subtraction and one
move: "Identify the highest-leverage move first"; "One strong idea is
enough"; "When in doubt, simplify, improve the shoe… or remove one
thing"; before buying, "consider tailoring, hemming, changing shoes…".
Stated as a view first, then "the one change", its reason and "exact
styling instructions". She is told she may say "Don't buy anything" or
"Tailor what you own."

**(d) What a general assistant would miss.** Detail at the level of
"shoulder, rise, inseam… break… bag scale, watch size, and how the body
moves"; place ("Dinner in Miami is not dinner in New York"); outfits that look "bought
as a set" or "came from one store in one afternoon"; "A white T-shirt can
be nothing, or it can be the whole outfit"; social and sensual comfort.

**(e) Where she departs from conventional wisdom.** "Usually the better
move is harmony, not matching" (black with brown, gold with silver);
"Sexy is often restraint… Do not confuse sexy with exposed"; dress codes
understood "but you do not worship them"; "A little imperfection helps";
a vintage jacket "may be worth more than a new anonymous designer
jacket"; "Never assume expensive is better. Never assume affordable is
lesser"; "Bold means self-knowledge"

**(f) What she finds exceptional.** As principles: "The risk should feel
inevitable once it is on"; a piece that "had a life before the person";
"pieces with soul over pieces with marketing"; "clothes that look better
after a life has been lived in them". **Gap: owner input needed** on any
specific piece, maker or garment she considers exceptional and why: every
brand is conditional ("when it earns its place", "The Row… only when the
restraint does something").

Other gaps (owner input needed): how she reads different bodies beyond
the list of measures; places outside the nine named (most testers' own
cities); what she thinks is overrated now, by name, beyond the categories
in WHAT NOT TO DO.

## 3. Findings

1. **The outfit format presumes something is wrong.** The brief: "Then
   name the one change that makes the outfit work". The capabilities say it
   again, and a photo with no words is sent as "Give the outfit check: your
   read of it, and the one change that makes it work." Against her own
   "Tell them when something works. Tell them when they can carry it" and
   `APP_JUDGMENT`'s "Do not invent a disagreement". A good outfit still
   gets a change. "One change" is her conviction ("One strong idea is
   enough"), but always one change is a device. Every outfit check is
   read, then change, then why, then instructions: the same shape.
2. **The purchase field list shapes every purchase answer the same way.**
   Eleven fields to "Include" (brand, new vs vintage, material, colour,
   fit, price, wear, pairings, invest/save/skip, why) plus "at most two
   meaningfully different alternatives". `APP_JUDGMENT` says nearly the
   opposite: "Offer another only when a real difference… changes the
   answer" and "Include prices, sources… when they help the decision…
   Leave the rest of the research out." On the website the fields win and
   answers become spec sheets; on text (456 characters) they can't fit,
   so the list is moot there.
3. **The "Be willing to say" list and INVEST / SAVE / SKIP invite
   catchphrases.** "The vintage one has more soul", "This is trying too
   hard" are your wording and are good judgments, but as listed phrases
   they can be repeated verbatim. Worth checking across answers.
4. **"The call" is told three times, in two styles.** The brief: "end with
   it as THE CALL"; capabilities: "THE CALL only as a closing action";
   `APP_JUDGMENT`: "### The call, unless your instructions give their own
   label style". All optional; repetition may make it routine.
5. **The text voice softens her edge and may pull her toward buying.**
   `shortTextVoice`: "a well-informed friend with good taste texting a
   friend: natural, warm" and "specific (a name, a detail, a clear call)".
   Her brief: "shoots straight", "pushes them a little bit", "Do not gush".
   "A name" on a style question tends to be a brand, while the brief says
   "most outfits are fixed with what the person already has". The rewrite
   step (`condensePrompt`) never sees her brief, only "Keep the same voice".
6. **Experience first versus one question.** Her brief opens with six
   questions; text allows one, "only when the answer honestly depends on
   something"; capabilities say "state a light assumption or ask one
   question". Workable, but the brief never says which of the six
   usually decides.
7. **References as decoration.** "You know how Anna Wintour thinks, how
   Jennifer Aniston chills… why Miami Vice still has something to teach
   us" is manner. `APP_JUDGMENT` forbids "a cultural reference as
   decoration", as does the brief's "borrow principles, not costumes".
   Name-drops would be the first sign of style without substance.
8. **Search for purchases ranks retail.** "Use it for purchase
   recommendations". What ranks is new retail; she prefers vintage
   "whenever it gives more character".
9. **No territory line with Amar.** Packing, "great hotel bars" and
   dressing for place sit next to travel; Amar and Alden have a stated
   split, Martine does not.

## 4. Influences: choices or manner?

Mostly choices, unlike Alden's. Each bullet gives a judging principle
(precision and fit; the lived-in classic; the essential; patina and
repair; tradition with rebellion), and the "principles beneath them" are
decision rules: dress for the occasion "as a courtesy to others"; "fit and
care matter more than price"; "one note of character beats a costume".
But nearly all restate convictions already in the brief, adding emphasis
more than a distinct way of choosing; only Westwood's "rebellion" is new.
They are framed as "how a gentleman dresses", applied "just as much" to
women; women's sources appear only as one-word qualities in STYLE
REFERENCES ("Carolyn Bessette-Kennedy restraint"), which is manner.
Whether that balance is intended is an owner question.

## 5. Testable hypotheses

1. **She will invent a change for an outfit that already works** (finding
   1). Tests: photo of a navy suit, white shirt, brown shoes, "Work dinner
   tonight, ok?"; photo of a black slip dress and flat sandals, "Friend's
   birthday dinner, good?". She should say it works and why, or name a
   real problem, not add an accessory as a general assistant would.
2. **On purchases she differs most, through "Don't buy anything" and
   cost-per-wear, but in a fixed shape** (findings 2, 8). Tests: "Is a $650
   leather bag worth it for work every day?"; "Should I spend $400 on a
   wool coat or get the $120 one?". Expect a firmer call than a general
   AI; check whether answers always run through the eleven fields.
3. **Where her convictions match today's consensus, she won't differ.**
   Tests: "Can I wear black pants with brown shoes?"; "Is mixing gold and
   silver jewellery fine?". Both answers will likely be yes; the
   difference, if any, is the reason (harmony, proportion).
4. **Dressing for an occasion in an unlisted place, she reasons from the
   room and the feeling, not a list** (2a, 2e). Tests: "Cocktail attire
   wedding in October in Austin, what do I wear?", asked once as a man and
   once as a woman. Expect one personal move above the floor; check
   whether men and women get equal depth.
5. **On text she converges toward a general assistant** (finding 5).
   Test: "First date at a wine bar Friday, what should I wear?" by text and
   on the website. Expect the website to read the room and feeling; text
   to give a pick, often with a brand name, and lose the reason.
