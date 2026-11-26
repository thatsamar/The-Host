# Creative comparison (offline)

An offline experiment, approved by the owner: does the instruction layer
around each advisor's brief change the quality of judgment, authority,
tone, personality, independence, usefulness and naturalness? Nothing here
touches production: no database, no Twilio, no deployment. It only calls the
model from this machine.

## What it compares

The configurations are defined in `configs.ts`. Each changes one thing from its neighbour.

| | Configuration |
|---|---|
| P | Production by text, exactly (web search on) |
| A | P with web search off, so every configuration has the same research inputs |
| B | A's own answer, before production's rewrite and trim (no extra call) |
| C | A without the shared voice instruction |
| L | A without the short-text block (no shared voice, no length limit) |
| H | A plus today's date (PR #74's line), tested on its own |
| D | The brief with only essential supporting instructions |
| E | The brief, minimally instructed (factual integrity, safety, date) |
| G | A general-purpose assistant with no brief: the competitive baseline |

The questions are in `cases.ts`. They are drafts until the owner's authentic
exchanges arrive. Replace them, and add photos and earlier turns, before
treating any result as evidence.

## Running it

It needs `ANTHROPIC_API_KEY` set as an environment variable in the cloud
environment (it can't be a network secret for Anthropic's own hosts). Use the
same `CHAT_MODEL`, `CHAT_EFFORT` and `ROUTER_MODEL` as production, so the
comparison is against what people actually get.

```
# What it would send, without calling the model:
RUN_CREATIVE_EXPERIMENT=1 DRY_RUN=1 npx vitest run --config experiments/creative/vitest.config.mts

# The run: 3 repetitions, stopping at $30.
RUN_CREATIVE_EXPERIMENT=1 npx vitest run --config experiments/creative/vitest.config.mts
```

`REPS`, `BUDGET_USD`, `CASES` and `CONFIGS` (comma lists) narrow it. An
interrupted run resumes where it stopped. Every result records the model,
router model, effort, web search, the characters and fingerprint of the
instructions, tokens, time and cost.

## The output, in `out/` (never committed: it holds the advisors' answers)

- `blind.html`: every answer to each question under a neutral number, in shuffled order.
- `rewrites.html`: the advisor's own answer beside what the rewrite step delivered.
- `key.html`: which configuration wrote each number. Open it only after judging.
- `summary.json`: length, rewrite and trim rates, cost and model per configuration.
