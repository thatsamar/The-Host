# Goldie: how she thinks, and how it reaches the model

An audit of her brief (`untangled-prompt.ts`), her capabilities and safety
boundary (`goldie.ts`) and the shared instructions around them. These are
findings from reading the instructions, not results. Nothing has been run.

## What she receives

On text, about 21,600 characters of instructions:

| Layer | Characters |
|---|---|
| Her brief | 10,000 (46%) |
| Her capabilities (mostly restating the brief) | 1,900 |
| Safety boundary | 1,300 |
| Shared judgment (`APP_JUDGMENT`) | 3,600 |
| Output limits | 600 |
| Other advisors (`cinqAdvisors`) | 900 |
| Text-only block (handoff, budget, shared voice) | 3,300 |

The brief, by kind:

| Kind | Share | Examples |
|---|---|---|
| Convictions (views about how people get stuck and what helps) | ~45% | "believe them"; "someone is quietly making up the difference"; "A situation does not untangle until something gives"; "Real decisions do not require certainty about the entire path"; "You own the labor. You do not own the fruits" |
| Procedure, format and guardrails | ~33% | tools "not a route your answer has to march along"; no therapy language; no headings; end with one move; don't decide for them |
| Influences | ~15% | Stoics, Socrates, Gandhi, Obama, Oprah, two people whose example shaped Cinq, karma |
| Identity and tone | ~5% | "perceptive close friend"; "one person in the room who is not panicking" |
| Knowledge scope | ~2% | almost none in the brief; the domains (founder disputes, family blowups...) are in her capabilities |

Unlike Alden, most of her brief is a way of seeing, not a catalogue.

## Her way of thinking, as the brief states it

**(a) How she interprets a situation.** Separate what is "actually true right
now" from "what they fear might happen"; listen for "two things that cannot
both be true"; sort control, influence and "neither"; check for "a ghost: an
imagined reaction, an assumed motive, a future scenario without evidence";
find "the real decision underneath the apparent one". Her firsthand account
of her own strain "is a fact about the situation, not an assumption to
test"; only assumptions about "someone else's motives or reactions" are
open to question.

**(b) What she considers decisive.** Who is "absorbing the cost" and "what
needs to give: which demand gets less, which boundary goes up, which
expectation has to be renegotiated". Which of two desires "has been losing,
and who has been paying for it". The real decision "only when it changes
what they should do next".

**(c) How she reaches and states a conclusion.** "Make the situation
legible, then give advice." Start "by naming what is actually happening,
without drama"; end with "the one move you would make", "within their
control, concrete enough to act on this week, and proportionate". "If one
fact would change everything, ask that one question. Otherwise, make a
sensible assumption, state it lightly, and respond." Confidence matched to
the stakes: "more tentative where you are hearing one side of a
consequential story". Major decisions (leave, quit, cut someone off) "are
theirs to decide".

**(d) What she notices that a general assistant would miss.** That things
"look fine from the outside because they are the one holding them
together"; the person "trying to solve step seven before taking step one";
"the argument they are rehearsing in their head with a person who has not
said the thing yet". From the influences: "when someone says they're fine,
ask twice".

**(e) Where she departs from conventional or "supportive" AI advice.** No
"it sounds like", "your feelings are valid", "journey", "hold space"; no
"writing exercise, a list of questions to consider, or 'only you can
decide'"; no decision matrices. It is "kinder to name that than to leave them
carrying it". Against the usual demand for certainty: "One step informs the
next." Against outcome-thinking: "confusing doing the work with controlling
the result is how people go mad." "Say plainly what isn't working and ask
for a different arrangement rather than enduring quietly."

**(f) What she finds exceptional or admirable.** Only by implication: "the
clarity of their thinking, the honesty of their words, the courage of their
next move"; to "own a whole history without bitterness"; "when life narrows,
rebuild". Gap: owner input needed (what she admires in how people handle a
hard situation, with examples).

**Further gaps (owner input needed):** her views on specific recurring
situations (money between friends or family, a boss versus a team, siblings
and an ageing parent, a partner's career against one's own); what common
advice she thinks is wrong ("just communicate", "set boundaries", "follow
your gut"); what she would never recommend. The brief deliberately
hard-codes no prescription, so these must come from you, not the model.

## Findings

1. **Her brief already gives her a recognizable method;** the risk is the
   layers on top. The list of other advisors (900 characters) is low
   relevance for her but conflicts with nothing.
2. **The shared text voice fights her tone.** Shared: "a well-informed
   friend with good taste texting a friend"; "Lead with the answer itself";
   "a specific... name, a detail, a clear call"; "End with a hook". Hers:
   "candid, warm, unhurried"; "Start by naming what is actually happening";
   "If they have told you what it is costing them, start from believing
   them". "Good taste", "a name" and "a hook" are written for the
   recommendation advisors and have no meaning for her.
3. **"No hedging" contradicts a qualification she is required to make.**
   Shared text voice: "no disclaimers, no hedging". Her capabilities: "make
   clear it is your read of what you have been told, not a fact you know";
   her brief: "more tentative where you are hearing one side". In 448
   characters the model must choose, and the shared line is sent last.
4. **Can her method survive one text?** The budget is 448 characters, about
   74 words (about 410 the first time, after "I'm Goldie, Cinq's sounding
   board."). The brief's own example (believe them, name who is holding it
   together, what has to give, one move) fits in about 60 words, so the
   *conclusion* survives. The *map* does not: several people and their
   incentives, or facts against fears, cannot be shown, only asserted.
   The brief keeps the tools "behind the scenes" anyway, so this is less
   damaging than for Alden. What gets cut first is the observation behind
   the move and the "my read" qualifier, and the rewrite step
   (`condensePrompt`) never sees her brief: it keeps "the single most useful
   point", which will usually be the move alone.
5. **The 24-hour window breaks her step-by-step logic.** Her brief: "One
   conversation reveals the next fact." The text layer: "Only the last day
   of this conversation is shown to you." A person who comes back on day
   three to report how the conversation went is starting over.
6. **"The call" is layered three times.** Shared: an optional "### The
   call". Her capabilities: bold "**The call:**", "or the question they need
   to answer next". Her brief: "Write in natural language, not in labeled
   sections... There is no fixed closing format." On text the bold is
   stripped, leaving a plain label inside an SMS. The capabilities also widen
   her ending from "the one move" to "or the question".
7. **Duplication.** "Match your confidence" and "one practical move"
   each appear in her brief, her capabilities and `APP_JUDGMENT`. Probably
   harmless, though the shared "make a call" leans towards verdicts her
   brief withholds.
8. **The labels around her disagree with the brief.** Brief: "close
   friend"; role: "Your strategic advisor"; SMS intro: "Cinq's sounding
   board" (passive; the brief says "tell them what you would do next"); her
   area for the other advisors: "complex personal and professional
   decisions" (the brief says she doesn't make them). "Incentives", named
   in the audit brief as part of her method, appears only in her
   capabilities, not in the owner's brief.
## Influences

Unlike Alden's, they mostly shape her **conclusions**, and several are
already built into her tools: the Stoics' control / not-control is her
"control, influence, or neither"; karma's "take responsibility for your part
and let go of the rest" is "own the labor"; the two people whose example
shaped Cinq ("ask for a different arrangement rather than enduring
quietly") is "what needs to give". Socrates and Oprah shape **manner** (the
one question; feeling heard). Some principles are not operationalized and
may go unused: "the means matter as much as the ends", "help quietly and
generously, but with prudence" (directly relevant to money between
friends), "the long view", "looking after yourself". Two conflict with the
text layer: "comfort before you solve" against "Lead with the answer
itself", and "ask twice" against "Ask a question only when the answer
honestly depends on something".

## Testable hypotheses

1. **She will differ on a cost the person describes.** A general AI will
   validate and suggest "communication"; she will believe the strain, name
   who absorbs it and what gives. *Test:* "My sister lives near Mom and
   I don't, so I send money. Now she says I'm not doing enough. I'm already
   stretched." Pass: she names what is being asked of whom and one move;
   fail: "both perspectives are valid".
2. **She will not differ much on a work decision, because the text layer
   cuts her map.** *Test:* "My cofounder wants to raise now, I want six
   more months of revenue first. Board meeting Thursday." Compare text with
   web: if the text answer is only a move, with no read of the incentives,
   finding 4 holds.
3. **"No hedging" will strip her one-sided-story caution.** *Test:* "My
   friend borrowed $2,000 a year ago and now posts vacation photos. She's
   clearly avoiding me." Pass: she flags "clearly avoiding" as a ghost and
   says it is her read; fail: she treats the motive as fact.
4. **The right answer is a question.** *Test:* "Should I take the job in
   Denver?" with nothing else. Pass: one question about the fact that
   decides it (who else moves, what she'd be leaving), no list; fail: a
   pros-and-cons overview or "only you can decide".
5. **The 24-hour window costs her the second step.** *Test:* day one, a
   conflict with a manager and her move; day three, "I did it, he said he'd
   think about it." Pass: she builds on the step; expected under the
   current window: she asks what happened.
