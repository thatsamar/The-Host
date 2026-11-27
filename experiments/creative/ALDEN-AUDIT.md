# Alden: what informs his judgment, and how it reaches the model

An audit of his brief (production, `main`), his capabilities and the shared
instructions around them. These are findings from reading the instructions,
not results: nothing has been run yet.

## What he receives

On text, about 24,000 characters of instructions. His brief is 14,000 of
them, and of the brief:

| Kind | Share | Examples |
|---|---|---|
| Procedure, format and guardrails | 44% | lead with a choice; one choice, no alternatives; photos; search; voice; safety |
| Convictions (actual views) | 31% | classics over signature cocktails; Chablis's restraint; warm sake; mezcal's character against an expensive story; Nikka From the Barrel; the Monkey 47 martini; drinks that belong to their place |
| Knowledge scope ("understand X, Y, Z") | 12% | wine at the level of producers and vineyards; sake; beer; spirits |
| Identity | 7% | "the person beside them at a great bar" |
| Influences | 7% | Aldo Sohm, The Dead Rabbit, Dante |

Specific, testable convictions are a small part even of that 31%: about a
dozen, roughly 2,000 characters, or 9% of everything he reads.

## Findings

1. **In wine, his main subject, he has almost no point of view of his own.**
   - The brief tells him *how* to judge a bottle (site, producer, value,
     the occasion) but names no producer, region, style or tradition he
     loves, doubts or would introduce someone to.
   - His only wine views are Chablis over a rich California Chardonnay and
     a pale dry rosé on a hot afternoon. Both are held "without making them
     laws".
   - Asked about wine, he has nothing to reason from except the model's own
     consensus, which is exactly what a general-purpose AI says. This is
     the leading explanation for the feedback, to be tested.
2. **Where he does have convictions, he is distinctive, and that's where
   the strongest exchange came from.**
   - Cocktails and spirits have real views: the classics done right, the
     mezcal paragraph, the martini.
   - The $28 rye over the $80 whisky follows from "classics done right"
     and from the value principle.
3. **Nearly every conviction is paired with its opposite.**
   - "A great California Chardonnay… can still be exactly right."
   - "An excellent espadín may still win."
   - "Tradition is a tool, not a religion."
   - This is your wording, and it guards against doctrine, so I'm not
     proposing to change it. But a view that is always balanced rarely
     decides anything. It's worth testing, only with your approval.
4. **His influences shape his manner, not his choices.**
   - The three bullets are about hospitality and tone: knowledge "worn
     lightly", "storytelling", "aperitivo culture".
   - None says what Aldo Sohm, The Dead Rabbit or Dante would choose, value
     or reject.
   - The brief allows him to draw on their documented views "after checking
     a reliable source", which in practice needs a search he has no reason
     to make. As written, they are background.
5. **Research is for verification, not exploration.**
   - He is told to search "when current facts matter" and to "say briefly
     what you verified".
   - Nothing says what to look for or which sources to trust. A search
     finds what ranks: scores, retailers, "best of" lists. That is the
     general-purpose AI's material too, so research may be pulling him
     towards the same answer.
6. **He has no eye of his own for a photo.** He is told to "inspect it
   closely" and not to invent. Nothing says what his eye goes to first: on
   a list, the producers before the regions, the price ladder, what is
   ready to drink now, the bottle nobody orders.
7. **The text layer narrows him further.**
   - One text of 456 characters, a shared voice sent last, and a rewrite
     step that never sees his brief.
   - These leave room for the pick, and often cut the reason, which is
     where his distinctiveness lives.
   - Configurations B, C and L already measure this.

## His perspective, from the materials, and the gaps

Only what your materials say. Where they say nothing, the gap is marked;
I haven't invented a view to fill it.

| | From the brief | Gap: your input needed |
|---|---|---|
| What he particularly appreciates | Classics done right; drinks that belong to their place; real craft; a mezcal of character; Nikka From the Barrel; Chablis's restraint and tension; a cold lager at the right moment; a gently warmed savory sake; nonalcoholic drinks made with the same care | Wine producers, regions, styles and traditions he loves, and why. The same for Champagne, sake, beer, rye and bourbon, and Japanese whisky beyond one bottle |
| What he considers overrated | Signature cocktails that sound better than they taste; prestige, rarity and famous regions standing in for judgment; "wild agave" or a claimed age as proof; polishing ratio as quality; the Vesper as a flourish; florid tasting notes | Specific wines, styles, categories or fashions he thinks overrated, and why |
| What he notices that others miss | Why two bottles from one appellation differ; a vintage ready now; an overlooked producer on a list; serving details | What his eye goes to first on a wine list, a shelf or a back bar |
| What informs his judgment | The person, the meal, the moment, the price; three influences, as principles of hospitality | What, concretely, each influence would choose, value or reject; your own principles as a drinker and host |
| What people misunderstand about his field | That price and prestige mean quality; that sake must be cold; that tradition is a rule | More, in your words |
| Where he differs from conventional wisdom | Warm sake; the cold lager; a tepextate over the safe espadín when it earns it; a modest bottle over an impressive one | Wine especially: where you disagree with critics, scores, sommeliers or collectors |
| What he would be excited to introduce | A particular tepextate; the drink that belongs to the place | Producers, regions, traditions and ways of drinking you'd love someone to discover |
| What he finds genuinely exceptional, and why | Nothing named | Bottles, producers or experiences you consider truly exceptional, worth their price, and what makes them so |

**Still needed:** the actual exchange that prompted the feedback, with
photos, prices and the date.

## The smallest experiments

Each changes one thing. They are already in the harness (README, "Alden:
the first case study").

- **Diagnosis, with no founder material:** G0, G, A, D, O, P and PR, on
  seven real decisions plus the rye. The neutral restatement shows whether
  the recommendations differ or only the writing does.
  - If **O, D and A pick what G0 picks**, the gap is knowledge and
    conviction (finding 1).
  - If **A differs from G0 without search but P converges** with it, the
    gap is research (finding 5).
  - If **PR moves away from G0 towards better choices**, research led by
    his point of view helps on its own.
  - If **B is better than A**, the text layer costs him (finding 7).
- **With your material:** DE, OE, AE and RF. Does your point of view change
  which wines he considers, and is the resulting advice better?

## The intellectual foundation: proposed architecture

As simple as the evidence allows, and nothing added to production until it
proves itself.

1. **A point of view, not a catalogue.** About 600 to 900 words per advisor,
   written or approved by you: what he appreciates and why, what he finds
   overrated, what he notices, where he disagrees, what he'd introduce,
   what he finds exceptional. In production it would *replace* about as
   many words of generic knowledge scope ("understand rice, water,
   fermentation…"), which the model knows anyway, so the prompt doesn't
   grow. In the experiment it's tested first as an addition (DE).
2. **A private library, only if the point of view isn't enough.** It would
   hold short notes on producers, regions, traditions, disagreements and
   authentic exchanges. For each question, one cheap call would pick at
   most two or three relevant notes. It would need no search index at
   this scale. Not built.
3. **Research led by his point of view (PR):** form his own shortlist first,
   then search producers, importers and specialists rather than scores, and
   judge what he finds by his standards.

**Privacy:** the material stays outside the repository (`FOUNDATION_DIR`),
because the repository is public. A production version needs private
storage.

## Cost proposed, before running

This is separate from the approved $30 pilot, so it needs your approval.

- **Stage 1 (diagnosis):** about 112 answer calls, plus cheap restatements.
  About $13 to $15, capped at $15.
- **Stage 2 (with your material):** about 64 answer calls. About $8,
  capped at $10.

The estimates use the list prices of the default model, at around $0.08
per answer without search and $0.20 with it. The cap stops a run
regardless.
