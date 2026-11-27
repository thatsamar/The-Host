# Cinq: intellectual development and validation

The owner's brief, November 27: the goal is not for Cinq to sound less like a
general AI, but to think differently and demonstrably better within each
advisor's expertise. Production is unchanged until the evidence has been
reviewed and the changes agreed. Every earlier configuration is kept.

The standard is in `EVALUATION.md`. The ultimate test: does Cinq consistently
help people make better decisions, and experience more of life, than a
general-purpose AI would?

## How each point is carried out

| | The owner's point | In the harness |
|---|---|---|
| 1 | The intellectual baseline | G0 (an ordinary assistant), G (with the same personal context), GS (G with web search: equivalent knowledge, research and safeguards), against A (production, controlled) and P (production end to end) |
| 2 | Sources of differentiation | E (the brief alone), D (brief and essentials), DJ (D + the shared standard of judgment), DC (D + the advisor's own capabilities), NJ (production without the shared standard), NX (production without the paragraph about the other advisors), GJ (the shared standard without a brief), A0 (production without memory), P vs A (research). Dilution: how close each configuration's substance is to the general-purpose answer (`convergence`) |
| 3 | Distinct intellectual foundations | `audits/`: each brief's own way of interpreting, deciding and concluding, in its own words, with the gaps only the owner can fill. Foundations are tested as DE, OE, AE and RF once the owner provides or approves them (`FOUNDATION_DIR`). None is generated here |
| 4 | Longitudinal | One case per advisor, four earlier conversations over six weeks, asked with the first two (`-early`) and all four (`-full`); A (full memory), AW (production's real 24-hour memory), A0, G, G0. Checked: each earlier fact used, recited, or (if sensitive and unrelated) left out |
| 5 | The simplified blind evaluation | `primary.html`: four choices per question (whose advice I'd follow, most discernment, understood what others missed, which I'd return to). The detailed rubric stays in `blind.html`, for diagnosis |
| 6 | Beyond Alden | `intellect-cases.ts`: for all five, an ambiguous question, a meaningful financial decision, an everyday one, an unfamiliar person, one where asking first is right, plus the earlier independence, challenge, premise, stakes, luxury, memory and voice cases |
| 7 | Intellectual independence | Status, price, conventional wisdom, pushback with no new information (should hold) and with real information (should change), another advisor's view, and the control: a person who is simply right (agreeing is correct) |
| 8 | Factual integrity | `judges.ts`: claimed experience, specifics stated with more certainty than an expert could have, details not in the photo or message; `FACTCHECK=1` verifies the specific claims with web search; diligence rising with stakes |
| 9 | Report before implementing | `report.html` and `report.json`: configuration-level results, per advisor and per kind, failed checks, repeatability, wrong facts; the owner's choices, once given, decide winning and losing examples |

## What is measured automatically, and what isn't

The checks (`judges.ts`) flag; they never decide which answer is better.
Founder judgment decides quality and taste, on the primary page.

- **check:** the case's own behavioural criterion: did it ask before advising,
  agree when the person was right, notice the deciding condition, hold or
  change appropriately after pushback.
- **integrity:** claimed experience, over-certain specifics, unseen details.
- **memory:** for the longitudinal cases, each fact used, mentioned, intrusive;
  a sensitive fact brought in; something unknown invented.
- **consistency:** the same configuration's two runs: the same recommendation?
- **convergence:** against the general-purpose answer to the same question (G,
  or GS end to end): the same recommendation, how much the reasons overlap, and
  what each noticed that the other didn't. This is "thinks differently",
  measured on substance, not wording.
- **facts:** with `FACTCHECK=1`, up to five specific claims per answer,
  checked with web search.

## Running it

As in `README.md`, with `OUT_DIR` keeping this study's results apart:

```
export OUT_DIR=$PWD/experiments/creative/out/intellect AUTHENTIC_DIR=…
X="RUN_CREATIVE_EXPERIMENT=1 npx vitest run --config experiments/creative/vitest.config.mts"

# What it would send, and its cost
DRY_RUN=1 STUDY=intellect CONFIGS=G0,G,GS,A,P REPS=2 $X
# 1. The baseline, two runs each, with the checks
STUDY=intellect CONFIGS=G0,G,GS,A,P REPS=2 JUDGE=1 FACTCHECK=1 FACT_CONFIGS=P,GS BUDGET_USD=… $X
# 2. Sources of differentiation, one run each
STUDY=intellect CONFIGS=E,D,DJ,DC,NJ,NX,GJ,A0,AW REPS=1 JUDGE=1 BUDGET_USD=… $X
```

`ADVISORS` narrows to some advisors, `CASES` to some questions, and
`PRIMARY_CONFIGS` sets who appears on the primary page (default G0, G, GS, A,
P). With the owner's choices saved to a file, `SCORES_FILE` adds them to the
report.
