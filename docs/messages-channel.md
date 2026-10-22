# Cinq in Apple Messages for Business: implementation note

Status: **built and tested provider-neutrally; not connected to any provider, not mounted on any route, not launched.** Nothing here sends or receives a real message.

## What exists

One Cinq conversation in Messages reaches all five advisors: Amar (Travel), Martine (Style), Gio (Design), Alden (Drinks) and Goldie (Advice). Code is in `src/lib/channel/`.

| File | What it does |
| --- | --- |
| `engine.ts` | The way in to Cinq's engine. It calls `getChatProvider` and `ask`, exactly as the website's ask route does, for whichever advisor was chosen. The prompts, shared standards, model settings, web search, referral rules and answer handling are all reused, not copied. |
| `router.ts` | Decides who answers, as pure logic: the welcome and picker, named requests, a question kept until someone is chosen, switching, and the commands (`menu`, `reset`, `agent`, and Apple's standard trigger words). |
| `service.ts` | The pipeline: webhook, verify, normalize, record once, process in order, call the engine, commit replies to the outbox, deliver with retries. Also handles reset, conversation end, expiry and the human-support handoff. |
| `types.ts` | The adapter boundary (`MessagingAdapter`), normalized events, the `Engine` and `ChannelStore` contracts. |
| `format.ts` | Turns Markdown into plain text and groups paragraphs into messages within the provider's limits. Nothing is summarized or cut. |
| `memory-store.ts` | A store for tests and the harness. **Not durable.** |
| `postgres-store.ts` | A durable store with its schema (`CHANNEL_SCHEMA`). It is tested against a real Postgres (PGlite) but not applied to any database. |
| `fixture.ts` | A test adapter and engine. Every reply they produce is labeled `[Fixture reply: no model was called]`. |
| `copy.ts` | What Cinq itself says: the welcome, switching, reset, photo problems and support. Names and areas come from the companions. |
| `retention.ts` | The cleanup schedule and the retry schedule. |

The photo check is shared by both channels: `src/lib/ask/images.ts` holds the website's own schema, moved from the ask route unchanged.

The local harness is `npm run messages:harness`. You type as the person and see what Cinq would send. It is fixture-only: no model, no provider, nothing leaves the machine.

### Changes visible on the website

None.
- The ask route imports the same image schema from its new shared home.
- Each companion gained a one-word `category` (Travel, Style and so on) that only the channel shows.
- No prompt, page copy, model setting, tool or route changed.

## Conversation behavior

1. **Welcome.** A first message with no advisor named gets one short welcome, which says these are AI advisors, plus a five-option picker. The message is kept and passed to whoever is chosen. Later messages before a choice are added to it, with a one-line reminder rather than another welcome.
2. **Named requests.** "Amar: one night in Bangkok" (or "Amar, …") goes straight to Amar. A name or area on its own ("Martine", "Drinks") switches advisors. A name later in a sentence is just part of the question.
3. **Identification and separate histories.** The advisor's name and area head their first reply, and any reply after they take over from someone else. Each advisor keeps a separate history within the session. Switching says so, and nothing from one advisor's conversation reaches another.
4. **Photos.**
   - Attachments are downloaded only through the adapter's authenticated call, by the provider's reference. A URL in the text is never fetched.
   - Photos are prepared on the server exactly as the website's browser prepares them (`src/lib/ask/server-photos.ts`): a JPEG at most 1280 px on its longest edge for the question, and a 512 px copy kept for follow-ups. Each photo is turned upright from its EXIF orientation, and transparency goes onto white.
   - **iPhone HEIC/HEIF** is decoded with `heic-decode` (libheif in WebAssembly), because sharp's own HEIF support covers AVIF only. JPEG, PNG, WebP, GIF (first frame) and AVIF go through sharp.
   - **Refused with a plain message:** anything over 30 MB or 60 megapixels (a 48 MP iPhone photo fits), files that aren't photos (the type is read from the bytes), and more than 10 photos.
   - **Licence check:** libheif and its HEVC decoder are LGPL-3.0, and HEVC decoding can carry patent-licensing questions. Confirm before launch that shipping them on the server is acceptable.
5. **Answers.** Advisors' Markdown becomes plain text, with links kept as addresses so the provider can show rich links. Long answers go out as paragraph groups within the provider's limits, and a short answer stays one message. Nothing is shortened or turned into a follow-up question.
6. **Commands.** These follow Apple's standard trigger words from the Messages for Business policies.
   - `menu`, `list`, `?` or `advisors` opens the picker.
   - `reset` clears Cinq's context. It also cancels every reply not yet sent, including the rest of a long answer waiting on a retry, and stops an answer still being written (checked every 2 s), so none of it goes out. Questions already waiting behind a reset are not answered. The reply says the person's Messages history isn't changed.
   - `unsubscribe`, `stop`, `spam` or `end` gets a plain note that Cinq only replies and sends no notifications.
   - The provider's conversation-end event clears the session and cancels unsent replies. Apple requires that nothing more is sent after a close.
   - `agent`, `support` or `help` asks the provider for a person and reports only what the provider returns: queued with its wait, closed with its hours, or not connected. While a person has the conversation, the advisors stay quiet until the provider hands it back.

7. **Apple's first-reply rule.** Automation must answer within five seconds and say it is automated. A first message that names an advisor gets an immediate notice ("Hi, this is Cinq's automated service. Amar · Travel, one of Cinq's AI advisors, is writing your answer now. Type agent anytime to reach a person.") before the answer is written. The welcome says the same for an unnamed first message.

## Delivery, ordering and failure

- **Idempotent inbound.** Each provider event id is recorded once; a redelivered or concurrent duplicate is never processed again. The id outlives the content for 7 days to catch late redeliveries.
- **Per-conversation order.**
  - One worker holds a conversation at a time, under a lease longer than the longest answer.
  - Events are handled oldest first, by the time the person sent them, then by arrival.
  - Different conversations run independently.
- **Each question is answered once.** Replies are written to the outbox in the same step that marks the event done. If a worker dies mid-answer, the next worker finds the event flagged and tells the person it was interrupted and to send it again. The model is not called a second time; the website follows the same rule, one model call per question.
- **Outbox.**
  - Replies go out strictly in order. A later reply waits while an earlier one is retrying.
  - Retries come after 10 s, 30 s, 2 min, 10 min and 30 min. After the sixth attempt the reply is abandoned and logged.
  - A permanent failure (closed conversation, rejected message) is abandoned at once.
  - Each reply has a stable idempotency key (`<event id>#<n>`). It is passed to the provider so a resend after a crash between sending and recording can be deduplicated, where the provider supports that.
- **Limits.**
  - Questions per conversation per hour default to 40 (`QUESTIONS_PER_HOUR`, the website's setting). The count is in memory per instance, as on the website.
  - Answers stop after 240 s with the engine's plain time-limit message.
  - Provider calls (send, download, support) are abandoned after 15 s.
- **Sending.** Replies go out only from the worker holding the conversation. Each send first checks for a waiting reset or close, so a reset can't race a send already queued.
- **A worker presumed dead.** If a stalled worker finishes after another has reported its event as interrupted, the late answer is dropped: commit only succeeds while the event is still in progress (tested).
- **Failures** keep any partial answer, say what happened in the engine's own plain words, and add "Send your question again to try once more." The failed exchange is left out of the advisor's history, so a resend isn't a duplicate turn.
- **Logs** hold codes, counts, timings and advisor ids only. They never contain text, answers, photos, names or conversation ids, and this is tested. There is no analytics.

## Retention (enforced on every read, after every webhook, and by the database every 15 minutes)

| What | Kept |
| --- | --- |
| Conversation context: advisor histories (including photos), a waiting question, the chosen advisor | 24 hours after the last event (`MESSAGES_CONTEXT_HOURS`, 1 to 72). Expired context is treated as absent on read and deleted by the sweep. |
| An event's content (text, attachment references) | Cleared as soon as the event is handled. If never handled within the context window, dropped unanswered. |
| An event's id and status | 7 days, to recognise redeliveries |
| A reply's content | Cleared when sent, abandoned or cancelled. A reply still unsent after the context window is abandoned. |
| A reply's record (id, status, attempts) | 7 days |
| Conversation locks | Until their lease ends |

**How the 24 hours is enforced, and what's been verified.**
- **On read.** An expired session is treated as absent and deleted the moment it's read, so an advisor never sees expired context, even before a sweep.
- **The sweep.** The deletions are one database function, `channel_sweep`. It runs before every webhook, and the `sweepSchedule()` job runs it inside Postgres every 15 minutes through pg_cron. Physical deletion therefore happens within 24 h 15 min of the last message, with or without traffic, and doesn't depend on the host's cron.
- **Verified in a real Postgres (PGlite).** A test runs a conversation with an iPhone photo and a reply stuck in retry, then dumps every channel table:
  - 24 hours later, no question, answer or photo data remains;
  - a week later, not even the conversation id remains.
  - A second test runs the scheduled job's own statement with the database clock.
- **Outside Cinq's tables:**
  - The database provider's backups keep deleted rows for their own window. Supabase Pro keeps daily backups for 7 days; Free keeps none.
  - Retries, stranded events and send leases still need `channel.runDue()` on a schedule, about every minute.
  - The in-memory rate limiter holds conversation ids (Apple's opaque ids, not phone numbers) for an hour.
  - An answer being written holds its question in memory for up to 4 minutes.

## Still to do before launch

### 1. Choose the messaging service provider (blocked: no provider selected)

Apple Messages for Business runs through an Apple-approved Messaging Service Provider (MSP). The alternative is registering Cinq as its own MSP, which Apple must approve and which carries its own feature requirements. Once a provider is chosen, write `src/lib/channel/<provider>.ts` implementing `MessagingAdapter` **from that provider's documentation**, covering:

- **Webhook verification.** Its documented signature or token check, run in `verify` before anything is parsed.
- **Event normalization.** Messages, list-picker responses, attachments, conversation close or opt-out, and handback from a human agent. Read receipts, typing and tapbacks are ignored. Map the provider's event id and send time.
- **Outbound.** Text, the list picker (`kind: "picker"`), rich links for URLs (Apple expects every URL to be sent as a rich link) and typing indicators. Map provider errors to retryable or permanent, and use the provider's idempotency mechanism if it has one.
- **Attachments.** Download by reference with the provider's credentials, from the provider's own host only. Conversion and resizing are already done (see Photos).
- **Limits.** Set `maxTextChars` from the provider's documented maximum, and `preferredTextChars` for readable groups.
- **Human support.** The provider's handoff to its agent console, returning the real queue status or hours.

Then:
- Pick the database. Apply `CHANNEL_SCHEMA` as a reviewed migration and wrap the driver in the `SqlClient` shape (a few lines).
- Mount the webhook as `src/app/api/messages/<provider>/route.ts`. It should read the raw body, call `handleWebhook`, return the status, and pass `background` to `after()`. It must return 404 unless `MESSAGES_CHANNEL_ENABLED` is set, because this codebase deploys to every Cinq project, so the route belongs on one project only.
- Add the scheduled `runDue()` job for retries. Its frequency depends on the hosting plan's cron limits; check before relying on one minute. Apply `sweepSchedule()` in the database for retention.
- Set the variables in `.env.messages.example` (names only).

### 2. Apple business registration and experience review

- **Apple Business Register.** Register the organization with an administrator, a technical contact (an alias address, not a person's) and a sponsoring executive who accepts the terms. Create the Messages for Business account, choose the MSP, and add test Apple Accounts.
- **Brand details customers see in Messages.** Name, logos, response hours and account type, all reviewed by Apple. The response hours must match the human-support hours below.
- **Entry points.** For example, a link or button on Cinq's site, or a QR code.
- **Experience review.** Build and test in test mode. The MSP then submits a screen recording of the experience to Apple; address any feedback. Approval turns the test account into a commercial account. Plan for the welcome, picker, the first-reply notice, an answer with photos, `agent` with a live person, out-of-hours `agent`, `menu`, `reset` and a closed conversation to appear in the recording.

### 3. Human support

- Decide who staffs it and when.
- Set up the provider's agent console and queue. Agents need the conversation history the provider keeps, since Cinq's own context is temporary.
- Make `requestSupport` return real queue status and hours.
- Agree what agents say about Cinq's AI advisors, and how they hand a conversation back (the `support_ended` event).

## Privacy wording (draft for review)

> **Cinq in Messages.** Cinq's advisors are AI. When you message Cinq, your messages and photos go through Apple Messages for Business and [provider] to Cinq, and from Cinq to Anthropic to write each answer. An advisor may search the web for your question.
>
> Cinq keeps what it needs to continue the conversation (your messages with each advisor, your photos and which advisor you're talking to) for 24 hours after your last message, then deletes it. Type **reset** at any time to clear it sooner. Closing the conversation clears it too. Deleted data can remain in Cinq's database backups for up to [7] days before they expire. Cinq doesn't add your conversations to analytics or keep them in its logs.
>
> Clearing Cinq's copy doesn't remove anything from Messages on your devices, or from Apple's or [provider]'s systems. They keep messages under their own terms: [link to provider's retention terms]. [How messages are encrypted in transit, as Apple's and the provider's documentation describe it.]
>
> Type **agent** to ask for a person from Cinq's team, [hours]. They see the conversation through [provider].

Points to confirm before using this:
- The provider's name, its retention terms, and the encryption description (left as a placeholder rather than guessed).
- Anthropic's data terms as they apply to Cinq's account.
- The support hours.
- That 24 hours is the chosen window, and the backup period of the chosen database plan.
- The provider's own message-history retention. For example, Blooio's published plans list 90-day or 1-year message history for its iMessage lines; its retention for Apple Messages for Business conversations needs confirming.
