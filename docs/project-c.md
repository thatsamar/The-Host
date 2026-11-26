# Project C: accumulated personal understanding (proposal)

**Status:** design and test planning only. Nothing here is built, and no
part of it reaches production without approval. Project A (reliability)
and Project B (the advisors' quality) are separate.

**The goal:** an advisor should be more valuable after three years than
after three days, whatever happens to the underlying models. What lasts is
what the advisor has come to understand about the person, recorded in a
form any future model can use.

The memory audit (`memory-audit.md`) found that today there is no
persistent understanding at all, only the raw last day of each
conversation by text, and that older history is being deleted.

## C0: stop the loss (a decision needed now)

Every text a person sends deletes their conversation older than a day.
Whatever Project C becomes, it will want that history, and it can't be
recovered.

- **Proposal:** keep text turns, without their photos, for 90 days or up
  to the last 40 per advisor. Photos are what made the row too large to
  save; text alone is small. What the advisor is *sent* stays exactly as
  today, the last 24 hours, so behaviour doesn't change.
- **Tradeoffs:**
  - Personal conversations, Goldie's included, are kept longer. They are
    already in the same locked table, readable only with the service key.
  - It touches the session row that Project A made reliable. A size test
    proves 40 text turns per advisor stay far below the limit that caused
    the timeouts.
  - Retention should be stated to people (HELP or the privacy line) before
    anything longer is used.
- **Rollback:** one constant.

## The design, simply

No knowledge graph, no vector search and no new service. One short written
understanding per person per advisor, kept up to date, plus the evidence
behind it.

### What is kept

For each person (keyed by their number on text) and each advisor, an
**understanding**: a few hundred words, in the advisor's own terms, of who
this person is to them. It is written at the levels you set out, deepest
last:

1. what they own (only where it matters to judgment);
2. what they like;
3. how they live;
4. how they think;
5. what they value;
6. what they aspire to;
7. how they are changing.

For Martine, that means an aesthetic sensibility ("an expressive,
unconventional wardrobe; one strong piece at a time; dislikes looking
styled"), not an inventory. For Gio: their relationship with spaces,
materials, objects and beauty. For Amar: how they like to experience the
world, what moves them, what they might enjoy discovering. For Alden:
their palate, rituals and occasions. For Goldie: temperament,
circumstances, relationships and changing priorities, with the strictest
discretion.

Each statement behind it carries:

- its **standing**: stated by the person (a fact), observed across more
  than one exchange (an observation), or a tentative interpretation;
- its **evidence**: the person's own words, quoted, with the date. This
  was the rule in the Sep 29 design, so an advisor's advice is never saved
  as the person's preference;
- when it was **first seen** and **last confirmed**, so old things fade
  and changes show ("used to prefer…; lately…");
- its **sensitivity**: ordinary, or sensitive (health, money,
  relationships and conflict, family, mental state).

**Nothing is inferred from a single exchange.** Something said once is a
fact if the person stated it, and at most a tentative note otherwise. It
becomes an observation only when it recurs.

### How it is kept up to date

After a conversation goes quiet, one inexpensive background call reads the
new turns and the current understanding, and proposes changes: add,
confirm, revise or retire, each with its evidence. Code enforces the
rules:

- the evidence must quote the person;
- nothing comes from the advisor's own words;
- nothing tentative is promoted on a single sighting;
- sensitive items are marked as sensitive.

It never runs while someone is waiting for an answer, so it can't slow a
reply.

### How it is used

The understanding goes into the advisor's prompt as one block, after the
brief, labelled as understanding for judgment, not material to show. That
is configuration M's discretion paragraph, tested now in Project B:

- **Felt, not demonstrated:** mentioned only when it adds something real.
- **Discretion:** sensitive items have a far higher bar, and never enter an
  unrelated question.
- **Expanding, not narrowing:** knowing someone well is a reason to
  introduce them to something just outside their habits, and to notice
  when their taste is changing. It is never a reason to recommend
  variations of what they already like.
- **Familiarity is not agreement:** the advisor's independence doesn't
  soften as it knows them better. The longitudinal tests measure this.

The raw recent conversation is still sent as now. The understanding adds
what the last day can't carry.

### Between advisors

- **Private by default.** Each advisor's understanding is its own.
- **A small shared layer**, only for ordinary facts the person has stated
  that any advisor would need: their city, who they live with, a dietary
  restriction. Each shared item is marked as shared.
- **Nothing sensitive crosses without explicit authorization.** Goldie's
  understanding never crosses at all unless the person asks for it to.
- **A handover still shares only the question and the first answer, after
  the person agrees.**

### The person's control

- **By text:**
  - "WHAT DO YOU KNOW ABOUT ME" gets a short plain summary from the current
    advisor.
  - Saying "that's not true", or "forget that", corrects or removes an item.
  - "FORGET ME" removes everything, for every advisor.
- **Corrections in passing:** an ordinary correction in conversation ("I
  don't drink anymore") revises the understanding at the next update.
- **Deletion:** today STOP only opts out; the conversation stays stored
  (see the audit). Project C would make deletion real: FORGET ME at once,
  and STOP after a short grace period stated in the HELP text.

### The website

The website is anonymous by design, so it has no identity to remember. Two
options, for later:

- understanding by text only (simplest, and where the relationships live);
- an optional sign-in that links a web visit to the person's number.

The proposal is text first.

## What it costs and risks

- **Cost:** one low-effort call per conversation, once the conversation
  goes quiet, plus a few hundred more prompt tokens per answer. That is
  small against today's prompts of about 25,000 characters.
- **Privacy:** this is the main risk. It means intimate understanding at
  rest, Goldie's especially. The mitigations:
  - a locked table with the service key only, as for the SMS tables;
  - a keyed hash of the number, not the number;
  - retention and deletion stated to the person;
  - sensitive items marked;
  - nothing in logs or measurement.
  Before launch the repository must be private.
- **Wrong understanding that hardens:** it is held in check by evidence,
  standing, decay and correction, and tested longitudinally.
- **Creepiness:** "felt, not demonstrated" is tested first, in Project B.
- **A filter bubble:** the discovery and agreement probes in the
  longitudinal tests check for this.

## Phases, each with its own approval

- **C0. Stop deleting text history:** the decision above.
- **C1. Offline prototype:** the understanding, its update rules and its
  use, run on simulated relationships in the longitudinal tests
  (`longitudinal-tests.md`), against the alternatives there. No production
  code.
- **C2. The test number:** real use on the isolated test environment, by
  you and invited testers, with the dashboard measuring cost and time.
- **C3. Production,** with the person's controls, the stated retention and
  a rollback switch.

## Open questions for you

1. Approve C0, and the retention to state to people: 90 days, 1 year, or
   until they say otherwise?
2. Should the shared layer exist at all, or should every advisor learn
   independently, with a handover as the only bridge?
3. Should Goldie's understanding ever be shareable, even with explicit
   permission?
4. Text first for the website, or an optional sign-in?
