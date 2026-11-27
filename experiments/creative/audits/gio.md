# Gio: how he interprets, decides and concludes, and how it reaches the model

An audit of his brief (`src/lib/companions/gio-prompt.ts`), his capabilities
(`gio.ts`) and the shared layers around them. Findings from reading the
instructions, not results: nothing has been run.

## What he receives

On text, about 22,000 characters. His brief is about 10,400 of them (under
half); the rest is his capabilities (about 2,300, plus 1,100 for the other
advisors), the shared judgment block (4,300), output limits (650), the
text-only block (about 4,000, of which the short-text voice is 1,200) and
the date.

| Kind | Share of brief | Examples |
|---|---|---|
| Convictions (actual views) | ~40% | experience first; "never confuse sophistication with austerity"; one strong idea, "not everything gets to be interesting"; subtract before adding; pools of light; the $500 anonymous chair; no 50/50 |
| Procedure, format and guardrails | ~26% | photo reading list; purchase checklist; when to ask; response style; cliché list; prices |
| Influences | ~22% | fourteen bullets, Ponti to Slim Aarons |
| Knowledge scope | ~10% | furniture designers to "draw intelligently from"; hotel references; "understand architecture, landscape, climate…" |
| Identity | ~3% | "personal interior designer and creative partner, with one distinct point of view" |

Unlike Alden's, his convictions are the largest part, and most decide
rather than balance.

## His way of thinking, as the brief states it

**(a) How he interprets a situation.** He starts from use, not looks:
"Always think: What experience are we creating?" and "Where do people
gather, linger, retreat…? What will they remember?" With a photo: "read the
whole space first: experience, architecture, warmth, comfort, sense of
place, proportion, circulation, sightlines, scale, light…" and adjacent
spaces. Beyond experience coming first, the fifteen items are unranked.
*Gap: owner input needed* on what his eye goes to first after that, and in
what order.

**(b) What he considers decisive.** "A beautiful room fails if nobody wants
to spend time there." Hierarchy: "one strong idea, supporting elements, and
plenty willing to be quiet." Belonging over signal: "Choose things because
they belong, not because they signal design knowledge." Cost: "Spend where
it materially improves experience… Save where more money adds little." The
final filter: "Could this be in almost anyone's expensive house? If yes,
look harder."

**(c) How he reaches and states a conclusion.** "Identify the
highest-leverage move first. Do not assume the answer is buying
something." "Before adding, consider subtracting, moving, lowering,
repositioning, changing scale, or improving light." "Lead with your
strongest judgment… and the observation in the room that led to it. Often
that judgment is to keep what works and test something before buying."
Comparing: "rank them and name the winner." Conflict: "do not split the
difference… find the strongest synthesis."

**(d) What he notices that a general assistant would miss.** Time of day
and light: "Always imagine the room at midnight"; "pools of light over
uniform illumination"; "afternoon sun on a chair, a view through a
doorway." Thresholds, sightlines, sound, touch. Things "that look better in
renderings than real life." "Homes should get better when occupied"; "leave
room for life to accumulate." *Gap: owner input needed* on the ordinary
cases most testers bring: a rental, a small budget, a small flat, paint and
colour (colour appears only as Ponti's "optimism" and Hayon's "wit").

**(e) Where he departs from conventional wisdom.** "Don't buy anything" and
"None of these. Keep looking." "A $500 anonymous vintage chair can beat a
$10,000 collectible." "Collected not coordinated"; "Art need not match";
against "showroom design, developer luxury, trends, Pinterest sameness" and
"design trophies"; against austere minimalism. *Gap: owner input needed* on
specific design rules he rejects (rug sizes, white walls, open plans,
matching sets, overhead light) and why.

**(f) What he finds exceptional.** Moments rather than objects: "a table
everyone gravitates toward, a terrace where lunch becomes dinner." Hotels
are named (Ett Hem, Saint Cecilia, Aman, Park Hyatt Tokyo…) with a pooled
list of reasons, not which quality makes each one exceptional. *Gap: owner
input needed* on particular pieces, rooms, materials or makers he considers
truly exceptional, and what makes them so.

## Findings

1. **He has a method, and the method is the distinctiveness.** Experience
   first, subtract before adding, one strong idea, light at night and the
   "expensive house" test are ways of reaching a conclusion, not a voice.
   The risks below are what crowds it out.
2. **The purchase checklist is stated twice and becomes a template.**
   - Brief: "Include: dimensions, material/color, vintage vs. new,
     approximate price, placement, why it belongs, whether the spend is
     justified, invest/save/skip", softened later by "Bring in cost…
     only when the person is actually deciding what to buy."
   - Capabilities: "give for each piece: Dimensions; Material/color;
     Vintage vs. new; Approximate price…; Placement; Why it belongs;
     Invest / save / skip." It drops "whether the spend is justified", the
     one field that is judgment rather than specification.
   - Two copies of a seven-field form pull answers towards a spec sheet,
     any shopping assistant's shape. On text it cannot fit in 456
     characters.
3. **The photo instruction in capabilities is generic.** "What's working,
   what isn't, and what to change first" is any assistant's three-part
   review; the brief's order is experience, then "the highest-leverage
   move". It is the wording sent with every photo.
4. **"Imagine the room at midnight" meets "do not… describe the room at
   night as if you had seen it"** (capabilities). Both are right, but
   unreconciled the safe reading is to drop the night view rather than
   offer it as an inference with a test.
5. **Leading with the judgment is said three times** (brief, APP_JUDGMENT,
   text voice). Consistent, but the shared copies drop his qualifier,
   "often that judgment is to keep what works."
6. **"The call" is invited twice.** Brief: "If a closing action helps, end
   with it as The call." APP_JUDGMENT adds a heading, "### The call". His
   own "Don't buy anything" is a stronger conclusion than a labelled
   ending; a routine call would be a stylistic device.
7. **The shared text voice pulls against his.**
   - Text: "a well-informed friend with good taste… natural, warm."
     Brief: "personal interior designer and creative partner… concise,
     decisive, practical, cultured," and his cliché list bans "warm and
     inviting unless truly specific."
   - Text: "specific (a name, a detail, a clear call)." A "name" invites a
     product or brand; the brief says "over brand" and "do not
     name-drop."
   - The budget is prescribed brevity: 456 characters leaves room for the
     move but often not the observation behind it, and the rewrite step
     (`condensePrompt`) never sees his brief.
8. **The other advisors are low risk** (`cinqAdvisors`: "never as a
   routine closing line"). One seam: his references overlap Amar's (hotels,
   Balazs, Lambert), so a hotel-design question may tempt a handoff that
   is his to answer.
9. **Two quoted lines could become catchphrases.** "Don't buy anything"
   and "None of these. Keep looking." are good conclusions; repeated
   verbatim they become manner. Watch, don't change.

## Influences

They shape choices more than Alden's do. Each bullet is a principle of
judgment: Liaigre's "luxury that never raises its voice", Vervoordt's
"patina, time and imperfection", Kuma's "simple, imperfect and beautiful",
Zecha's "space, silence and privacy", Wright, Schindler and Neutra's
indoor-outdoor living. The brief also says how to use them: "shape what
you notice and how you judge, not what you copy… Do not name-drop."

Two limits. Most restate convictions the brief already holds (patina,
restraint, sense of place), so they reinforce rather than add. And the
furniture-designer list under AESTHETIC (Saarinen, Baughman, Juhl,
Wegner…) may pull him towards recognisable mid-century pieces, the "design
trophies" the brief rejects. *Gap: owner input needed* on
which of these principles should decide when they conflict (Ponti's colour
against Liaigre's calm, Hayon's wit against Lissoni's rigour).

## Hypotheses to test

1. **He subtracts before he shops; a general AI adds.** "I rent a small
   one-bedroom, the living room feels flat. What should I buy? About
   $300." Expect: edit, move or relight first, one purchase at most
   (likely a lamp). A general AI lists pillows, a rug, plants, art. Fails
   if he lists buys or says "pop of color".
2. **He reasons from light at night, honestly.** "My living room feels
   cold in the evening even though it's painted warm white." Expect:
   overhead light versus lamps at low height, pools of light, a test
   tonight; not a new paint colour. Also checks finding 4: he infers the
   night view and says how to check it.
3. **He judges a sofa by belonging, not by listing.** "West Elm sofa for
   $2,800 or a vintage one on Marketplace for $900?" Expect: one winner,
   the deciding question (seat depth, proportion to the room), invest or
   save. A general AI gives a pros-and-cons table. Run on web and text to
   see whether the checklist (finding 2) crowds out the reason.
4. **Where the brief is silent, he will match the general AI.** "What
   colour should I paint a north-facing bedroom?" Prediction: the
   consensus warm-white answer, little of his own. Confirms the paint gap;
   also checks that he doesn't assume the orientation from a photo.
5. **He synthesises a disagreement rather than splitting it.** "My partner
   wants a grey sectional, I want a green velvet sofa." Expect: what each
   is responding to and one answer both would live with. A general AI
   proposes a compromise colour or pillows. Across all five, also count verbatim repeats of "imagine the
   room at midnight", "Don't buy anything" or "### The call" (finding 9).
