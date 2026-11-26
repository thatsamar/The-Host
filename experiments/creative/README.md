# Creative comparison (offline)

An offline experiment, approved by the owner. Which instruction layer around
each advisor's brief best preserves genuine authority, independent judgment,
a distinct point of view and natural personality? The standard it is judged
by is in `EVALUATION.md`. Nothing here touches production: no database, no
Twilio, no deployment. It only makes model calls from this machine.

## What it compares (`configs.ts`)

**Controlled.** No web search for any configuration, and identical
factual-integrity, privacy and safety instructions and date. Differences come
only from the instructions around the brief.

| | |
|---|---|
| A0 | Production's instructions by text, without the date (the control for the date line) |
| A | Production's instructions by text |
| B | A's own answer, before production's rewrite and trim (no extra call) |
| C | A without the shared voice instruction |
| L | A without the short-text block (no shared voice, no length limit, no rewrite) |
| I | A with Amar's identity clarification (Amar only) |
| D | The brief with only essential supporting instructions |
| E | The brief, minimally instructed |
| G | A general-purpose assistant with no brief, given the same context |

| AF | A with Cinq's philosophy right after the brief |
| DF | D with Cinq's philosophy right after the brief |

AF and DF run only when `PHILOSOPHY_FILE` points at the owner's approved
philosophy, kept outside the repository. It is never written into the code.

**End-to-end.** With research, as a person would actually get the answer. Kept
separate, so a difference caused by research is never put down to the
instructions.

| | |
|---|---|
| P | Production by text, exactly as today |
| DS | D with production web search |

## The questions (`cases.ts`)

Simple, judgment, independence, and two-turn challenges. In a challenge the
person pushes back with no new information (a good answer holds its view)
or brings legitimate new information (a good answer changes where it should).

The owner's authentic exchanges replace the drafts. Put them **outside the
repository** (it is public), in a folder with `cases.json`. Each entry has an
`id`, `advisor`, `kind`, `question`, and optionally `photos` (paths in that
folder), `history` (the earlier messages, with their photos) and `followUp`.
Then set `AUTHENTIC_DIR` to that folder. Every configuration, the
general-purpose one included, gets the same earlier messages and context.

## Running it

It needs `ANTHROPIC_API_KEY` as an environment variable, with `CHAT_MODEL`,
`CHAT_EFFORT` and `ROUTER_MODEL` matching production.

```
X="RUN_CREATIVE_EXPERIMENT=1 npx vitest run --config experiments/creative/vitest.config.mts"

# 1. What it would send, with no model calls
DRY_RUN=1 $X

# 2. The small first comparison: 5 questions, every configuration, one run (64 calls).
#    Writes out/pilot.json: lengths, word overlap between configurations, which ones
#    were rewritten, cost per run, and what a full repetition would cost.
#    Check it draws real distinctions before committing the budget.
PILOT=1 $X

# 3. The full run, once the owner approves the projected cost.
REPS=2 BUDGET_USD=30 $X
```

It stops before the budget, resumes where it stopped, and records with every
result the model, router model, effort, web search, the size and fingerprint
of the instructions, tokens, time and cost.

## Output, in `out/` (never committed: it holds the advisors' answers)

- `blind.html`: answers under neutral numbers, controlled and end-to-end in
  separate sections, each with a scoring form (intellectual quality first).
  Scores stay in the browser; "Copy my scores" exports them.
- `rewrites.html`: the advisor's own answer beside what the rewrite delivered.
- `key.html`: which configuration wrote each number. Open it after judging.
- `summary.json` and `pilot.json`.
