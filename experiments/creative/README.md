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

Production is frozen at the benchmark in `BASELINE.md`.

| | |
|---|---|
| A | Production's instructions by text |
| B | A's own answer, before production's rewrite and trim (no extra call) |
| C | A without the shared voice instruction |
| V | A with the shared voice ("a well-informed friend with good taste") replaced by the advisor's own |
| L | A without the short-text block (no shared voice, no length limit, no rewrite) |
| F | A without the optional closing "The call" |
| K | A without Gio's per-piece purchase checklist (Gio only) |
| N | A without prescribed answer shapes, for all five: the question decides (one thing, two very different ones, nothing, or something unexpected); price when relevant |
| R | A with research as the advisor's resource: what was checked is mentioned only when it changes the advice (Amar, Alden) |
| M | A with discretion about earlier messages: understanding, not display; sensitive things stay out of unrelated questions |
| S | A with diligence that rises with the stakes (authentication, provenance, condition, valuation, an independent expert) |
| I | A with Amar's identity clarification (Amar only) |
| AF | A with Cinq's philosophy right after the brief |
| X | A with I, V, F, N, R, M and S together, and the philosophy if given |
| D | The brief with only essential supporting instructions |
| DF | D with Cinq's philosophy right after the brief |
| E | The brief, minimally instructed |
| O | The original brief (the earliest in the repository, `original-briefs.json`), with D's essentials |
| G | A general-purpose assistant with no brief, given the same personal context |
| G0 | An ordinary general-purpose assistant: no brief and none of the person's earlier messages |

G against G0 is the value of memory; A against G is the value of the advisor.
The two are never confused.

V, F, K, N, R, M, S and I each change one thing, so each is judged on its own
before X combines them. None tells an advisor to be more romantic, curious
or intriguing: the hypothesis is that those qualities are in the briefs
already and are being diluted.

AF and DF run only when `PHILOSOPHY_FILE` points at the owner's approved
philosophy, kept outside the repository. It is never written into the code.

**End-to-end.** With research, as a person would actually get the answer. Kept
separate, so a difference caused by research is never put down to the
instructions.

| | |
|---|---|
| P | Production by text, exactly as today |
| RS | P with R's change, research on (Amar, Alden) |
| DS | D with production web search |

## The questions (`cases.ts`)

Simple, judgment, independence and two-turn challenges; judgment already
seen and worth protecting (preserve); questions where a sentence is enough
(short); room to open a door (discovery); earlier messages that are
available but mostly irrelevant, some sensitive (memory); the same watch
question at $2,500, $250,000 and $2.5 million at auction (stakes); and
places where the expensive or obvious choice may really be right (luxury).
Also: a wrong premise; "I don't know"; a question worth asking before
answering; another advisor's view to agree or disagree with; memory both
used (an expressive wardrobe should shape a watch) and withheld (a hurtful
message kept out of a weight-loss question); sequences of conversations on
different days, judged as a whole (in production by text an advisor sees
only 24 hours, so this is the best case, and G0 starts each day fresh); and
the same question to all five, shown without names, to see whether each
voice is recognisable.
In a challenge the person pushes back with no new information (a good answer
holds its view) or brings legitimate new information (a good answer changes
where it should).

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

# 2. The small first comparison: 8 questions, every configuration, one run (137 calls; 153 with the philosophy).
#    Writes out/pilot.json: lengths, word overlap between configurations, which ones
#    were rewritten, cost per run, and what a full repetition would cost.
#    Check it draws real distinctions before committing the budget.
PILOT=1 $X

# 3. Then in stages, each approved on its projected cost (the full grid is
#    about 1,700 calls, far beyond one $30 budget):
#    a. each single change against production and the general baseline
CONFIGS=A,V,F,N,R,M,S,I,AF,G,G0 REPS=2 BUDGET_USD=30 $X
#    b. the changes that helped, combined, against production end to end
CONFIGS=A,X,O,P,RS,D,G,G0 REPS=2 BUDGET_USD=30 $X
```

It stops before the budget, resumes where it stopped, and records with every
result the model, router model, effort, web search, the size and fingerprint
of the instructions, tokens, time and cost.

## Output, in `out/` (never committed: it holds the advisors' answers)

- `blind.html`: answers under neutral numbers, speaker names removed, controlled and end-to-end in
  separate sections, each with a scoring form (intellectual quality first).
  Scores stay in the browser; "Copy my scores" exports them.
- `rewrites.html`: the advisor's own answer beside what the rewrite delivered.
- `key.html`: which configuration wrote each number. Open it after judging.
- `summary.json` and `pilot.json`.
