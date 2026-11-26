# Memory audit (November 26, 2026)

What Cinq remembers about a person, where it lives, and what reaches the
model. Read from the code and its full history, not assumed. Nothing here
changes production.

## Summary

- **There is no persistent personal memory today.** No extracted
  preferences, no profile and no retrieval. What an advisor knows about
  someone is the raw text of their recent conversation with that advisor.
- **By text that memory was longer until two weeks ago.**
  - **Oct 28 to Nov 14:** each advisor was sent the last 40 turns of its
    conversation with a number, however old.
  - **Since Nov 14 (#64):** only the last 24 hours are sent. Older turns
    were still stored.
  - **Since Nov 19 (#69):** older turns are deleted from the session row on
    every save, along with all but the latest photos.
  Exchanges where an advisor remembered something from an earlier day date
  from before Nov 14, or happened within one day.
- **The deletion is permanent and still happening.** Each time a number
  texts, everything older than a day goes, so the material a future
  understanding would be built from is lost at each person's next text.
  Numbers that haven't texted since Nov 19 still hold their older turns
  until they do. Stopping this needs your approval (C0 in `project-c.md`).
- **A real memory system was built and removed once, on Sep 29.** It
  proposed memories from what people said, required a quote of their own
  words as evidence, attributed each memory to a speaker, waited for
  approval, and retrieved relevant memories by similarity. It was removed
  the same day when the app became one page. Its tables are still in the
  database; nothing reads them.
- **The website keeps nothing.** Each visit is one conversation, sent whole
  with every question (up to 40 turns), and forgotten on reload.

## Each layer

| Layer | Text messages | Website |
|---|---|---|
| Raw conversation history | `sms_sessions.turns_by_advisor`: per advisor, up to 40 turns, each with its time. Sent: the last 24 hours. Stored: the last 24 hours (older turns deleted on save since Nov 19). Photos: only on the current advisor's latest question. | The visit only, held in the page and sent with each question. Nothing stored. The answer alone is mirrored for 15 minutes so it survives a phone switching apps. |
| Persistent personal knowledge | None. | None. |
| Extracted preferences and observations | None since Sep 29. The tables `memories`, `decisions` and `products` remain from that design, unused. | None. |
| Advisor-specific memory | Yes, and only that: each advisor sees only its own conversation with the number. | One advisor per page; nothing carries over. |
| Shared knowledge across advisors | Three things. (1) A handoff note: after the person agrees, the new advisor gets the question and the first advisor's answer, and keeps a note of it (shortened after a day). (2) The names of the advisors the person has met. (3) For Goldie only, that a +1 number is in the US or Canada. Nothing else crosses between advisors. | None. |
| Retrieval and relevance | None. Recency is the only rule: the last day, in order. No instruction says what is relevant or sensitive, so whatever is in the window is fair game, which is how the trousers reached a watch answer and the WhatsApp reached a weight-loss question. | None. |
| Stored but not reaching the model | (1) Older turns, only in rows not saved since Nov 19, until the next text deletes them. (2) The Sep 29 tables, if they hold anything (unknown; they can't be read from here). (3) Twilio's own message log, which by default keeps the text of every message sent and received, outside Cinq. Check the account's settings. Using it would be a privacy decision, not a technical one. | The 15-minute answer mirror. |
| Never stored | Words, photos and numbers in the measurement tables (a number is a keyed hash). Server logs hold codes and timings only. | The same. |

## Where the personal knowledge in the real exchanges came from

The exchanges themselves aren't available in this session, and their
content can't be read from here without the database key. Given the code
as it stood:

- **Martine knowing the trousers, the wardrobe and earlier purchases:** her
  own earlier turns with that number. That was the last 40 turns until
  Nov 14, the last day since. Photos she "remembered" were in those turns
  until Nov 19; since then only her latest question keeps its photos.
- **The trousers in every watch answer:** the same turns, sent whole, with
  nothing telling her that one possession is not a taste.
- **Goldie's reference to the WhatsApp:** her own earlier turns, within the
  window. There is no sensitivity rule, and nothing tells her what to leave
  alone.
- **Continuity in the Amar-to-Martine handover:** the handoff note, which
  carries the question and Amar's answer after the person agreed.

To confirm each one without exposing any content, this read-only query
returns only the shape of each stored conversation. It shows no numbers
and no words:

```sql
select date_trunc('day', s.updated_at) as last_text_day,
       a.key as advisor,
       jsonb_array_length(a.value) as turns,
       to_timestamp(min((t->>'at')::bigint) / 1000) as oldest_turn
from public.sms_sessions s,
     jsonb_each(s.turns_by_advisor) a,
     jsonb_array_elements(a.value) t
where a.key not like '\_%'
group by 1, 2, 3
order by 1 desc;
```

With the dates of the exchanges, it shows which ones ran on the 40-turn
memory and which on the one-day window.

## What is working, missing and regressed

- **Working:** within a day, by text, an advisor remembers everything said
  to it, photos included for the latest question, and a handover carries
  continuity with consent. Conversations are kept separate per advisor.
- **Missing:**
  - any understanding beyond raw text;
  - any judgment about relevance or sensitivity;
  - any way for a person to see, correct or remove what is kept (STOP
    opts out but leaves the stored conversation in place);
  - anything on the website at all.
- **Regressed:**
  - **Nov 14:** cross-day memory by text, when the window was cut to a day.
  - **Nov 19:** the stored history itself, now deleted, along with most
    photos. That change was made for reliability: rows had grown large
    enough to time out on save, mostly because of photos.
  - **Sep 29:** the extraction-and-review memory design, removed
    deliberately when the product became one page.
