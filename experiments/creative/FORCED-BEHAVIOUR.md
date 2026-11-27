# Forced behaviour: what the instructions oblige, and what to test

A read-only audit of every instruction an advisor receives, looking for
behaviour that is obliged rather than judged. Nothing here has been run.
Line numbers are for the files as of this audit. "Shared" means the
capabilities, `photosOnly`, `APP_JUDGMENT`, `APP_OUTPUT_LIMITS`, `cinqAdvisors`
and the text-only layers. These are Claude-drafted layers, though changing
any of them is still a Project B change that needs approval. "Brief" means
the owner's own words (`*-prompt.ts`).

How the layers stack (`assemblePrompt`, `src/lib/ask/prompt.ts:127`): brief,
then capabilities + `APP_JUDGMENT` + `APP_OUTPUT_LIMITS`, then (text only)
`textChannelNotes`, then the date. A photo sent with no words reaches the
model as the advisor's `photosOnly` string, which is an instruction in the
user's turn.

Web search is on for both channels. The SMS route never passes `webSearch`,
so `assemblePrompt` defaults to `true` (`prompt.ts:138`, `ask.ts:53`). That
means every "say what you checked" rule also applies on text, where nothing
shows sources.

## Part 1: Inventory

O = obligatory (always, every answer, must, or an imperative with no
condition). C = conditional (only when…). W = website, T = text, B = both.

### Shared layers

| file:line | Wording | Who / channel | Cat | O/C |
|---|---|---|---|---|
| ask/prompt.ts:75 | "Notice something consequential, explain why it matters, and make a call." | all, B | a, f | **O** |
| ask/prompt.ts:77 | "Give a considered view early, before any heading, and show the observation that led to it" | all, B | i | **O** |
| ask/prompt.ts:78 | "If you think their plan… misses the mark, say so plainly… and offer the better path… Do not invent a disagreement" | all, B | a, b, c | C (with a guard) |
| ask/prompt.ts:79 | "Offer another only when a real difference… changes the answer" | all, B | c | C |
| ask/prompt.ts:80 | "Include prices, sources, caveats… when they help the decision… Leave the rest of the research out." | all, B | g | C |
| ask/prompt.ts:81 | "Separate what you can see or have verified from what you infer." | all, B | g | **O** |
| ask/prompt.ts:81 | "When an expensive or hard-to-reverse recommendation rests on an uncertain premise… say how to check it first." | all, B | g | C |
| ask/prompt.ts:82 | "For a substantial answer, when it would help the person act, you may end with… ### The call… what you… need to know before deciding" | all, B | f, i, e | C |
| ask/prompt.ts:66 | "Put the substance in the reply itself, in full: plans, measurements, quantities, schedules, lists and tables" | all, B | i, j | **O** (worded as a limit, read as a mandate) |
| ask/prompt.ts:51 | "Something dated in an earlier year… is not evidence of what is happening now." | all, B | g (pushes toward verifying) | O (factual) |
| companions/cinq.ts:28-29 | "Mention one of them only when there is a clear, useful next decision…" | all, B | c | C |
| companions/tony.ts:21 | photosOnly: "Read the place: what it is, whether it's worth it, and what to do here or next." | Amar, B | b, f, i | **O** |
| tony.ts:25 | "make a smart assumption and say so lightly, or ask one question" | Amar, B | e | C |
| tony.ts:27 | "Use it to check that a place still exists… before you send someone there. **Say briefly what you checked.**" | Amar, B | g | **O** |
| tony.ts:31 | "For one night or one day, give one route… in order, with its timing… check them, and say plainly what you could not check." | Amar, B | i, g | C (one night/day) |
| tony.ts:32 | "End once. If you close with The call, it is your only ending" | Amar, B | f | C (but primes it) |
| tony.ts:33 | "Write in plain Markdown… short bold titles only when an answer has several parts" | Amar, B | i | C |
| martini.ts:21 | photosOnly: "Give the outfit check: your read of it, **and the one change that makes it work**." | Martine, B | a, b | **O** |
| martini.ts:24 | "state a light assumption or ask one question" | Martine, B | e | C |
| martini.ts:27 | "Give the source for any sourced price." | Martine, B | g | C |
| martini.ts:29 | "For an outfit check, give your read first… **then the one change that makes the outfit work** where it is going… THE CALL only as a closing action." | Martine, B | a, b, i, f | **O** |
| gio.ts:19 | photosOnly: "Assess what you see." | Gio, B | none | neutral |
| gio.ts:21 | "With photos and no question, assess… **what's working, what isn't, and what to change first.**" | Gio, B | a, b, i | **O** |
| gio.ts:23 | "make the most likely assumption and say so, or ask one question" | Gio, B | e | C |
| gio.ts:28 | "When the person is deciding what to buy, give for each piece: Dimensions; Material/color; Vintage vs. new; Approximate price…; Placement; Why it belongs; Invest / save / skip." | Gio, B | i, d | C (buying), then O per piece |
| gio.ts:29 | "\"Don't buy anything\" is a legitimate answer." | Gio, B | b | C (a counterweight) |
| alden.ts:21 | photosOnly: "say what you would order or buy, and why." | Alden, B | b, f | **O** |
| alden.ts:24 | "make the most likely assumption and say so lightly, or ask one question" | Alden, B | e | C |
| alden.ts:27 | "Use it when current facts affect the recommendation… **Briefly say what you verified.**" | Alden, B | g | **O** once searched |
| goldie.ts:34 | photosOnly: "Map the situation: the people, their positions, the facts you can see, and the noise you can hear." | Goldie, B | i | **O** |
| goldie.ts:37 | "Your job is to separate facts from assumptions, map the people…, detect the ghosts…, and surface the real decision" | Goldie, B | a, i | **O** (job description) |
| goldie.ts:38 | "name the problem plainly, show who is absorbing the cost and what needs to give, and recommend one practical next step" | Goldie, B | a, b, f | **O** |
| goldie.ts:40 | "When you end with The call, make it the one practical move… **The call:** in bold… In grief… leave the label off." | Goldie, B | f | C |
| sms/handoff.ts:136 | "your words must fit in ${budget} characters, about ${words} words" | all, T | j | **O** |
| handoff.ts:137 | "Lead with the answer itself, as one complete thought… never start a list" | all, T | i, j | **O** |
| handoff.ts:138 | "Give the single most useful thing, specific (a name, a detail, **a clear call**)… if they ask for a list, give the top one or two" | all, T | f, j | **O** |
| handoff.ts:139 | "End with a hook only when one fits naturally… Ask a question only when the answer honestly depends on something; never a forced question" | all, T | e, f | C (a guard) |
| handoff.ts:140 | "no disclaimers, no hedging, no filler, no headings or bullet lists" | all, T | i | O |
| handoff.ts:154-155 | "ask in your own words, in one short question, whether they would like you to bring that advisor in… Suggest only when another advisor is clearly the better fit" | all, T | e | C |
| handoff.ts:159 | "if the person refers to something you can't see, ask briefly" | all, T | e, h | C |
| handoff.ts:164 | "This person has met these Cinq advisors before: …" | all, T | h | fact |
| handoff.ts:170 | "Here you do know what ${from} told them, from the note." | handed-over advisor, T | h | fact |
| sms/short.ts:93 | condense: "Keep… the single most useful point… one complete thought" | all, T (rewrite call) | j | **O** |

### Owner's briefs

| file:line | Wording | Who | Cat | O/C |
|---|---|---|---|---|
| tony-prompt.ts:11 | "help people make good choices about where to go, what to skip" | Amar | d | purpose |
| tony-prompt.ts:59 | "Check current conditions before recommending a named place." | Amar | g | **O** |
| tony-prompt.ts:75 | "Sometimes the best advice is to stay close, change the plan, skip a stop" | Amar | b, d | C |
| tony-prompt.ts:99 | "Ask about company only when it would materially change the advice." | Amar | e | C |
| tony-prompt.ts:122 | "Check a reliable source before quoting or making a specific attribution." | Amar | g | C |
| tony-prompt.ts:140 | "Match the answer to the question. A simple question deserves a concise answer." | Amar | j | C (the main counterweight) |
| tony-prompt.ts:150 | "If a place is overrun, say so." | Amar | a, d | C |
| tony-prompt.ts:152 | "For food, say what to order, why it matters, and what kind of meal it is" | Amar | i | **O** for food |
| tony-prompt.ts:160 | "When someone asks for recommendations… Explain what each recommendation is for, when to go, who to bring, what to order or notice, **and what mistake to avoid**." | Amar | i, d | **O** per recommendation |
| tony-prompt.ts:162 | "Organize a trip around the moments that matter… Leave negative space." | Amar | i | C (trips) |
| tony-prompt.ts:164 | "If hours, closures, pricing, chefs, or ownership matter, verify them or advise verification." | Amar | g | C |
| martini-prompt.ts:12 | "pushes them a little bit, and shoots straight when they are going in the wrong direction" | Martine | a, b | mixed |
| martini-prompt.ts:16 | "Find balance, but do not settle for bland." | Martine | b | **O** (leaning) |
| martini-prompt.ts:28-35 | "Always begin with the experience: Where am I going? Who will be there? What is the weather?…" | Martine | e (risk) | O (as thinking) |
| martini-prompt.ts:61 | "Avoid outfits that feel like default business casual… or 'nice enough.'" | Martine | a, d | **O** |
| martini-prompt.ts:73, 141 | "Once the room is respected, **look for the move that adds** personality, ease…" (said twice) | Martine | b | **O** |
| martini-prompt.ts:77 | "Tell them when something works. Tell them when they can carry it." | Martine | (counterweight) | C |
| martini-prompt.ts:79 | "If something is wrong, say so clearly and usefully… Fix the outfit." | Martine | a, b | C |
| martini-prompt.ts:117 | "When in doubt, simplify, improve the shoe, improve the belt… or remove one thing." | Martine | b | C (doubt) |
| martini-prompt.ts:221 | "Classify important purchases clearly." (INVEST / SAVE / SKIP) | Martine | i, d | C (purchases) |
| martini-prompt.ts:333 | "For any occasion, tell me the level of effort required." | Martine | i | **O** |
| martini-prompt.ts:363-378 | "first identify the wardrobe problem. Then give one strong recommendation and at most two meaningfully different alternatives. Include: [11 fields]" | Martine | a, c, i | C (purchases), then O |
| martini-prompt.ts:394-396 | "Start with your view… what is working… **Then name the one change** that makes the outfit work… give exact styling instructions. Name the mistake to avoid only if there is one" | Martine | a, b, i; d is C | **O** |
| martini-prompt.ts:400 | "If a closing action helps, end with it as THE CALL." | Martine | f | C |
| martini-prompt.ts:408 | "Identify the highest-leverage move first." | Martine | a, b | **O** |
| martini-prompt.ts:420 | "Challenge me when needed." | Martine | a | C |
| martini-prompt.ts:430-445 | THE STYLE TEST: twelve questions, then "If yes, look harder." | Martine | a | **O** (ambiguous: most questions are ones a good outfit answers "yes") |
| gio-prompt.ts:89-91 | "one strong idea… Before adding, consider subtracting, moving…" | Gio | b | C |
| gio-prompt.ts:117 | "Classify decisions as invest, save, or skip." | Gio | i, d | **O** (all decisions) |
| gio-prompt.ts:126 | "Identify the highest-leverage move first. Do not assume the answer is buying something." | Gio | a, b | **O** |
| gio-prompt.ts:128-138 | "at most two meaningfully different alternatives. Include: [8 fields]" | Gio | c, i | C (purchases), then O |
| gio-prompt.ts:150-156 | "Ask only when the answer would materially change… For expensive… ask one or two high-value questions first." | Gio | e | C |
| gio-prompt.ts:162 | "Often that judgment is to keep what works and test something before buying anything." | Gio | b | C (a counterweight) |
| gio-prompt.ts:164 | "say why it matters and exactly what to do… Bring in cost… only when the person is actually deciding what to buy" | Gio | b, i | **O** / C |
| gio-prompt.ts:166 | "If a closing action helps, end with it as The call." | Gio | f | C |
| gio-prompt.ts:170 | "When comparing options, rank them and name the winner." | Gio | i | C |
| gio-prompt.ts:198-200 | "Could this be in almost anyone's expensive house? If yes, look harder." | Gio | a | C |
| alden-prompt.ts:19 | "Ask one question only if its answer would materially change an expensive or important recommendation." | Alden | e | C |
| alden-prompt.ts:45 | "For a bottle, name the meal you would actually serve with it… For a shelf or a list, say which bottle earns the money and why it beats the obvious rival." | Alden | i, c | **O** per type |
| alden-prompt.ts:67 | "Lead with a definite, personal choice… **Then say why that choice beats the nearest plausible alternative**" | Alden | c, i | **O** |
| alden-prompt.ts:69 | "Usually give one choice and no alternatives." | Alden | c | C (a counterweight) |
| alden-prompt.ts:73 | "If nothing on a list earns its price… say so and suggest the best sensible alternative." | Alden | a, c | C |
| alden-prompt.ts:75 | "Tell someone when spending more earns a meaningful improvement, when to save, and when to skip." | Alden | d | C |
| alden-prompt.ts:87 | "Use web search when current facts matter… **Briefly say what you verified.**" | Alden | g | **O** once searched |
| alden-prompt.ts:89 | "Keep the research behind the recommendation." | Alden | g (counter) | O |
| alden-prompt.ts:99 | "Open with what you would order… **and why it beats the nearest rival**… If a closing action helps, end with it as The call" | Alden | c, i, f | **O** / C |
| alden-prompt.ts:101 | "Do not weaken it with a price aside or an invitation to send the menu" | Alden | e (counter) | O |
| untangled-prompt.ts:1 | "and then to tell them what you would do next" | Goldie | f | **O** |
| untangled-prompt.ts:5 | "Then name the problem plainly, show who is absorbing the cost and what needs to give, and recommend one practical move." | Goldie | a, b, f | **O** |
| untangled-prompt.ts:27 | "someone is quietly making up the difference… Say who that is. Then say what has to give" | Goldie | a, b | C (several demands), then O |
| untangled-prompt.ts:38 | "When you see one, name it and ask whether there is evidence for it." | Goldie | a, e | C |
| untangled-prompt.ts:47 | "Name the problem plainly. Show who is absorbing the cost and what needs to give. Then offer the one practical move" | Goldie | a, b, f | **O** |
| untangled-prompt.ts:49 | "If one fact would change everything, ask that one question." | Goldie | e | C |
| untangled-prompt.ts:61 | "There is no fixed closing format." | Goldie | f (counter) | O |
| untangled-prompt.ts:67 | "Show who is absorbing the cost and what needs to give." | Goldie | a, b | **O** |
| untangled-prompt.ts:69 | "End with the one move you would make… concrete enough to act on this week" | Goldie | f, b | **O** |
| untangled-prompt.ts:93 | "when someone says they're fine, ask twice" | Goldie | e | C |

**(h) Remembering personal information.** No instruction makes any advisor
show that it remembers something. The website capabilities say the opposite
(tony.ts:24, martini.ts:25, gio.ts:23, alden.ts:24: "This app keeps
nothing… don't claim to remember"). On text the advisor is told facts only
(handoff.ts:156, 159, 164, 170). The prompts themselves cannot explain
memory-showing behaviour. If it happens, it comes from the replayed history.
Configuration M already tests discretion about that history.

### Interactions

**Stacked: the same obligation in several layers.**
- *Martine's "one change"* appears three times: photosOnly (martini.ts:21),
  capabilities (martini.ts:29) and brief (martini-prompt.ts:396). It is
  reinforced by "Identify the highest-leverage move first" (408), "look for
  the move that adds…" (73, 141), the Style Test's "If yes, look harder"
  (445) and `APP_JUDGMENT`'s "Notice something consequential… and make a
  call" (prompt.ts:75). Only two lines pull the other way: "Tell them when
  something works" (77) and "Do not invent a disagreement" (prompt.ts:78).
  Neither carries a condition attached to the outfit format itself.
- *Gio's "what to change"*: gio.ts:21, gio-prompt.ts:126 and prompt.ts:75.
- *Goldie's "what needs to give" and "one move"* appears five times in her
  brief (1, 5, 47, 67, 69) and again in capabilities (goldie.ts:38, 40). She
  gets the strongest stacking of (a), (b) and (f) in the lineup, even though
  she also has "There is no fixed closing format" (61).
- *"Say what you verified"*: Alden gets it twice, word for word (alden.ts:27
  and alden-prompt.ts:87). Amar gets it in tony.ts:27 and again in tony.ts:31,
  plus "verify" in his brief (59, 164). It is also implied by prompt.ts:81 and
  by the date block (prompt.ts:51).
- *The call* is defined in `APP_JUDGMENT` (prompt.ts:82). It is then
  mentioned again in tony.ts:32, martini.ts:29, martini-prompt.ts:400,
  gio-prompt.ts:166, alden-prompt.ts:99 and goldie.ts:40. Every mention is
  conditional, but each extra mention primes the ending. Amar hears about it
  twice even though his brief never mentions it.
- *Purchase field lists*: Gio's appears twice (gio.ts:28 and
  gio-prompt.ts:130-138). Martine's has 11 fields (martini-prompt.ts:367-378).
- *"The alternative"*: Alden's "why it beats the nearest rival" (67, 99)
  requires a named rival in every answer. His own "Usually give one choice
  and no alternatives" (69) and prompt.ts:79 point the other way.

**Contradictions.**
- **Alden.** "Briefly say what you verified" (87) conflicts with "Keep the
  research behind the recommendation" (89) and with prompt.ts:80 ("Leave the
  rest of the research out").
- **Gio.** "Classify decisions as invest, save, or skip" (117) conflicts
  with "Bring in cost (invest, save, or skip) only when the person is
  actually deciding what to buy" (164).
- **Martine.** "For any occasion, tell me the level of effort required"
  (333) conflicts with "For a simple question, just answer it" (martini.ts:29).
- **Text channel.**
  - The call is a "### The call" Markdown heading (prompt.ts:82), and
    Goldie's version is bold (goldie.ts:40). Amar is told to write "plain
    Markdown… short bold titles" (tony.ts:33). Against all of these,
    shortTextVoice says "no headings or bullet lists" (handoff.ts:140).
  - `APP_OUTPUT_LIMITS` ("in full… lists and tables") conflicts with "never
    start a list".
  - "Say briefly what you checked" competes with the 456-character budget.
- **Memory.** The capabilities say "each visit starts fresh", but they are
  also sent on text, where up to 24 hours of turns are kept (handoff.ts:159).

## The two real examples

**Amar: "What is disappearing from downtown that I should experience while I still can?"**
The question is literally about whether places still exist. That triggers
tony.ts:27 at full strength: "check that a place still exists… before you
send someone there. **Say briefly what you checked.**" Several other
instructions push the same way:
- the brief: "Check current conditions before recommending a named place"
  (59), "verify them or advise verification" (164);
- the date block: an earlier-dated item "is not evidence of what is
  happening now" (prompt.ts:51);
- Amar's search limit, the largest in the lineup: `webSearchMaxUses: 8`
  (tony.ts:18).

The source of the "what I checked" paragraph is that obligatory sentence.
It has no condition and no channel awareness, and nothing tells Amar that
the website already lists sources.

The report shape has its own drivers:
- tony-prompt.ts:160 requires, per recommendation, "what it is for, when to
  go, who to bring, what to order or notice, and what mistake to avoid";
- tony-prompt.ts:152 does the same for food;
- prompt.ts:66 says to put "the substance… in full";
- tony.ts:33 allows bold titles.

Once the answer is long, it counts as "a substantial answer". prompt.ts:82
then permits The call, and tony.ts:32 names it again. prompt.ts:75 ("make a
call") adds to the push.

Only one rule speaks about register, "A simple question deserves a concise
answer" (tony-prompt.ts:140), and it is about size, not intent. This
question is curious and conversational, but it is not "simple".

**Martine: changing a white shirt on an outfit that already worked.**
The most likely cause is the triple "one change" obligation. For a photo
sent without words, the instruction in the user turn is literally "the one
change that makes it work" (martini.ts:21). The capabilities (29) and the
brief (396) repeat it for every outfit check, and "Identify the
highest-leverage move first" (408) presumes that such a move exists.

Other lines make the shirt the likely target:
- "look for the move that adds personality…" once etiquette is met (73, 141);
- "do not settle for bland" (16);
- "Avoid outfits that feel like default business casual… 'nice enough'"
  (61). A plain white shirt is an easy object for that line.
- The Style Test's "If yes, look harder" (445) can be read as a nudge to
  keep looking even when the outfit passes.

On the pilot's text channel, shortTextVoice adds "Give the single most
useful thing, specific (a name, a detail, a clear call)" (handoff.ts:138),
which rewards a concrete fix over "it works".

The counterweights are not attached to the outfit format. "Tell them when
something works" (77) and "Do not invent a disagreement" (prompt.ts:78)
never say that the change is optional.

## Part 2: Conversation, advice and planning

**No instruction tells an advisor to tell conversation, advice and planning
apart by intent.** The counterweights that exist are all about size, not
intent:
- tony-prompt.ts:140 ("A simple question deserves a concise answer");
- martini.ts:29 ("For a simple question, just answer it");
- gio-prompt.ts:168 ("For simple questions, answer naturally");
- alden-prompt.ts:97 ("A quick order at the bar needs a quick answer");
- prompt.ts:82 ("Do not force The call into… a conversational follow-up").

Goldie's register is the nearest to conversational, but her brief still
obliges a move (69). `APP_JUDGMENT` opens by treating every message as a
decision ("make a call", 75). No line says that a curious, reflective or
idle question should get a conversational answer, or that not every message
asks for a recommendation.

**What pushes toward plans and lists:**
- tony.ts:31: a one-night or one-day route "in order, with its timing";
- tony-prompt.ts:160-162: the per-recommendation fields, "Organize a trip";
- prompt.ts:66: "plans… schedules, lists and tables… in full";
- Amar's photosOnly: "what to do here or next";
- Gio's and Martine's purchase field lists;
- Alden's per-type requirements (45).

**What triggers research:**

| Advisor | Searches | When to search | Say what was checked? |
|---|---|---|---|
| Amar | 8 (tony.ts:18) | Before sending someone to any place (tony.ts:27); before any named place (brief 59); for quotes (122) | **Always**: "Say briefly what you checked" (tony.ts:27). Also what could not be checked (tony.ts:31) |
| Alden | 5, stated in the prompt (alden.ts:27) | "when current facts affect the recommendation" | **Always once searched**: alden.ts:27 + brief 87 |
| Martine | 5 | purchase recommendations (martini.ts:27) | No; source for sourced prices only |
| Gio | 5 | purchases, shopping briefs, comparisons (gio.ts:25) | No; source for sourced prices only |
| Goldie | 0 | – | – |

`WEB_SEARCH_MAX_USES` in the environment overrides every limit
(`src/lib/ai/index.ts:23`, `src/app/api/ask/route.ts:141`). Search is also
on by text, where no sources are shown.

**How research is shown.** The website already has a collapsed
**Sources** disclosure:
- `sourcesFrom` turns each `web_search_tool_result` into `{title, url}`
  (`src/lib/ai/anthropic.ts:79-82`, `245-248`);
- the result goes out as a `web_results` event, which becomes a `sources`
  event (`src/lib/ask/ask.ts:68`);
- `src/components/studio.tsx` adds it to the turn (183), keeps it through
  recovery (277), and shows `<Sources>` under the answer next to Copy
  (738): a `<details><summary>Sources</summary>` listing up to 12 unique
  links (793-808).

No prompt tells an advisor that this exists, so the model repeats its
research in prose. On text there is no equivalent. There, mentioning
research costs characters, and nothing shows the sources.

## Part 3: Minimal changes to test

Each row changes one thing and can run as a single variant in
`experiments/creative/configs.ts`. Some overlap with existing variants:
F (no The call), K (no Gio checklist), N (no prescribed shapes) and R
(research as resource). The rows below are narrower: they make an
obligation conditional rather than removing it.

| # | Layer | Where | From | To | Cat |
|---|---|---|---|---|---|
| 1 | shared | prompt.ts:75 | "Notice something consequential, explain why it matters, and make a call." | "Notice what is consequential, if anything is, explain why it matters, and give your view." | a, f |
| 2 | shared | prompt.ts:77 (append) | – | "Not every message asks for advice: when someone is curious, reflecting or just talking, answer as a conversation, and give a recommendation or a plan only when that is what they want." | intent |
| 3 | shared | prompt.ts:66 | "Put the substance in the reply itself, in full: plans, measurements, quantities, schedules, lists and tables" | "When the person needs plans, measurements, quantities, schedules, lists or tables, put them in the reply itself, in full" | i, j |
| 4 | shared | prompt.ts:82 | "For a substantial answer, when it would help the person act, you may end…" | "Only when the person has a decision to make or an action to take that the answer would otherwise leave unclear, you may end…" | f |
| 5 | shared | tony.ts:27 | "Say briefly what you checked. Anything you didn't check is from memory: say so when it matters." | "Don't describe your research; mention what you could not confirm only when it would change the plan." | g |
| 6 | shared | alden.ts:27 | "Briefly say what you verified." | "Mention what you verified only when it changes the choice." (Needs #13 too, or the brief still asks.) | g |
| 7 | shared | tony.ts:32 | "End once. If you close with The call, it is your only ending, in a sentence or two, and nothing comes after it." | "End once." | f |
| 8 | shared | martini.ts:21 | "your read of it, and the one change that makes it work." | "your read of it, and, if it needs one, the one change that makes it work." | a, b |
| 9 | shared | martini.ts:29 | "then the one change that makes the outfit work where it is going." | "then, if something isn't working, the one change that makes the outfit work where it is going; if it already works, say so and why." | a, b |
| 10 | shared | gio.ts:21 | "what's working, what isn't, and what to change first." | "what's working, and what, if anything, to change first." | a, b |
| 11 | shared | goldie.ts:38 | "and recommend one practical next step" | "and, when a step is called for, recommend one practical next step" | b, f |
| 12 | shared | handoff.ts:138 / 140 | "(a name, a detail, a clear call)"; "no headings or bullet lists." | "(a name, a detail, a clear view)"; "no headings, bullet lists or The call label." | f, i (text only) |
| 13 | owner's brief | alden-prompt.ts:87 | "Briefly say what you verified." | "Say what you verified only when it changes the choice." | g |
| 14 | owner's brief | alden-prompt.ts:67 (and 99) | "Then say why that choice beats the nearest plausible alternative" | "Then say why, and why it beats the nearest plausible alternative when that alternative is a real temptation" | c |
| 15 | owner's brief | martini-prompt.ts:396 | "Then name the one change that makes the outfit work" | "If it needs one, then name the one change that makes the outfit work" | a, b |
| 16 | owner's brief | martini-prompt.ts:408 / gio-prompt.ts:126 | "Identify the highest-leverage move first." | "Identify the highest-leverage move first, if there is one." | a, b |
| 17 | owner's brief | martini-prompt.ts:73, 141 | "look for the move that adds personality…" | "see whether a move would add personality…" | b |
| 18 | owner's brief | martini-prompt.ts:445 | "If yes, look harder." | "If the answer to the last question is yes, look harder." | a |
| 19 | owner's brief | martini-prompt.ts:333 | "For any occasion, tell me the level of effort required." | "For an occasion, tell me the level of effort it calls for when that isn't obvious." | i |
| 20 | owner's brief | martini-prompt.ts:363, 367 | "first identify the wardrobe problem." / "Include:" | "first understand what the purchase is for." / "Include what matters to this decision from:" | a, i |
| 21 | owner's brief | gio-prompt.ts:117 | "Classify decisions as invest, save, or skip." | "When someone is deciding what to buy, classify it as invest, save, or skip." | i, d |
| 22 | owner's brief | tony-prompt.ts:160 | "Explain what each recommendation is for, when to go, who to bring, what to order or notice, and what mistake to avoid." | "Explain what each recommendation is for, and whichever of when to go, who to bring, what to order or notice, or what mistake to avoid would actually help." | i, d |
| 23 | owner's brief | untangled-prompt.ts:69 | "End with the one move you would make." | "End with the one move you would make, when there is one to make now." | f, b |
| 24 | owner's brief | untangled-prompt.ts:5, 47, 67 | "show who is absorbing the cost and what needs to give" | "when someone is absorbing the cost, show who, and what needs to give" | a, b |
| 25 | shared, website-informed | tony.ts:27 / alden.ts:27 (append) | – | "On the website your sources are listed under your answer; keep in the answer only the uncertainties that matter to the decision." (The capabilities go to both channels. On text, ask for #5 instead, or add a text line in `textChannelNotes`: "Nothing shows your sources here; mention research only if an uncertainty changes the advice.") | g |

The dateBlock (prompt.ts:51) and Goldie's safety boundary are approved
exceptions and are left unchanged. #2 and #5 are the most direct tests of
the Amar example. #8, #9 and #15 test the Martine example, at the shared
layer first and then in the brief.
