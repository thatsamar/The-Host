# Cinq: from remembering to understanding

A read-only investigation (27 November 2026). Nothing here changes the product. Any memory change is Project B and needs the owner's approval; Project A may not touch prompts, memory or model settings.

Owner's goal: an evolving understanding of the person (sensibilities, values, interests, circumstances, aspirations). Memory felt, not demonstrated. Discretion as important as recall. Standard: understand the user without becoming like the user.

## 1. How memory works today

**Website.** Nothing is stored on the server. The browser sends the whole visit with each question (`src/lib/ask/prompt.ts`, at most `MAX_HISTORY_TURNS` = 40 turns). The relay (`src/lib/ask/relay.ts`) keeps only the answer in progress, for 15 minutes. A new visit starts from nothing.

**Text (Cinq by text).** One row per phone number in `sms_sessions` (`supabase/migrations/20261028000001_sms.sql`): `phone_number` (plain text, primary key), `opted_in`, `advisor_id`, and `turns_by_advisor` (jsonb). The jsonb also holds three internal keys (`supabase-store.ts`), so no migration was needed for them: `_lastAck`, `_introduced` (the advisors this number has met) and `_pendingHandoff` (an offer that waits for the next text). RLS is on with no policies and no grants to public roles (`20261126000002_sms_lockdown.sql`). Only the service-role key reads it.

- Turns (`store.ts`, `SmsTurn`): role, text, optional photos, `at` (ms), and for a handoff note `note: "handoff"` and `from`. At most 40 turns are stored per advisor (`MAX_STORED_TURNS`, `handler.ts`).
- What the advisor is sent (`context.ts`, `recentTurns`): only turns from the last 24 hours (`CONTEXT_WINDOW_MS`). A turn without `at` counts as older. A handoff note is always sent. After a day it is cut down to "X brought you in earlier, more than a day ago."
- What is kept (`compact.ts`, `compactSession`, run before every save): turns older than 24 hours are deleted. Older handoff notes are kept in their shortened form. Photos stay only on the current advisor's latest question; any other photo-only turn gets a stand-in such as "(Sent a photo earlier.)". Every advisor with turns is added to `_introduced`.
- Saving (`handler.ts`, `save`) is best effort. A failed save never holds back a reply; that turn is simply lost.
- STOP sets `optedIn = false` and `advisorId = null` and saves. It **does not delete** the turns, `_introduced` or the phone number. The last day's conversation stays in the row, and `sms_sessions` has no retention rule (the 90-day `RETENTION_DAYS` applies only to the metrics tables).
- Handoffs (`handoff.ts`): `handoffNote` stores the first advisor's answer, prefixed `HANDOFF_NOTE_PREFIX`, in the new advisor's history.

So beyond 24 hours, an advisor on text knows only three things: which advisors the person has met, that someone once brought it in, and the date. It knows nothing about the person.

**What the advisors are told, and where it contradicts what they get.**

1. Amar, Martine, Gio, Alden (and retired Jack) carry this line in their capabilities: "This app keeps nothing: each visit starts fresh, so don't claim to remember…". The same capabilities block is sent on text, where up to a day of history *is* sent. The text-only notes (`textChannelNotes`) then say "Only the last day of this conversation is shown to you." They explicitly replace the earlier "no transfer" note but never the "keeps nothing" line, so on text an advisor gets two statements that disagree. Goldie's capabilities have no memory line at all.
2. Alden's own brief (`alden-prompt.ts:91`) says "Never claim to … remember an earlier conversation." That rule is about claimed experience, but it will read as a ban on any remembered understanding. Changing it is an owner decision.
3. The docstring in `context.ts` says "Everything stays stored, but only turns from the last [day] are sent." That has been out of date since `compact.ts` began deleting older turns.
4. The text notes tell the advisor "This person has met these Cinq advisors before." So it is told a relationship exists, but nothing of it.
5. A legacy design exists but is unused: the `memories` table and `match_memories` (pgvector) in the foundation and `20260930000001_memory.sql` migrations, with `source` (extracted/manual) and `evidence`. It is tied to the old sign-in, users and projects model. It is useful as a precedent (every memory carries its evidence), not as code to reuse.

## 2. Evidence from the pilot (`out/pilot-intellect/judges.jsonl`)

Setup: five longitudinal cases (`intellect-cases.ts`), one per advisor. Each has four earlier conversations 3 to 50 days before the question: three facts to **use** and one sensitive, unrelated fact to **withhold** (manager trouble, a father's funeral, trying for a baby, a mother in hospital, cutting down on drinking). Each ran 2 times, so the "-full" results below are 10 answers per configuration: 30 use-facts and 10 withhold-facts. The `memory` judge (one low-effort call) marks each fact as used, mentioned, or intrusive.

| Config | Use-facts shaping the advice | Use-facts mentioned | Sensitive fact mentioned | Flagged intrusive |
|---|---|---|---|---|
| A: production prompt, full history | 27/30 | 22/30 | 2/10 | 2 |
| P: production end to end, full history | 27/30 | 23/30 | 3/10 | 2 |
| AW: production's real 24-hour window | 8/30 | 0/30 | 0/10 | 0 |
| A0: no history | 7/30 | 0/30 | 0/10 | 0 |
| G: general assistant with history | 29/30 | 27/30 | 4/10 (used 1) | 3 |
| GS: G with search | 30/30 | 25/30 | 5/10 (used 2) | 5 |
| G0: general assistant, no history | 1/30 | 0 | 0 | 0 |

What it shows:

- **Production by text today has no useful memory.** AW (8/30) is no better than A0 (7/30), because every earlier conversation in these cases is older than a day. Those 7 to 8 hits are generic advice that happens to match a fact (breathable fabric for Houston). One AW example: Amar recommends Lisbon, a famously hilly city, to someone recovering from knee surgery.
- **With full history the advisors use what they know (27/30), but they show it.** 22/30 facts are mentioned explicitly ("like that green", "Given your pattern…"). Some mentions are natural; many recite.
- **The advisors are more discreet than a general assistant, but not discreet enough.** A brought up the sensitive fact 2/10 times, both as allusions: Martine's "And go gently next week" (the funeral) and Alden's "You've earned a quiet one" (the mother in hospital). G and GS did so 4 to 5 times out of 10, and sometimes let it shape the advice.
- Caveats: two repetitions and one automated judge, and the "-early" variants exist only for Alden (4 judgements). The judge also marked 2 of 4 *unknown* facts as "used" in A/early, which is noise from coincidence. The pilot's test conditions were also flawed: the model was not told how old each earlier turn was (`daysAgo` is not passed through), and config A sent 50 days of history while its channel notes said "only the last day is shown". Treat the table as directional only.

**Conclusion:** raw history buys most of the value (A0 7/30 becomes A 27/30) but brings recitation and occasional leaks. The 24-hour window gives up all of that value to avoid the problems. What the owner is asking for sits between the two: the use without the display.

## 3. Design options, simplest to most ambitious

The block order everywhere: system prompt → app capabilities → channel notes (text only) → **[new: `person_understanding`]** → current date → conversation. The new block would be uncached and placed after the cached blocks, so prompt caching still works.

### Option 0: Tell the truth (prompt wording only)
On text, replace "keeps nothing" with an accurate line: what is shown, and that the advisor may not imply it remembers more. This costs nothing and stores nothing. It removes contradiction 1, but it builds no understanding. Even so, it needs owner approval, since the capabilities are prompt text.

### Option 1: A longer raw window (say 7 or 30 days)
- Stored and read: the same turns as now, kept longer (`CONTEXT_WINDOW_MS`, `compact.ts`).
- Cost: input tokens grow with history, about 40 turns × ~120 tokens per text. The session row grows, which is what once pushed saves past the statement timeout.
- Weaknesses: this is pure recall. The pilot's A row is exactly this behaviour (22/30 mentioned, 2/10 sensitive). Stale specifics also come back ("last night's dinner").
- Verdict: a baseline to beat, not the goal.

### Option 2: A distilled, private understanding note per person, per advisor (recommended first test)
- **Stored:** a short note per (number, advisor), at most ~600 characters of plain sentences in the third person, under fixed headings: *Circumstances (as of <month>)*, *Leanings (with how strongly the evidence supports each)*, *Constraints*, *Open threads*. It carries no quotations, nothing in the person's own phrasing, and no sensitive categories (below).
- **Written:** by one low-effort call (`getRouterProvider` / `ROUTER_MODEL`). It runs when turns are about to leave the 24-hour window, or after a conversation has gone quiet for some hours, and always off the reply path, after the answer has been sent to Twilio. The input is the previous note plus the turns leaving the window, and the call rewrites the whole note. A failure keeps the old note (best effort, like `save`).
- **Read:** as the `person_understanding` block. Its framing is part of the test: "What you have come to understand about this person, from earlier conversations. It informs your judgment; it is not material to show. Do not quote it, recite it or say you remember. Let it change what you recommend, not what you say about them. One choice is not a taste and a passing circumstance is not who they are. Where your own judgment differs from their leanings, say so as you would to anyone. If something here seems out of date or uncertain, check it lightly before relying on it." (This builds on `DISCRETION` in `configs.ts`, config M.)
- **Discretion: withheld by default.** Health (theirs or others'), grief and bereavement, pregnancy and fertility, relationship trouble, mental health, substance use, money trouble, legal matters, sexuality, religion, politics, and conflict at work. The rule is **keep the consequence, not the cause**: "prefers flat, short walks for now (as of October)" rather than "knee surgery". "Only he is drinking for now; wants a good non-alcoholic option for his wife" rather than "wife pregnant". When nothing practical follows from a sensitive fact, it is not written down. The note is never used to open a topic the person hasn't raised.
- **Cost and latency:** one extra low-effort call per advisor per conversation-day, about 1.5k tokens in and 200 out, a fraction of a cent. Reading it adds about 150 to 250 tokens to each text. Latency on the reply path: none.

### Option 3: Shared understanding across advisors (owner's call)
Should Gio know what Martine learned? The options:
- **(a) Silo.** Each advisor knows only what the person told it. This is the most private and matches today's "switching never mixes contexts".
- **(b) A shared core of circumstances plus per-advisor notes.** The core holds neutral, practical facts that any advisor would want (home city, who they live or travel with, budget band, mobility, dietary needs), and everything else stays with the advisor who heard it. For example, Amar knowing the partner is vegetarian helps Alden.
- **(c) Fully shared.** Risky. In the pilot's own example, Goldie hears "cutting down on drinking": in Alden's hands that is either care or intrusion. Sensitive categories must never cross advisors, even if the owner picks (c).

The text notes would then say plainly which kind of knowledge applies, so no advisor claims to know "what Martine said" (AGENTS.md forbids that today).

### Option 4: The person can see and correct it
- New text commands, read by the navigation layer (`navigation.ts`) and never sent to the model:
  - "What do you know about me?" returns the note(s) as written.
  - "Forget that" drops what came from the last conversation.
  - "Forget everything" deletes all notes.
- **STOP deletes everything:** the notes and the session turns, which STOP does not do today.
- The note is rebuilt from evidence, not edited by hand, so "forget" must also delete the source turns.

### Option 5: Structured, evidence-backed memory, and memory on the website
- Facts are stored with provenance (turn time), confidence and an expiry, and the ones relevant to the question are retrieved, as in the legacy `memories` design.
- Memory on the website needs an identity (sign-in), and it breaks "one page, nothing saved". That is a product decision for the owner, not an engineering one.

### Privacy and security (all options that store)
- **Storage:** a new table `sms_understanding`, keyed by `numberKey` (the keyed hash already used in metrics), not the plain number. Body encrypted in the app (AES-GCM, key in an env var), so a database dump alone reveals nothing.
- **Access:** RLS on, no policies, no grants to `anon` or `authenticated` (same as `sms_lockdown`). The migration can be run again safely, with an undo file in `supabase/rollback/`.
- **Retention:** deleted after N days with no contact (owner to set; 180 suggested) and on STOP.
- **Never in logs or metrics:** logs carry fixed codes only (`SMS understanding write failed` plus the error class). Metrics may record that a note was read or written and its token counts, never its content.
- **Public repo:** never real notes or exchanges in the repository. Cases stay as drafts.
- **Prompt injection:** the note is derived from user text, so the distiller treats it as data.

### Failure modes to design against
- **Stale facts.** A healed knee, a move to another city. Every circumstance is dated "as of" and expires; the advisor checks one lightly before relying on it.
- **Over-generalising.** One green overshirt is not "loves colour". Leanings need repeated evidence, and one purchase is recorded as a single event.
- **Memory overriding judgment.** The advisor stops challenging the person because "they like X". Measure with the convergence and check judges on cases where the known taste is wrong for this occasion.
- **Becoming like the user.** Mirroring their vocabulary or opinions. The note stays in neutral third person with no quotations, and the advisor keeps its own brief's point of view.
- **Invented memory.** Claiming to remember something that is not in the note.
- **Drift.** Summaries of summaries lose their sources. Cap the length and keep the "as of" dates.
- **Shared phones.** Someone else texting from the same number.
- **Goldie's safety boundary.** Crisis disclosures are never stored as "understanding". Her safety rules act on the present message only.

## 4. Evaluating before production

The work fits the existing harness (`configs.ts`, `run.exp.ts`, `judges.ts`, `intellect-cases.ts`):

**New configs**
- `AU`: AW (production's 24-hour window) plus a `person_understanding` block. The block is distilled at run time by the router model from the history that falls outside the window (`historyFor` already splits by `daysAgo`), and each note is written to `out/` so the owner can read it.
- `AUM`: AU with the M discretion wording added to the channel notes.
- `AUX`: AU with the withhold filter off, to measure what the filter is worth.
- `AUS`: a shared core across advisors (needs the cross-advisor cases below).
- Also fix the test conditions: give A and AU channel notes that match what they are actually shown.

**New longitudinal cases**
- A stale fact (surgery eight months ago, later "fully recovered").
- An update that contradicts an earlier fact ("we moved to Denver").
- A single purchase that must not become a taste.
- A known taste that is wrong for this occasion (the advisor should still disagree).
- A sensitive fact whose practical consequence is relevant (as with Alden's pregnancy case).
- A cross-advisor case (Goldie hears about drinking; Alden is asked about wine).
- A "forget that" followed by a question that would have used the forgotten fact.

**Measures**
- Extend the `memory` judge with:
  - `alluded` per fact (the pilot's leaks were allusions, not explicit mentions);
  - `invented` (claims about the person not in the history);
  - `stale` (relied on an expired fact);
  - `deferred` (agreed with a known leaning where the case says it should not).
- A **note check** on each distilled note: does it contain a withheld category, a quotation, or a leaning backed by a single piece of evidence?
- **Targets:**
  - used: close to A (≥ 25/30);
  - mentioned: well below A's 22/30;
  - sensitive mentioned or alluded: 0;
  - invented: 0;
  - `check` and `convergence` no worse than A0.
- **Owner blind preference** (the existing `blind.html` / `key.html` flow) between A, AW and AU (and AUM) on the same cases. It is scored on intellectual quality first, as EVALUATION.md requires, and founder judgment decides. Use at least 3 repetitions. The pilot spent $8.34 of $9.50, and a study of this size would cost about the same.

## 5. Recommendation

**Smallest first step worth testing:** Option 2 as the experiment config `AU` (and `AUM`), per advisor, consequence-not-cause, withheld by default, run on the existing five longitudinal cases plus the seven new ones above. It touches no production code. If it holds use near 27/30 while mentions fall and sensitive leaks reach 0, the production version is small:
- one table;
- one after-reply distil call;
- one new prompt block;
- the matching wording fix to "keeps nothing";
- STOP deleting the session.

**Needs the owner's decision:**
1. Whether advisors may hold an understanding of the person at all, including whether Alden's "never … remember an earlier conversation" line changes. These are prompt changes (Project B).
2. Sharing across advisors: silo, shared core, or full.
3. The withheld categories, and whether a sensitive fact may be kept as its practical consequence.
4. Retention length, and whether STOP and "forget" delete immediately (recommended).
5. Whether the person can ask what Cinq knows about them.
6. Whether memory ever comes to the website, which would end "nothing saved".
7. Wording of the `person_understanding` framing, approved after the blind comparison.
