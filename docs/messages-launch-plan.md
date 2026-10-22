# Cinq in Apple Messages: provider, database and launch plan

Researched October 2026 from primary documentation (Apple Business Register docs, each vendor's own docs and pricing pages). Anything marked **confirm** was not published or not verifiable from public pages and needs the vendor's answer in writing.

## What Apple requires (applies whichever provider)

From Apple's Messages for Business [policies](https://register.apple.com/resources/messages/messaging-documentation/policies), [FAQ](https://register.apple.com/resources/messages/messaging-documentation/faq) and [getting-started guide](https://register.apple.com/resources/messages/messaging-documentation/):

- **An approved Messaging Service Provider (MSP) is required.** A bot can't connect to Apple directly. Apple provides the channel free; the MSP sets its own price.
- **A live agent is mandatory.** "The business must provide access to a live agent in this channel during its regular business hours. A business must not provide a limited or bot-only solution." Deployments without one are not approved. **This is the largest operational commitment for Cinq: someone has to answer `agent` during published hours.**
- **Automation must identify itself.** The first reply must come within 5 seconds, say it is automated, announce transfers with an estimated wait, and support the trigger words `agent`, `menu` and `unsubscribe` and their alternatives. All of this is built (PR #53).
- **Nothing is sent after the customer deletes the conversation.** Built.
- **One commercial account per business.** You must own the brand, register with a business or Managed Apple Account on a corporate email, and name an administrator, a technical contact (an alias address) and a sponsoring executive.
- **Experience Review.** The MSP submits a screen recording of the whole journey to Apple; approval turns the test account into a commercial one.
- **Category check.** Apple "is not onboarding businesses that primarily offer medical or health-related services." Cinq's lineup (travel, style, design, drinks, decisions) shouldn't fall under this. **Confirm** with the MSP that an AI-advisor brand with live-agent escalation is eligible; Apple's pages don't address AI advisors specifically beyond the automation rules above.
- Apple's [list of approved MSPs](https://register.apple.com/messages) is rendered inside Apple Business Register and couldn't be read publicly. **Confirm** the chosen provider appears in the MSP dropdown there before signing anything.

## Recommendation: Blooio for the pilot

Blooio is the best fit for a small pilot because its Apple Messages integration is an ordinary developer API that matches the adapter Cinq already has. The others are contact-centre suites sold through sales, or not yet generally available.

| | Blooio | Twilio | Zendesk (Sunshine Conversations) | Infobip, Sinch, Bird, LivePerson, Webex Connect and others |
| --- | --- | --- | --- | --- |
| Apple Messages status | States it is an Apple-authorized MSP ([docs](https://docs.blooio.com/amb-launch)) | **Private beta**: "Request access" ([page](https://www.twilio.com/en-us/messaging/channels/apple-messages-for-business)) | Supported; comments on Zendesk's [help article](https://support.zendesk.com/hc/en-us/articles/8030634178458) (January 2025) show customers waiting for Zendesk to appear in Apple's MSP list | Supported (enterprise platforms) |
| Fit for Cinq's own AI | Webhook to your server, reply through the REST API; designed for this ([docs](https://docs.blooio.com/guides/apple-messages-for-business)) | Conversations API or Studio | Requires a Zendesk bot or third-party bot setup | Platform bots plus APIs |
| Published price | Per monthly active user (a customer who exchanges one message in a calendar month) ([MAU definition](https://docs.blooio.com/guides/apple-messages-mau)). **The per-MAU rate for Apple Messages isn't published: confirm.** | Conversations API: first 200 MAU free, then $0.05/MAU ([pricing](https://www.twilio.com/en-us/messaging/pricing/conversations-api)). **Whether that applies to Apple Messages beta: confirm.** | "Starting at US$495 per month" for Sunshine Conversations ([page](https://www.zendesk.com/in/service/messaging/apple-messages-for-business/), last updated 2023, so **confirm**), plus a Suite plan and, per a 2026 third-party guide, a mandatory Professional Services package (**confirm**) | Contact sales |
| Photos from customers | Apple's encrypted attachment is decrypted at once and re-hosted; you get a Blooio-signed URL with its own lifetime. Attachments up to 100 MB ([limits](https://docs.blooio.com/amb-capabilities)). **Confirm** whether iPhone photos arrive as HEIC (Cinq now handles both). | Media storage $0.25/GB/month | Through Zendesk | Varies |
| Human support | Built-in agent inbox and handoff events (`handoff.created`, `.acknowledged`, `.resolved`) ([lifecycle](https://docs.blooio.com/guides/apple-messages-conversations)). **Confirm** inbox seats and whether out-of-hours replies come from your configured hours. | Flex (separately priced) | Zendesk Agent Workspace | Their consoles |
| Reliability features | Signed webhooks (HMAC-SHA256, `X-Blooio-Signature: t=…,v1=…`), `Idempotency-Key` on sends, typing indicator endpoint, `chat.closed` event, `409 chat_closed` ([webhooks](https://docs.blooio.com/webhooks), [idempotency](https://docs.blooio.com/idempotency)) | Mature | Mature | Mature |
| Experience Review | Blooio records, submits and fixes, offered as a managed launch (**price: confirm**) | You | Through Zendesk (a 2025 customer comment describes difficulty finding the submission path) | Through vendor |

**Ask Blooio, in writing, before committing.** The full inquiry, ready to send, is in [`messages-provider-inquiry.md`](messages-provider-inquiry.md). It covers:
- its Apple listing, and confirmation that the connection is official Apple Messages for Business (its `amb` channel), not its separate iMessage-line product;
- eligibility, pilot pricing, seats, human-support hours, retention and deletion;
- photo formats, message limits and test accounts;
- the gaps found in its docs: no handoff API, no text limit, rich links, conversation-state limits.

Fallback if Blooio can't confirm: Twilio once Apple Messages leaves private beta (published per-user pricing), or Zendesk if a contact-centre suite is wanted anyway.

## Database: Supabase Postgres, in a new project dedicated to messaging

Inspected:
- Cinq already has a Supabase account. The repo reads `NEXT_PUBLIC_SUPABASE_URL` and keys, and Supabase is used only for sign-in, which is off by default.
- There's no other database, Redis or KV store.
- `vercel.json` has no crons.
- The channel's `PostgresStore` needs only plain Postgres. It is tested against a real Postgres engine (PGlite), and its retention runs inside the database (`channel_sweep` plus a pg_cron schedule).

Recommendation:
- **Use a new Supabase project only for messaging.** Same vendor and dashboard, nothing new to learn, and it keeps conversation data out of the sign-in project. Connect through Supabase's connection pooler with a server-side connection string (`MESSAGES_DATABASE_URL`); add a small Postgres driver when it's wired. Turn on pg_cron there for the retention job.
- **Plan** ([pricing](https://supabase.com/pricing), [backups](https://supabase.com/docs/guides/platform/backups)):
  - **Free ($0):** fine for building and testing. But "free projects are paused after 1 week of inactivity", which would break webhooks in a quiet week, and it has no automatic backups. Deleted data is simply gone, which is the stricter privacy story.
  - **Pro (from $25/month per project, Micro compute):** never paused. It keeps daily backups for 7 days, so deleted content can survive in backups for up to 7 days; the privacy wording says so. No point-in-time recovery is needed (that's an extra $100/month per 7 days).
- **Not recommended for this:** Vercel's in-memory or Runtime Cache. It isn't durable, which breaks the idempotency and ordering guarantees.

## Launch plan

### 1. Work completed (no accounts or spending)
1. ✅ Server-side iPhone photos (HEIC/HEIF decoding, orientation, the website's sizes), with a provider JPEG preferred when offered and an off switch for the decoder.
2. ✅ Reset cancels unsent replies and stops an answer being written. Apple's trigger words and the five-second automated notice are in.
3. ✅ 24-hour deletion, run inside the database every 15 minutes and verified by a table dump.
4. ✅ The Postgres driver (`postgres`), tested over the wire. Migrations in `db/messages/` with row-level security, plus a migration script. None of it has been run against a hosted database.
5. ✅ Webhook and retry routes, 404 everywhere unless `MESSAGES_CHANNEL_ENABLED=true`.
6. ✅ The Blooio adapter, written from Blooio's public docs and tested against them. It accepts Apple Messages for Business events only.
7. ✅ Optional summary handoff when switching advisors: shown first, shared only on request, photos only if included.

Left for launch, once accounts exist: run the migrations, set the variables, point a scheduler at `/api/messages/run-due`, and check the HEIC decoder on the hosting project's preview.

### 2. Account setup and business details you must supply
1. **Legal business entity and brand ownership** for "Cinq". Apple allows one commercial account per business, and the brand must be yours.
2. **Apple Business Register account:**
   - sign in with a business or Managed Apple Account on a corporate email (personal Apple Accounts are refused);
   - an administrator, a technical contact alias (for example tech@your domain) and a sponsoring executive who accepts Apple's terms;
   - Apple Accounts for testers.
3. **Brand assets and details shown in Messages:**
   - the business name as customers know it;
   - a square logo of at least 1024 × 1024 on a solid background;
   - brand colours, website and response hours.
4. **Human support:** who answers `agent`, which days and hours, and in which time zone. These hours must match what's registered with Apple.
5. **MSP account** with the chosen provider, its API key and webhook signing secret (I never handle these values; you set them in Vercel).
6. **Privacy policy and terms pages** to send as rich links. Approve the draft wording in `docs/messages-channel.md` once the provider's retention and the database backup period are known.
7. **Which Vercel project hosts the channel** (one only), and the entry points you want: a website button, QR code, Apple Maps or Message Suggest.

### 3. Costs and decisions needing your approval
1. **Provider:** Blooio, after its written answers to the inquiry. Its Apple Messages price per monthly active user, any setup or managed-launch fee, the minimum term and seat prices are **not published**, so there's no confirmed cost yet.
2. **Database:** Supabase, in a new project.
   - Free ($0) for building, but it pauses after a week of inactivity and has no backups.
   - Pro is **$25/month** (published). It never pauses and keeps daily backups for 7 days, which the privacy wording then states.
   - Point-in-time recovery isn't needed (it would be $100/month per 7 days).
3. **Model usage:** every answer is a paid Anthropic call at the website's settings, capped at 40 questions per conversation per hour. There's no new fixed cost; keep the monthly spend limit.
4. **Live-agent staffing and published hours:** Apple requires a person during business hours.
5. **HEIC decoding:** decode on our server (LGPL and HEVC-patent questions open; get a qualified review), or switch it off (`MESSAGES_HEIC_DECODE=false`) and rely on a provider JPEG or ask people to send JPEG.
6. **Context window:** 24 hours of inactivity, kept as decided. Content can stay in the database up to 24 h 15 min.
7. **Go-live:** `MESSAGES_CHANNEL_ENABLED=true` on one project, after Apple approves the Experience Review.
