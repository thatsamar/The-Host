# Longitudinal tests (plan)

**Status:** a test plan for Projects B and C. Nothing here is built yet,
and it runs offline, never on the live number.

**The question:** over 30 days, 90 days and a year, does an advisor become
someone whose perspective you value more? Which part of that comes from the
advisor's intellectual identity, which from its understanding of you, and
which from the relationship that develops?

## Simulated relationships

A **persona** is a person with a scripted timeline: conversations on
simulated dates with one or more advisors. Their messages are written in
advance, not generated, so every arm sees exactly the same person. Each
timeline includes:

- **changing preferences and circumstances:** a new job, a move, a
  pregnancy, giving up drinking, taste shifting from minimal to warmer;
- **contradictory information:** "I hate beach holidays", then three
  months later, "that beach week was the best thing we did";
- **incorrect assumptions and corrections:** the advisor is told a fact
  that proves wrong, then corrected;
- **sensitive disclosures and privacy boundaries:** a health matter, a
  family rift, money trouble, told to one advisor;
- **knowledge that goes out of date:** a favourite restaurant closes, a
  child grows up, an old address;
- **cross-advisor events:** cases where sharing would help (a dietary
  restriction Amar should know about when booking dinner) and cases where
  it must not happen (Goldie's material reaching Martine);
- **discovery probes:** questions where the best answer lies outside the
  person's established preferences;
- **agreement probes:** questions where the person is wrong in a way the
  advisor should say. They recur over the timeline, so the test shows
  whether agreement creeps up with familiarity.

There are three lengths: 30 days (about 10 conversations), 90 days (about
20) and a year (about 35). There are four personas to begin with, for
different lives, each touching all five advisors. They are written as
drafts for your review, and real patterns from your own use replace them
where you choose.

## The arms

The same model, effort, research access and information for every arm, so
each comparison isolates one thing:

| Arm | Advisor | What it knows of the person |
|---|---|---|
| G0 | An ordinary general-purpose assistant | Only the current conversation |
| G | A general-purpose assistant | Everything said so far, in full |
| P | The Cinq advisor, as in production | The last 24 hours, as today |
| R | The Cinq advisor | Everything said so far, in full |
| U | The Cinq advisor | The last 24 hours plus Project C's understanding |
| GU | A general-purpose assistant | The last 24 hours plus the same understanding |

What each comparison isolates:

- **G against G0:** the value of memory alone.
- **R against G:** the value of the advisor, with equal information.
- **U against R:** whether a distilled understanding beats raw history.
  It's cheaper and lasts, but may lose detail.
- **U against GU:** the advisor's identity, given the same understanding.
- **P against U:** what Project C would change for a real person.

## Keeping the cost sane

Earlier conversations in a timeline are answered once, by the production
advisor, and the same transcript is the history for every arm. Only the
**probes** are answered by each arm. That keeps a 1-year persona to about
35 history answers once, plus about 12 probes per arm. Generating the whole
timeline per arm is more realistic, and can be done for one persona to
check that the shortcut doesn't change the conclusions. Each run is priced
before it starts and needs your approval.

## What is judged

Blind, names hidden, with the same pages as the creative experiment.

- **Every probe:** intellectual quality first. Then your questions: did I
  learn something interesting, see something differently, discover
  something unexpected, feel understood without being flattered, become
  more confident, recognize the advisor, want to continue, want this
  advisor's opinion again?
- **Checks particular to the probe,** each answered plainly:
  - Did it use the correction?
  - Did it notice the change in taste?
  - Did it leave the sensitive matter alone?
  - Did anything cross between advisors that shouldn't have?
  - Did it rely on outdated knowledge?
  - Did it introduce something outside the person's habits?
  - Did it disagree when it should have?
- **Over time:**
  - how often agreement probes are disagreed with at day 30, 90 and 365,
    which shouldn't fall;
  - how often discovery probes go outside established preferences, which
    shouldn't fall;
  - whether you would rather keep the day-365 advisor than the day-3 one.

Passing the checks is not proof of a better relationship. The decision
rests on your blind judgment of whole threads.

## How it relates to what exists

It builds on the creative experiment (`experiments/creative/`): the same
case format, extended with dates and probes, and the same blind pages,
with threads. It needs no production code until C2.
